import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import net from 'node:net';
import { setTimeout as pause } from 'node:timers/promises';
import { requireLoopbackUrl } from './mcp-http.mjs';
import { fakeCredentials } from './fake-upstream.mjs';
import { syntheticLeakCanary } from './source-contract.mjs';

export const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const entrypoint = fileURLToPath(new URL('../../../dist/index.js', import.meta.url));

export function cleanEnvironment() {
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'TEMP', 'TMP']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

export async function availablePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

// Only called with the URL just created by startFakeUpstream in the QA test.
export async function startRealModeAgainstFake(baseUrl) {
  const upstream = requireLoopbackUrl(baseUrl);
  assert.equal(upstream.pathname, '/api/');
  assert.equal(upstream.search, '');
  await access(entrypoint);
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  let token;
  do { token = randomBytes(48).toString('base64url'); }
  while (/replace|example|change|placeholder/i.test(token) || new Set(token).size < 8);
  const env = { ...cleanEnvironment(), MCP_TRANSPORT: 'http', MCP_HOST: '127.0.0.1',
    MCP_PORT: String(port), MCP_ALLOWED_ORIGINS: origin, MCP_BEARER_TOKEN: token,
    ENABLE_WRITE: 'false', PROJEQTOR_MODE: 'real', PROJEQTOR_BASE_URL: upstream.href,
    PROJEQTOR_USERNAME: fakeCredentials.username, PROJEQTOR_PASSWORD: fakeCredentials.password,
    PROJEQTOR_TIMEOUT_MS: '250', PROJEQTOR_MAX_RESPONSE_BYTES: '8192' };
  const child = spawn(process.execPath, [entrypoint], { cwd: projectRoot, env,
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let outcome;
  let log = '';
  let logOverflow = false;
  const completed = new Promise((resolve) => {
    child.once('error', (error) => { outcome = { error: error.message }; resolve(outcome); });
    child.once('close', (code, signal) => { outcome = { code, signal }; resolve(outcome); });
  });
  const collect = (chunk) => {
    if (log.length + chunk.length > 1_048_576) { logOverflow = true; return; }
    log += chunk.toString('utf8');
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const canaries = [token, fakeCredentials.username, fakeCredentials.password, syntheticLeakCanary,
    Buffer.from(`${fakeCredentials.username}:${fakeCredentials.password}`).toString('base64')];
  const assertSanitized = (value, context = 'M2 output') => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    for (const canary of canaries) assert.ok(!text.includes(canary), `${context} leaked a synthetic secret`);
  };
  const redact = (value) => canaries.reduce((text, canary) => text.split(canary).join('[REDACTED]'), value);
  let closed = false;
  const killOnExit = () => child.kill('SIGKILL');
  process.once('exit', killOnExit);
  async function close() {
    if (closed) return;
    closed = true;
    try {
      if (!outcome) {
        child.kill('SIGTERM');
        const done = await Promise.race([completed.then(() => true), pause(1500).then(() => false)]);
        if (!done && !outcome) { child.kill('SIGKILL'); await completed; }
      }
    } finally { process.removeListener('exit', killOnExit); }
  }
  try {
    const deadline = Date.now() + 10_000;
    let health;
    while (Date.now() < deadline) {
      if (outcome) throw new Error(`M2 backend exited before readiness; sanitized logs: ${redact(log)}`);
      try {
        const response = await fetch(`${origin}/health`, { redirect: 'error', signal: AbortSignal.timeout(500) });
        if (response.status === 200) {
          health = await response.json();
          break;
        }
        await response.body?.cancel();
      } catch { /* Socket may not yet be bound. */ }
      await pause(80);
    }
    assert.ok(health && !outcome, 'M2 backend did not become ready');
    assert.equal(health.mode, 'real', 'Fake-upstream run must use actual Real Mode client, never Mock Mode');
    assertSanitized(health, 'Health');
    return { url: `${origin}/mcp`, origin, token, port, close, assertSanitized,
      assertLogsSanitized() {
        assert.ok(!logOverflow, 'M2 log capture overflowed');
        assertSanitized(log, 'Backend logs');
      },
      sanitizedLogTail: () => redact(log.slice(-8192)),
    };
  } catch (error) { await close(); throw error; }
}
