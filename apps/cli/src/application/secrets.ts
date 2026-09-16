// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from 'node:crypto';
export class ProductError extends Error {
    constructor(readonly code: string, message: string) { super(message); this.name = 'ProductError'; }
}
export interface SecretStore {
    readonly backend: string;
    read(id: string): Promise<string | null>;
    write(id: string, value: string): Promise<void>;
    remove(id: string): Promise<boolean>;
}
export function secretId(): string { return 'secret_' + randomUUID().replaceAll('-', ''); }
export function checkSecretId(id: string): void { if (!/^secret_[a-f0-9]{32}$/.test(id))
    throw new ProductError('CREDENTIAL_REFERENCE', 'Invalid Siglum credential reference.'); }
export function checkKey(value: unknown): asserts value is string { if (typeof value !== 'string' || !value || value.length > 8192 || !/^[\x21-\x7e]+$/.test(value))
    throw new ProductError('CREDENTIAL_INVALID', 'Expected a nonempty ASCII API token of at most 8192 characters.'); }
/** Lazy module load. Merely constructing this class does not unlock/read a keyring. */
export class OsSecretStore implements SecretStore {
    readonly backend = process.platform === 'win32' ? 'windows-credential-manager' : process.platform === 'darwin' ? 'macos-keychain' : process.platform === 'linux' ? 'linux-secret-service' : 'unsupported';
    private async entry(id: string) {
        checkSecretId(id);
        if (this.backend === 'unsupported')
            throw new ProductError('CREDENTIAL_UNSUPPORTED', 'This platform has no configured OS credential backend.');
        try {
            const { AsyncEntry } = await import('@napi-rs/keyring');
            // Explicitly refuse Linux keyutils auto-fallback: this feature promises Secret Service.
            return new AsyncEntry('Siglum/credentials/v1', id, process.platform === 'linux' ? { linux: { store: 'secret-service' } } : undefined);
        }
        catch {
            throw new ProductError('CREDENTIAL_BACKEND_UNAVAILABLE', 'OS credential backend unavailable. No plaintext fallback was used.');
        }
    }
    private failure(error: unknown): never {
        if (error instanceof ProductError)
            throw error;
        // Inspect privately; never echo backend text that could contain a credential or account.
        const message = String((error as Error)?.message ?? '').toLowerCase();
        const code = /lock/.test(message) ? 'CREDENTIAL_LOCKED' : /denied|permission|access/.test(message) ? 'CREDENTIAL_DENIED' : 'CREDENTIAL_BACKEND_UNAVAILABLE';
        throw new ProductError(code, 'OS credential operation failed. Unlock/repair the backend, or explicitly choose another credential mode.');
    }
    async read(id: string): Promise<string | null> { try {
        return (await (await this.entry(id)).getPassword()) ?? null;
    }
    catch (e) {
        return this.failure(e);
    } }
    async write(id: string, value: string): Promise<void> { checkKey(value); try {
        await (await this.entry(id)).setPassword(value);
    }
    catch (e) {
        this.failure(e);
    } }
    async remove(id: string): Promise<boolean> { try {
        return await (await this.entry(id)).deleteCredential();
    }
    catch (e) {
        return this.failure(e);
    } }
}
/** Explicit test creates only a random Siglum item; never enumerates existing entries. */
export async function credentialSelfTest(store: SecretStore) {
    const id = secretId();
    let created = false, cleanup: 'not-needed' | 'passed' | 'failed' = 'not-needed';
    try {
        const original = 'Siglum-test-' + randomUUID();
        created = true;
        await store.write(id, original);
        const read = await store.read(id);
        if (read !== original)
            throw new ProductError('CREDENTIAL_SELFTEST', 'Readback mismatch.');
        const replacement = 'Siglum-test-' + randomUUID();
        await store.write(id, replacement);
        if (await store.read(id) !== replacement)
            throw new ProductError('CREDENTIAL_SELFTEST', 'Replacement readback mismatch.');
        if (!await store.remove(id) || await store.read(id) !== null)
            throw new ProductError('CREDENTIAL_SELFTEST', 'Delete verification failed.');
        created = false;
        cleanup = 'passed';
        return { status: 'passed' as const, backend: store.backend, cleanup };
    }
    finally {
        if (created) {
            try {
                await store.remove(id);
                cleanup = 'passed';
            }
            catch {
                cleanup = 'failed';
            }
            if (cleanup === 'failed')
                throw new ProductError('CREDENTIAL_CLEANUP', 'Test credential cleanup failed. Only this isolated Siglum item was used; inspect credential recovery.');
        }
    }
}
