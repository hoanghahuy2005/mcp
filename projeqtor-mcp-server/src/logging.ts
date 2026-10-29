type LogEvent = 'http_started' | 'stdio_started' | 'shutdown' | 'startup_failed' | 'protocol_error' | 'request_failed' | 'tool_failed' |
  'http_rejected' | 'oauth_rejected';

// Only fixed event names and explicitly selected non-secret fields cross this boundary.
export function log(event: LogEvent, fields: { port?: number; transport?: 'http' | 'stdio'; status?: number; method?: string; reason?: string } = {}): void {
  process.stderr.write(`${JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields })}\n`);
}
