import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { loadConfig } from '../dist/config.js';
import { startHttpServer } from '../dist/transports/http.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const inspector = process.argv.includes('--inspector');
assert.ok(process.argv.slice(2).every(arg => arg === '--inspector'), 'Usage: node scripts/smoke.mjs [--inspector]');
const timer = setTimeout(() => { console.error('Smoke test exceeded 45s'); process.exit(1); }, 45_000);
const stateDirectory = await mkdtemp(join(tmpdir(), 'projeqtor-smoke-state-'));
try {
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const token = randomBytes(32).toString('hex');
  const handle = await startHttpServer(loadConfig({ MCP_BEARER_TOKEN: token, MCP_PORT: String(port), MCP_STATE_DIR: stateDirectory }));
  try {
    for (const mode of ['legacy', 'auto']) {
      const client = new Client({ name: 'm1-smoke', version: '0.1.0' }, { versionNegotiation: { mode } });
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } }
        }));
        assert.equal(client.getProtocolEra(), mode === 'auto' ? 'modern' : 'legacy');
        const tools = await client.listTools(); assert.equal(tools.tools.length, 10);
        assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['analyze_workload', 'create_activity', 'get_activity', 'get_project', 'list_activities', 'list_activity_types', 'list_projects', 'list_resources', 'list_statuses']);
        assert.equal(tools.tools[0].name, 'list_projects');
        assert.equal(tools.tools[0].inputSchema.additionalProperties, false);
        assert.equal(tools.tools[0].annotations.readOnlyHint, true);
        const result = await client.callTool({ name: 'list_projects', arguments: {} });
        assert.ok(!result.isError); assert.equal(result.structuredContent.mode, 'mock');
        assert.equal(result.structuredContent.total, 2);
        assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
        const page = await client.callTool({ name: 'list_projects', arguments: { limit: 1, offset: 1 } });
        assert.equal(page.structuredContent.projects[0].id, 2);
        assert.equal(page.structuredContent.truncated, false);
        assert.equal((await client.callTool({ name: 'get_project', arguments: { id: 1 } })).structuredContent.project.id, 1);
        assert.equal((await client.callTool({ name: 'get_activity', arguments: { id: 101 } })).structuredContent.activity.realWork, 0);
        assert.equal((await client.callTool({ name: 'list_activities', arguments: { projectId: 1 } })).structuredContent.total, 2);
        assert.equal((await client.callTool({ name: 'list_resources', arguments: {} })).structuredContent.total, 2);
        assert.equal((await client.callTool({ name: 'analyze_workload', arguments: { projectId: 1 } })).structuredContent.activityCount, 2);
        await assert.rejects(client.callTool({ name: 'unknown_tool', arguments: {} }));
        for (const args of [{ limit: 0 }, { limit: '1' }, { offset: -1 }, { rawSql: '1=1' }, { approval: true }]) {
          let rejected = false;
          try { rejected = (await client.callTool({ name: 'list_projects', arguments: args })).isError === true; }
          catch { rejected = true; }
          assert.ok(rejected, `Invalid arguments accepted: ${JSON.stringify(args)}`);
        }
        console.log(JSON.stringify({ smoke: 'http', mode, era: client.getProtocolEra(), status: 'pass', projects: result.structuredContent.total }));
      } finally { await client.close(); }
    }
    if (inspector) {
      const run = promisify(execFile);
      const entry = fileURLToPath(new URL('../node_modules/@modelcontextprotocol/inspector/clients/launcher/build/index.js', import.meta.url));
      const storage = await mkdtemp(join(tmpdir(), 'projeqtor-m1-inspector-'));
      try {
        for (const method of ['tools/list', 'tools/call']) {
          const args = [entry, '--cli', `http://127.0.0.1:${port}/mcp`, '--transport', 'http',
            '--header', `Authorization: Bearer ${token}`, '--stored-auth-only', '--method', method, '--format', 'json'];
          if (method === 'tools/call') args.push('--tool-name', 'list_projects');
          let output;
          try {
            output = await run(process.execPath, args, { cwd: root, timeout: 15_000, windowsHide: true,
              env: { ...process.env, MCP_STORAGE_DIR: storage, MCP_INSPECTOR_OAUTH_STATE_PATH: join(storage, 'oauth.json') } });
            const { stdout, stderr } = output;
            const result = JSON.parse(stdout).result;
            if (method === 'tools/list') assert.equal(result.tools[0].name, 'list_projects');
            else { assert.ok(!result.isError); assert.equal(result.structuredContent.mode, 'mock'); }
            assert.ok(!stdout.includes(token) && !stderr.includes(token), 'Inspector exposed test token');
            console.log(JSON.stringify({ smoke: 'inspector', method, status: 'pass',
              ...(method === 'tools/list' ? { tools: result.tools.map(tool => tool.name) } : { mode: result.structuredContent.mode }) }));
          } catch (error) {
            console.error(String(error.message).replaceAll(token, '[REDACTED]'));
            for (const stream of ['stdout', 'stderr']) {
              const value = output?.[stream] ?? error[stream];
              if (typeof value === 'string' && value.trim()) console.error(value.replaceAll(token, '[REDACTED]'));
            }
            throw new Error(`Inspector ${method} failed; see redacted diagnostics above.`);
          }
        }
      } finally {
        assert.equal(dirname(resolve(storage)), resolve(tmpdir()));
        assert.ok(basename(storage).startsWith('projeqtor-m1-inspector-'));
        await rm(storage, { recursive: true, force: true });
      }
    }
  } finally { await handle.close(); }
  for (const mode of ['legacy', 'auto']) {
    const client = new Client({ name: 'm1-stdio-smoke', version: '0.1.0' }, { versionNegotiation: { mode } });
    const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/index.js', '--stdio'],
      cwd: root, env: { PROJEQTOR_MODE: 'mock', ENABLE_WRITE: 'false', MCP_STATE_DIR: stateDirectory }, stderr: 'pipe' });
    let logs = ''; transport.stderr?.on('data', chunk => { logs += chunk; });
    try {
      await client.connect(transport);
      assert.equal(client.getProtocolEra(), mode === 'auto' ? 'modern' : 'legacy');
      assert.equal((await client.listTools()).tools.length, 10);
      assert.equal((await client.callTool({ name: 'list_projects', arguments: {} })).structuredContent.mode, 'mock');
      assert.equal((await client.callTool({ name: 'get_project', arguments: { id: 1 } })).structuredContent.project.id, 1);
      assert.equal((await client.callTool({ name: 'get_activity', arguments: { id: 101 } })).structuredContent.activity.id, 101);
      assert.equal((await client.callTool({ name: 'list_activities', arguments: { projectId: 1 } })).structuredContent.total, 2);
      assert.equal((await client.callTool({ name: 'list_resources', arguments: {} })).structuredContent.total, 2);
      assert.equal((await client.callTool({ name: 'analyze_workload', arguments: { projectId: 1 } })).structuredContent.activityCount, 2);
      const records = logs.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      assert.ok(records.some(record => record.event === 'stdio_started'));
      assert.ok(records.every(record => record.event && record.timestamp));
      console.log(JSON.stringify({ smoke: 'stdio', mode, era: client.getProtocolEra(), status: 'pass', stderr: 'json-only' }));
    } finally { await client.close(); }
  }
} finally {
  clearTimeout(timer);
  assert.equal(dirname(resolve(stateDirectory)), resolve(tmpdir()));
  assert.ok(basename(stateDirectory).startsWith('projeqtor-smoke-state-'));
  await rm(stateDirectory, { recursive: true, force: true });
}
