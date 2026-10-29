const messages = {
  INVALID_ARGUMENT: 'Invalid tool arguments.',
  PROJECT_NOT_FOUND: 'The project is not visible or does not exist.',
  ACTIVITY_NOT_FOUND: 'The Activity is not visible or does not exist.',
  WORK_TOTAL_OVERFLOW: 'Work values exceed the supported numeric range.',
  WRITE_DISABLED: 'Activity creation is disabled. Enable writes locally before using create_activity.',
  REAL_WRITE_BLOCKED: 'Real Activity creation requires the independent live-write gate. No upstream write was attempted.',
  DELETE_DISABLED: 'Activity deletion is disabled. Enable writes locally before using delete_activity.',
  REAL_DELETE_BLOCKED: 'Real Activity deletion requires Real Mode and the independent live-write gate. No upstream delete was attempted.',
  OPERATION_OUTCOME_UNKNOWN: 'A matching real write may already be in progress or completed. Automatic retry is blocked to prevent duplicates.',
  STATE_INVALID: 'The local proposal state is invalid. Creation was blocked.',
  STATE_UNAVAILABLE: 'The local proposal state is unavailable.',
  STATE_BUSY: 'The local proposal state is busy. No changes were made.',
  STATE_LIMIT: 'The bounded local mock state has reached its limit.',
  UPSTREAM_HTTP_ERROR: 'Upstream returned an unsuccessful HTTP status.',
  UPSTREAM_API_ERROR: 'ProjeQtOr rejected the API request before processing it.',
  UPSTREAM_REDIRECT: 'Upstream redirects are not permitted.',
  UPSTREAM_TIMEOUT: 'Upstream read exceeded the configured timeout.',
  UPSTREAM_RESPONSE_LIMIT: 'Upstream response exceeded the configured byte limit.',
  UPSTREAM_COLLECTION_LIMIT: 'Upstream collection exceeded 10000 rows; no partial result was returned.',
  UPSTREAM_INVALID_RESPONSE: 'Upstream response did not match the expected API contract.',
  UPSTREAM_UNAVAILABLE: 'Upstream read failed.',
  UPSTREAM_WRITE_UNCERTAIN: 'The real write result could not be verified. This operation is blocked from retry to prevent duplicate activities.',
  UPSTREAM_WRITE_REJECTED: 'ProjeQtOr explicitly rejected and rolled back the Activity create.',
  UPSTREAM_DELETE_REJECTED: 'ProjeQtOr explicitly rejected the Activity deletion.',
  UPSTREAM_DELETE_UNCERTAIN: 'The Activity deletion result could not be verified.',
  UPSTREAM_DELETE_NOT_VERIFIED: 'ProjeQtOr acknowledged the deletion, but the Activity is still visible.',
  MOCK_DATA_ERROR: 'Synthetic fixture data is unavailable or invalid.'
} as const;

export class ReadError extends Error {
  constructor(readonly code: keyof typeof messages, readonly details?: Readonly<Record<string, string>>) { super(messages[code]); }
}

export function publicError(error: unknown, mode: 'mock' | 'real'): { code: keyof typeof messages; message: string; details?: Readonly<Record<string, string>> } {
  const safe = error instanceof ReadError ? error : new ReadError(mode === 'mock' ? 'MOCK_DATA_ERROR' : 'UPSTREAM_UNAVAILABLE');
  const details = safe.details && Object.fromEntries(Object.entries(safe.details)
    .filter(([key]) => ['operationId', 'activityId', 'reason'].includes(key)));
  return { code: safe.code, message: safe.message, ...(details && Object.keys(details).length ? { details } : {}) };
}
