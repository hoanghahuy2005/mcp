import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../dist/config.js';
import { startHttpServer } from '../../dist/transports/http.js';
import { createMcpHttpClient } from './support/mcp-http.mjs';
import { availablePort } from './support/m2-process.mjs';

async function harness(t, overrides = {}) {
  const stateDirectory = await mkdtemp(join(tmpdir(), 'projeqtor-direct-integration-'));
  const token = randomBytes(32).toString('hex');
  const port = await availablePort();
  const handle = await startHttpServer(loadConfig({ MCP_BEARER_TOKEN: token, MCP_PORT: String(port),
    MCP_STATE_DIR: stateDirectory, ENABLE_WRITE: 'true', ...overrides }));
  const client = createMcpHttpClient({ url: `http://127.0.0.1:${port}/mcp`, token });
  await client.initialize();
  t.after(async () => { await client.close(); await handle.close(); await rm(stateDirectory, { recursive: true, force: true }); });
  return { client, call: async (name, args = {}) => (await client.request('tools/call', { name, arguments: args })).result };
}

test('tool discovery exposes direct create and no proposal workflow', async t => {
  const app = await harness(t);
  const catalog = (await app.client.request('tools/list')).result.tools;
  const tools = catalog.map(tool => tool.name);
  assert.ok(tools.includes('create_activity'));
  assert.ok(!tools.includes('delete_activity'), 'Mock Mode must never expose real deletion');
  assert.ok(!tools.includes('preview_create_activity'));
  assert.ok(!tools.some(name => name.includes('proposal') || name.includes('approve')));
  const properties = catalog.find(tool => tool.name === 'create_activity').inputSchema.properties;
  assert.equal(properties.startDate.type, 'string');
  assert.equal(properties.endDate.type, 'string');
  assert.ok(!catalog.find(tool => tool.name === 'create_activity').inputSchema.required.includes('startDate'));
  assert.ok(!catalog.find(tool => tool.name === 'create_activity').inputSchema.required.includes('endDate'));
});

test('one create_activity call persists a mock Activity', async t => {
  const app = await harness(t);
  const created = await app.call('create_activity', { projectId: 1, name: 'Integration direct create',
    startDate: '2026-11-02', endDate: '2026-11-06' });
  assert.equal(created.isError, undefined);
  assert.equal(created.structuredContent.persisted, true);
  assert.equal(created.structuredContent.activity.name, 'Integration direct create');
  assert.equal(created.structuredContent.activity.startDate, '2026-11-02');
  assert.equal(created.structuredContent.activity.endDate, '2026-11-06');
  const read = await app.call('get_activity', { id: created.structuredContent.activity.id });
  assert.equal(read.structuredContent.activity.name, 'Integration direct create');
  assert.equal(read.structuredContent.activity.startDate, '2026-11-02');
  assert.equal(read.structuredContent.activity.endDate, '2026-11-06');
});
