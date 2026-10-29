import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { loadConfig } from '../../dist/config.js';
import { createHttpServer, MAX_REQUEST_BODY_BYTES } from '../../dist/transports/http.js';

test('HTTP boundary rejects hostile requests before protocol handling', async t => {
  const token = randomBytes(32).toString('hex');
  const handle = createHttpServer(loadConfig({ MCP_BEARER_TOKEN: token }));
  handle.server.listen(0, '127.0.0.1'); await once(handle.server, 'listening');
  t.after(() => handle.close());
  const probe = (method, path = '/mcp', headers = {}, chunks = []) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: handle.server.address().port, path, method, agent: false,
      headers: { Host: '127.0.0.1:8787', ...headers } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject); for (const chunk of chunks) req.write(chunk); req.end();
  });
  const auth = { Authorization: `Bearer ${token}` };
  await t.test('health exposes only readiness and explicit mock mode', async () => {
    const r = await probe('GET', '/health'); assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), { status: 'ok', mode: 'mock' });
    assert.ok(!r.body.includes(token));
  });
  await t.test('missing, wrong, duplicate bearer denied on every MCP method', async () => {
    for (const method of ['GET', 'POST', 'DELETE']) {
      for (const headers of [{}, { Authorization: 'Bearer incorrect' }, { Authorization: [`Bearer ${token}`, `Bearer ${token}`] }]) {
        assert.equal((await probe(method, '/mcp', headers)).status, 401);
      }
    }
  });
  await t.test('exact host including port, exact origin including scheme and port', async () => {
    for (const headers of [{ Host: 'attacker.invalid' }, { Host: '127.0.0.1:8788' }, { Host: 'localhost.evil:8787' },
      { Origin: 'http://localhost:8788' }, { Origin: 'https://localhost:8787' }, { Origin: 'null' },
      { Origin: ['http://localhost:8787', 'http://localhost:8787'] }]) {
      assert.equal((await probe('POST', '/mcp', { ...auth, ...headers })).status, 403);
    }
    assert.equal((await probe('GET', '/health', { Origin: 'http://localhost:8787' })).status, 200);
  });
  await t.test('boundary rejection logs only a safe reason code', async () => {
    const output = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = chunk => { output.push(String(chunk)); return true; };
    try { assert.equal((await probe('POST', '/oauth/login', { Origin: 'https://attacker.invalid' })).status, 403); }
    finally { process.stderr.write = originalWrite; }
    const event = output.map(line => { try { return JSON.parse(line); } catch { return undefined; } })
      .find(value => value?.event === 'http_rejected');
    assert.deepEqual({ event: event?.event, status: event?.status, reason: event?.reason },
      { event: 'http_rejected', status: 403, reason: 'origin_not_allowed' });
    assert.equal(Object.hasOwn(event ?? {}, 'origin'), false);
    assert.equal(Object.hasOwn(event ?? {}, 'host'), false);
  });
  await t.test('stateless authenticated GET and DELETE return 405', async () => {
    for (const method of ['GET', 'DELETE']) assert.equal((await probe(method, '/mcp', auth)).status, 405);
  });
  await t.test('malformed JSON is protocol-safe and contains no secret', async () => {
    const r = await probe('POST', '/mcp', { ...auth, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, ['{']);
    assert.equal(r.status, 400); assert.ok(!r.body.includes(token)); assert.ok(!r.body.includes('stack'));
  });
  await t.test('declared and chunked oversized request bodies return 413', async () => {
    assert.equal((await probe('POST', '/mcp', { ...auth, 'Content-Length': MAX_REQUEST_BODY_BYTES + 1 })).status, 413);
    assert.equal((await probe('POST', '/mcp', { ...auth, 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' }, ['x'.repeat(MAX_REQUEST_BODY_BYTES + 1)])).status, 413);
  });
  await t.test('unknown routes and query tokens do not authenticate', async () => {
    assert.equal((await probe('GET', '/unknown')).status, 404);
    assert.equal((await probe('POST', `/mcp?token=${token}`)).status, 404);
    assert.equal((await probe('PUT', '/mcp', auth)).status, 405);
  });
});
