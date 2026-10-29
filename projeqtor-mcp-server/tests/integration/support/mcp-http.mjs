import assert from 'node:assert/strict';
import http from 'node:http';

export function requireLoopbackUrl(value) {
  const url = new URL(value);
  assert.equal(url.protocol, 'http:', 'QA harness only targets local HTTP servers');
  assert.equal(url.hostname, '127.0.0.1', 'Use explicit 127.0.0.1, never live/remote targets');
  assert.ok(url.port, 'Use an explicit QA port');
  assert.equal(url.username + url.password + url.hash, '', 'No URL credentials/fragments');
  return url;
}

// Native HTTP preserves the exact hostile Host supplied by security probes.
export function rawHttp(target, { method = 'POST', headers = {}, body,
  timeoutMs = 3000, maxBytes = 1_048_576 } = {}) {
  const url = requireLoopbackUrl(target);
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers, signal: AbortSignal.timeout(timeoutMs) }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) res.destroy(new Error('QA response bound exceeded'));
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers,
        text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

export async function readRpc(response, id, maxBytes = 1_048_576) {
  const type = response.headers.get('content-type') ?? '';
  assert.ok(type.startsWith('application/json') || type.startsWith('text/event-stream'), 'MCP response must be JSON or SSE');
  const sse = type.startsWith('text/event-stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let bytes = 0;
  const check = (message) => {
    assert.equal(message.jsonrpc, '2.0');
    assert.equal(message.id, id, 'JSON-RPC response ID must match the request');
    assert.ok(Object.hasOwn(message, 'result') !== Object.hasOwn(message, 'error'));
    return message;
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (!sse) return check(JSON.parse(buffer));
        throw new Error('SSE ended without the matching JSON-RPC response');
      }
      bytes += value.byteLength;
      assert.ok(bytes <= maxBytes, 'QA response bound exceeded');
      buffer += decoder.decode(value, { stream: true });
      if (!sse) continue;
      for (;;) {
        const boundary = /\r?\n\r?\n/.exec(buffer);
        if (!boundary) break;
        const event = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, '')).join('\n');
        if (!data.trim()) continue; // Priming events and heartbeat comments.
        const message = JSON.parse(data);
        if (message.id === id) return check(message);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export function createMcpHttpClient({ url, token, origin, timeoutMs = 5000 }) {
  const endpoint = requireLoopbackUrl(url).href;
  let nextId = 0;
  let sessionId;
  let version = '2025-11-25';
  const headers = () => ({
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`, 'MCP-Protocol-Version': version,
    ...(origin ? { Origin: origin } : {}), ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
  });
  async function post(message) {
    return fetch(endpoint, { method: 'POST', headers: headers(), body: JSON.stringify(message),
      redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  }
  async function request(method, params = {}) {
    const id = ++nextId;
    const response = await post({ jsonrpc: '2.0', id, method, params });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`MCP HTTP request failed with status ${response.status}`);
    }
    const returnedSession = response.headers.get('mcp-session-id');
    if (returnedSession) sessionId = returnedSession;
    return readRpc(response, id);
  }
  return {
    request,
    async initialize() {
      const result = await request('initialize', { protocolVersion: version, capabilities: {},
        clientInfo: { name: 'independent-qa-blackbox', version: '0.1.0' } });
      assert.ok(result.result?.capabilities?.tools, 'Server must advertise tools');
      assert.equal(typeof result.result.protocolVersion, 'string');
      version = result.result.protocolVersion;
      const response = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
      assert.equal(response.status, 202, 'Accepted notification must return HTTP 202');
      assert.equal(await response.text(), '', 'Accepted notification must have no body');
      return result;
    },
    async close() {
      if (!sessionId) return;
      const response = await fetch(endpoint, { method: 'DELETE', headers: headers(),
        redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
      await response.body?.cancel();
      assert.ok([200, 202, 204, 405].includes(response.status), 'Unexpected session termination status');
    },
  };
}
