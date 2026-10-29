import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpHttpClient, rawHttp, requireLoopbackUrl } from './support/mcp-http.mjs';

// Gate intentionally remains closed until Main accepts a concrete M1 interface.
const enabled = process.env.QA_RUN_M1 === '1';
test('M1 blackbox transport and boundary acceptance', { skip: !enabled && 'Await Main M1 gate; set QA_RUN_M1=1 explicitly' }, async (t) => {
  const url = requireLoopbackUrl(process.env.QA_MCP_URL);
  assert.equal(url.pathname, '/mcp');
  assert.ok(!url.search, 'Unexpected MCP query parameters');
  const token = process.env.QA_MCP_TOKEN;
  assert.ok(token && token.length >= 16, 'Provide an isolated mock server token via QA_MCP_TOKEN');
  const origin = process.env.QA_MCP_ORIGIN;
  const health = await rawHttp(new URL('/health', url), { method: 'GET' });
  assert.equal(health.status, 200);
  const healthBody = JSON.parse(health.text);
  assert.equal(healthBody.mode, 'mock', 'This initial acceptance suite must only target Mock Mode');
  assert.ok(!health.text.includes(token), 'Health leaked the MCP token');

  await t.test('missing/wrong bearer rejected on POST, GET and DELETE', async () => {
    for (const method of ['POST', 'GET', 'DELETE']) {
      for (const authorization of [undefined, 'Bearer qa-intentionally-wrong-token']) {
        const response = await rawHttp(url, { method, headers: {
          Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json',
          ...(authorization ? { Authorization: authorization } : {}),
        }, ...(method === 'POST' ? { body: '{}' } : {}) });
        assert.ok([401, 403].includes(response.status), `${method} accepted unauthorized request`);
        assert.ok(!response.text.includes(token));
      }
    }
  });

  await t.test('hostile Host/Origin rejected before MCP processing', async () => {
    const base = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream' };
    for (const method of ['POST', 'GET', 'DELETE']) {
      for (const hostile of [
        { Host: 'attacker.invalid' }, { Host: `127.0.0.1.attacker.invalid:${url.port}` },
        { Origin: 'https://attacker.invalid' }, { Origin: 'null' },
        { Origin: `http://127.0.0.1:${url.port}.attacker.invalid` },
      ]) {
        const response = await rawHttp(url, { method, headers: { ...base, ...hostile },
          ...(method === 'POST' ? { body: '{}' } : {}) });
        assert.equal(response.status, 403, `${method} did not reject hostile boundary header`);
        assert.ok(!response.text.includes(token));
      }
    }
  });

  await t.test('initialize, list tools and call list_projects over actual HTTP', async () => {
    const client = createMcpHttpClient({ url, token, origin });
    t.after(() => client.close());
    await client.initialize();
    const listed = await client.request('tools/list');
    assert.ok(Array.isArray(listed.result?.tools));
    const tool = listed.result.tools.find((item) => item.name === 'list_projects');
    assert.ok(tool, 'M1 must expose list_projects');
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.inputSchema?.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false, 'Advertised M1 schema must reject extra arguments');
    const result = await client.request('tools/call', { name: 'list_projects', arguments: {} });
    assert.ok(result.result && !result.result.isError, 'list_projects must succeed');
    assert.ok(Array.isArray(result.result.content));
    const data = result.result.structuredContent;
    assert.equal(data?.mode, 'mock');
    assert.ok(Array.isArray(data.projects), 'M1 must return the projects collection');
    assert.ok(Number.isInteger(data.total) && data.total >= data.projects.length);
    assert.equal(data.limit, 50, 'M1 default limit is 50');
    assert.equal(data.offset, 0, 'M1 default offset is zero');
    assert.equal(typeof data.truncated, 'boolean');
    assert.ok(!JSON.stringify(result).includes(token));
    const unknown = await client.request('tools/call', { name: 'qa_nonexistent_tool', arguments: {} });
    assert.ok(unknown.error || unknown.result?.isError, 'Unknown tool must fail');
    for (const arguments_ of [
      { qaUnexpectedProperty: true }, { rawSql: '1=1' },
      { upstreamUrl: 'https://attacker.invalid' }, { approval: true },
    ]) {
      const extra = await client.request('tools/call', { name: 'list_projects', arguments: arguments_ });
      assert.ok(extra.error || extra.result?.isError,
        `M1 schema accepted unexpected argument ${Object.keys(arguments_)[0]}`);
    }
  });
});
