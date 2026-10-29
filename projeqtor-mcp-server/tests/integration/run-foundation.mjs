// Optional opt-in runner; preparation does not authorize executing product tests.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { access } from 'node:fs/promises';
import net from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

const root = fileURLToPath(new URL('../../', import.meta.url));
const entrypoint = path.join(root, 'dist', 'index.js');

async function reservePortNumber() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  // Backend does not yet accept port=0. Release the reservation just before spawn;
  // fail startup if a race occurs, never kill an unrelated owner of the port.
  return port;
}

function isolatedEnvironment() {
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'TEMP', 'TMP']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

function startNode(args, env, stdio) {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio, windowsHide: true });
  let outcome;
  const done = new Promise((resolve) => {
    child.once('error', (error) => { outcome = { error }; resolve(outcome); });
    child.once('close', (code, signal) => { outcome = { code, signal }; resolve(outcome); });
  });
  return { child, done, get outcome() { return outcome; } };
}

async function stop(processHandle) {
  if (!processHandle || processHandle.outcome) return;
  processHandle.child.kill('SIGTERM');
  const terminated = await Promise.race([processHandle.done.then(() => true), pause(2000).then(() => false)]);
  if (!terminated && !processHandle.outcome) {
    processHandle.child.kill('SIGKILL');
    await processHandle.done;
  }
}

async function run() {
  assert.equal(process.env.QA_RUN_M1, '1', 'Await Main readiness: explicitly set QA_RUN_M1=1 before running product tests');
  await access(entrypoint); // Build/install remains Backend/Main-owned.
  const port = await reservePortNumber();
  const origin = `http://127.0.0.1:${port}`;
  let token;
  do { token = randomBytes(48).toString('base64url'); }
  while (/replace|example|change|placeholder/i.test(token) || new Set(token).size < 8);
  const env = {
    ...isolatedEnvironment(), PROJEQTOR_MODE: 'mock', MCP_TRANSPORT: 'http',
    MCP_HOST: '127.0.0.1', MCP_PORT: String(port), MCP_BEARER_TOKEN: token,
    MCP_ALLOWED_ORIGINS: origin, ENABLE_WRITE: 'false',
    QA_RUN_M1: '1', QA_MCP_URL: `${origin}/mcp`, QA_MCP_TOKEN: token, QA_MCP_ORIGIN: origin,
  };
  // No --env-file and no inherited PROJEQTOR_*/MCP_*/NODE_OPTIONS credentials/hooks.
  const backend = startNode([entrypoint], env, ['ignore', 'pipe', 'pipe']);
  let logTail = '';
  const collect = (chunk) => { logTail = (logTail + chunk.toString('utf8')).slice(-16_384); };
  backend.child.stdout.on('data', collect);
  backend.child.stderr.on('data', collect);
  let tests;
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    tests?.child.kill('SIGTERM');
    backend.child.kill('SIGTERM');
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const deadline = Date.now() + 15_000;
    let ready = false;
    while (Date.now() < deadline && !interrupted) {
      if (backend.outcome) throw new Error('QA mock backend exited before readiness');
      try {
        const response = await fetch(`${origin}/health`, { redirect: 'error', signal: AbortSignal.timeout(700) });
        const body = await response.json();
        if (response.status === 200 && body.mode === 'mock') { ready = true; break; }
      } catch { /* Startup may not have bound its socket yet. */ }
      await pause(100);
    }
    assert.ok(ready && !interrupted && !backend.outcome, 'QA mock server did not become ready');
    console.log(`QA foundation runner: isolated mock server on ${origin}; writes disabled.`);
    tests = startNode(['--test', 'tests/integration/foundation.test.mjs'], env, ['ignore', 'inherit', 'inherit']);
    const outcome = await tests.done;
    if (outcome.error) throw outcome.error;
    assert.ok(!interrupted && !outcome.signal && outcome.code === 0, 'QA foundation acceptance did not pass');
  } catch (error) {
    const safeLogs = logTail.split(token).join('[REDACTED_QA_TOKEN]');
    if (safeLogs.trim()) console.error(`QA backend log tail:\n${safeLogs}`);
    throw error;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    await stop(tests);
    await stop(backend);
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
