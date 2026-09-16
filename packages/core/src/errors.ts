export type ErrorCode =
  | 'INVALID_INPUT' | 'NOT_FOUND' | 'ALREADY_EXISTS' | 'STALE_REVISION'
  | 'CHANGE_CONFLICT' | 'INVALID_TRANSITION' | 'UNSUPPORTED_SCHEMA'
  | 'GUIDANCE_CONFLICT' | 'CORRUPT_DATA' | 'WORKSPACE_CLOSED' | 'MIGRATION_REQUIRED' | 'WORKSPACE_BUSY'
  | 'SOURCE_NETWORK' | 'SOURCE_BLOCKED' | 'SOURCE_TOO_LARGE' | 'SOURCE_UNSUPPORTED' | 'SOURCE_TIMEOUT' | 'SOURCE_CANCELLED' | 'SOURCE_REDIRECT';

export class WriterError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'WriterError';
  }
}

export function requireString(value: unknown, label: string, maxLength = 512): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new WriterError('INVALID_INPUT', `${label} must be a non-empty string of at most ${maxLength} characters.`);
  }
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
