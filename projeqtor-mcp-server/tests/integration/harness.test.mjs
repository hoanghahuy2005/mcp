import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { startFakeUpstream, fakeCredentials } from './support/fake-upstream.mjs';
import { createMcpHttpClient, rawHttp, readRpc, requireLoopbackUrl } from './support/mcp-http.mjs';
import { malformedApiError, syntheticLeakCanary } from './support/source-contract.mjs';

const auth = { Authorization: `Basic ${Buffer.from(`${fakeCredentials.username}:${fakeCredentials.password}`).toString('base64')}` };

test('QA fake serves source-shaped envelopes, validates routes and observes only synthetic auth', async (t) => {
  const upstream = await startFakeUpstream();
  t.after(() => upstream.close());
  const read = (route, headers = auth) => rawHttp(upstream.baseUrl + route, { method: 'GET', headers });
  assert.equal((await read('Project/all', {})).status, 401);
  const one = await read('Project/9');
  assert.equal(one.status, 200);
  assert.deepEqual(JSON.parse(one.text), { identifier: 'id', items: [{ id: '9', name: 'QLDA_Nhom9', idle: '0' }] });
  assert.deepEqual(JSON.parse((await read('Activity/9999')).text).items, []);
  assert.deepEqual(JSON.parse((await read('Activity/search/idProject=9')).text).items.map((item) => item.id), ['101', '102', '103']);
  assert.equal((await read('Cron/start')).status, 404);
  assert.equal((await read('Activity/search/idProject=9%20OR%201=1')).status, 404);
  assert.equal((await rawHttp(upstream.baseUrl + 'Activity', { headers: auth, body: '{}' })).status, 405);
  assert.equal(upstream.observations.filter((item) => item.method !== 'GET').length, 1);
  assert.ok(upstream.observations.some((item) => item.basicMatches));
  assert.ok(!JSON.stringify(upstream.observations).includes(fakeCredentials.password), 'Observer must not retain credential text');
});

test('QA fake exercises failure bodies independently of Backend', async (t) => {
  const upstream = await startFakeUpstream({ delayMs: 150, largeBytes: 4096 });
  t.after(() => upstream.close());
  const read = (options = {}) => rawHttp(upstream.baseUrl + 'Project/all', { method: 'GET', headers: auth, ...options });
  for (const status of ['401', '403', '500']) {
    await t.test(`HTTP ${status}`, async () => {
      upstream.setScenario('Project', status);
      assert.equal((await read()).status, Number(status));
    });
  }
  for (const scenario of ['api-error', 'source-error', 'html', 'invalid-json', 'wrong-envelope', 'empty', 'secrets']) {
    await t.test(scenario, async () => {
      upstream.setScenario('Project', scenario);
      const response = await read();
      assert.equal(response.status, 200);
      if (scenario === 'api-error') assert.equal(JSON.parse(response.text).error, 'invalid API query');
      if (scenario === 'source-error') { assert.equal(response.text, malformedApiError); assert.throws(() => JSON.parse(response.text)); }
      if (scenario === 'html' || scenario === 'invalid-json') assert.throws(() => JSON.parse(response.text));
      if (scenario === 'wrong-envelope') assert.ok(!Array.isArray(JSON.parse(response.text).items));
      if (scenario === 'empty') assert.deepEqual(JSON.parse(response.text).items, []);
      if (scenario === 'secrets') assert.ok(response.text.includes(syntheticLeakCanary));
    });
  }
  await t.test('timeout, response bound and non-following redirect', async () => {
    upstream.setScenario('Project', 'delay');
    await assert.rejects(read({ timeoutMs: 20 }));
    upstream.setScenario('Project', 'large');
    await assert.rejects(read({ maxBytes: 1000 }), /bound exceeded/);
    upstream.setScenario('Project', 'redirect');
    const count = upstream.observations.length;
    upstream.setRedirectTarget(upstream.baseUrl + 'Resource/all');
    const redirected = await read();
    assert.equal(redirected.status, 302);
    assert.equal(upstream.observations.length, count + 1, 'Probe must never follow upstream redirects');
    assert.throws(() => upstream.setRedirectTarget('https://example.com/api/'));
    assert.throws(() => upstream.setScenario('User', 'normal'));
  });
  await t.test('M2 adversarial envelopes and sanitized-error canary source', async () => {
    upstream.setScenario('Project', 'wrong-identifier');
    assert.equal(JSON.parse((await read()).text).identifier, 'password');
    upstream.setScenario('Project', 'invalid-item');
    assert.deepEqual(JSON.parse((await read()).text).items, [null, 'not-an-object']);
    upstream.setScenario('Project', 'error-secrets');
    assert.ok((await read()).text.includes(syntheticLeakCanary));
  });
  await t.test('M2 chunked byte limit and body deadline sources', async () => {
    upstream.setScenario('Project', 'chunked-large');
    const chunked = await read();
    assert.equal(chunked.headers['transfer-encoding'], 'chunked');
    assert.equal(chunked.headers['content-length'], undefined);
    assert.equal(JSON.parse(chunked.text).items[0].id, '9');
    await assert.rejects(read({ maxBytes: 1000 }), /bound exceeded/);
    upstream.setScenario('Project', 'slow-body');
    await assert.rejects(read({ timeoutMs: 20 }));
    upstream.setScenario('Project', 'disconnect');
    await assert.rejects(read());
  });
});

test('QA MCP reader handles JSON and arbitrarily fragmented SSE with UTF-8 and priming events', async () => {
  const result = { jsonrpc: '2.0', id: 11, result: { content: [{ type: 'text', text: 'Kế hoạch' }] } };
  assert.deepEqual(await readRpc(new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } }), 11), result);
  const encoded = Buffer.from(`:heartbeat\r\n\r\nid: prime\r\ndata:\r\n\r\ndata: {"jsonrpc":"2.0","method":"notifications/message","params":{}}\r\n\r\nevent: message\r\ndata: ${JSON.stringify(result)}\r\n\r\n`);
  const stream = new ReadableStream({ start(controller) {
    for (let index = 0; index < encoded.length; index += 3) controller.enqueue(encoded.subarray(index, index + 3));
    controller.close();
  } });
  assert.deepEqual(await readRpc(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }), 11), result);
  await assert.rejects(readRpc(new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } }), 12), /ID must match/);
  await assert.rejects(readRpc(new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } }), 11, 4), /bound exceeded/);
});

test('QA HTTP MCP client negotiates protocol, carries session and accepts SSE without SDK imports', async (t) => {
  const observed = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const message = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
    observed.push({ method: req.method, headers: req.headers, message });
    if (req.method === 'DELETE') { res.writeHead(204); return res.end(); }
    if (message.method === 'notifications/initialized') { res.writeHead(202); return res.end(); }
    if (message.method === 'initialize') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'qa-synthetic-session' });
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id,
        result: { protocolVersion: '2025-06-18', capabilities: { tools: {} },
          serverInfo: { name: 'QA harness only', version: '0' } } }));
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: [] } })}\n\n`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await closed;
  });
  const client = createMcpHttpClient({ url: `http://127.0.0.1:${server.address().port}/mcp`,
    token: 'qa-synthetic-token', origin: 'http://qa-allowed.invalid' });
  await client.initialize();
  assert.deepEqual((await client.request('tools/list')).result, { tools: [] });
  await client.close();
  assert.equal(observed.length, 4);
  for (const item of observed.slice(1)) {
    assert.equal(item.headers['mcp-session-id'], 'qa-synthetic-session');
    assert.equal(item.headers['mcp-protocol-version'], '2025-06-18');
    assert.equal(item.headers.authorization, 'Bearer qa-synthetic-token');
  }
  assert.equal(observed[2].headers.accept, 'application/json, text/event-stream');
});

test('QA helpers reject non-loopback and credential-bearing target URLs', () => {
  for (const url of ['https://example.com/mcp', 'http://localhost:8787/mcp',
    'http://127.0.0.1/mcp', 'http://user:pass@127.0.0.1:8787/mcp', 'http://127.0.0.1:8787/mcp#fragment']) {
    assert.throws(() => requireLoopbackUrl(url));
  }
});
