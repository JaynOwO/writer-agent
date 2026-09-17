# Desktop/runtime and product packaging

Official Electron 44.4.1 runtimes are independently locked by byte size/SHA-256 in apps/desktop/runtime-lock.json. The application has no extra npm renderer framework. pnpm-lock.yaml genuinely adds the desktop workspace; existing SDK/keyring versions remain unchanged. Production module copies derive from an installed frozen dependency tree and a verified target-platform keyring binding. Official Electron and Chromium license files are retained unchanged.

Developer-only packaging (run after pnpm build; destination must not exist):

```sh
node scripts/package-desktop.mjs --runtime VERIFIED_RUNTIME_DIR --runtime-zip VERIFIED_RUNTIME_ZIP --platform win32 --out NEW_OUTPUT_DIR --extra-modules TARGET_NODE_MODULES_DIR
```

The packer compares runtime bytes with the pinned ZIP and copies only its listed entries. It stages resources/app, compiled application/core/storage/model modules and transitively resolved runtime dependencies; it does not install packages, infer Windows execution, sign binaries, or publish a Release. DESKTOP_MANIFEST.json describes the exact produced portable directory. Windows uses Siglum.exe; the app offers a current-user installation flow. This is not a standalone MSI/NSIS installer. Application signing and Windows execution are separate release gates.

Use the source smoke fixture against a packaged Linux app via SIGLUM_TEST_APP pointing to packaged resources/app/apps/desktop. That fixture variable is read by the test only, not the production entry. Windows smoke/installer behavior must be observed separately. No --no-sandbox, administrator prerequisite, npx auto-install or lowered OS policy is provided.

Source delivery, updater-bootstrap, desktop-portable, desktop-installer, dependency-result are different package kinds. A desktop portable is not a source ZIP for the updater. The developer updater can download declared public Release assets but never execute an installer implicitly.

Known preview boundary: source-level packaging/run helpers have been tested on Linux. Windows x64 files are assembled from the verified official binary and native binding but need an actual Windows first launch/install/uninstall pass. GUI-only validation does not establish paid-model research quality or OS credential success. Upstream runtime signing alone does not sign the application code or its archive.
