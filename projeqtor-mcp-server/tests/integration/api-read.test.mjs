import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { startFakeUpstream } from './support/fake-upstream.mjs';
import { sourceData } from './support/source-contract.mjs';
import { createMcpHttpClient } from './support/mcp-http.mjs';
import { startRealModeAgainstFake } from './support/m2-process.mjs';

const enabled = process.env.QA_RUN_M2 === '1';
const tools = [
  { name: 'list_projects', className: 'Project', collection: 'projects', arguments: {} },
  { name: 'get_project', className: 'Project', singular: 'project', arguments: { id: 9 } },
  { name: 'list_activities', className: 'Activity', collection: 'activities', arguments: {} },
  { name: 'get_activity', className: 'Activity', singular: 'activity', arguments: { id: 101 } },
  { name: 'list_resources', className: 'Resource', collection: 'resources', arguments: {} },
  { name: 'list_activity_types', className: 'ActivityType', collection: 'activityTypes', arguments: {} },
  { name: 'list_statuses', className: 'Status', collection: 'statuses', arguments: {} },
];

test('M2 seven direct read tools against independent synthetic upstream only', {
  skip: !enabled && 'Await Main M2 readiness; explicitly set QA_RUN_M2=1', timeout: 45_000,
}, async (t) => {
  const data = sourceData();
  data.Project[0].idStatus = '1';
  data.Project[0].description = 'Độc lập QA – source envelope';
  const fake = await startFakeUpstream({ data, delayMs: 1200, largeBytes: 20_000 });
  let fakeClosed = false;
  let backend;
  let client;
  let sink;
  t.after(async () => {
    const errors = [];
    const cleanup = async (action) => { try { await action(); } catch (error) { errors.push(error); } };
    await cleanup(async () => client?.close());
    await cleanup(async () => backend?.close());
    await cleanup(async () => backend?.assertLogsSanitized());
    await cleanup(async () => { if (!fakeClosed) await fake.close(); });
    await cleanup(async () => {
      if (!sink?.listening) return;
      const done = new Promise((resolve) => sink.close(resolve));
      sink.closeAllConnections();
      await done;
    });
    if (errors.length) throw new AggregateError(errors, 'M2 QA cleanup/log verification failed');
  });
  const sinkRequests = [];
  sink = http.createServer((req, res) => {
    sinkRequests.push({ method: req.method, authorizationPresent: Boolean(req.headers.authorization) });
    req.resume();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"identifier":"id","items":[]}');
  });
  sink.listen(0, '127.0.0.1');
  await once(sink, 'listening');
  fake.setRedirectTarget(`http://127.0.0.1:${sink.address().port}/redirect-sink`);
  backend = await startRealModeAgainstFake(fake.baseUrl);
  client = createMcpHttpClient({ url: backend.url, token: backend.token, origin: backend.origin });
  await client.initialize();
  console.log(`QA M2: Real Mode client -> synthetic upstream only; backend port ${backend.port}; writes disabled.`);

  async function call(name, arguments_ = {}) {
    const response = await client.request('tools/call', { name, arguments: arguments_ });
    backend.assertSanitized(response);
    return response;
  }
  async function success(name, arguments_ = {}) {
    const response = await call(name, arguments_);
    assert.ok(!response.error && response.result && !response.result.isError, `${name} should succeed`);
    assert.ok(Array.isArray(response.result.content));
    const output = response.result.structuredContent;
    assert.equal(output?.mode, 'real', `${name} returned missing/wrong mode or mock fallback`);
    return output;
  }
  async function upstreamError(tool, scenario) {
    const response = await call(tool.name, tool.arguments);
    assert.equal(response.result?.isError, true, `${tool.name}/${scenario} must return a tool error, never fallback success`);
    assert.ok(response.result.content.some((item) => item.type === 'text' && item.text.length > 0));
    const text = JSON.stringify(response);
    assert.ok(!text.includes('"mode":"mock"'));
    assert.ok(!text.includes('QLDA_Nhom9'), 'Upstream failure must not expose fixture project results');
    assert.ok(!text.includes('/private/stack.php'), 'Do not return upstream stack/path details');
    for (const key of ['projects', 'activities', 'resources', 'project', 'activity']) {
      assert.ok(!Object.hasOwn(response.result.structuredContent ?? {}, key), 'Error must not carry success records');
    }
  }
  function page(output, key, ids, { total, limit, offset, truncated }) {
    assert.ok(Array.isArray(output[key]));
    assert.deepEqual(output[key].map((item) => item.id), ids);
    for (const id of ids) assert.ok(Number.isSafeInteger(id) && id > 0);
    assert.equal(output.total, total);
    assert.equal(output.limit, limit);
    assert.equal(output.offset, offset);
    assert.equal(output.truncated, truncated);
  }

  await t.test('complete write-tool discovery with strict schemas', async () => {
    const response = await client.request('tools/list');
    backend.assertSanitized(response);
    assert.deepEqual(response.result.tools.map((tool) => tool.name).sort(),
      [...tools.map(tool => tool.name), 'analyze_workload', 'create_activity', 'delete_activity'].sort());
    for (const tool of response.result.tools) {
      assert.equal(tool.annotations?.readOnlyHint, !['create_activity', 'delete_activity'].includes(tool.name));
      assert.equal(tool.inputSchema?.type, 'object');
      assert.equal(tool.inputSchema.additionalProperties, false);
    }
    const deletion = response.result.tools.find(tool => tool.name === 'delete_activity');
    assert.equal(deletion.annotations?.destructiveHint, true);
    assert.equal(deletion.inputSchema.properties.activityId.type, 'integer');
    assert.equal(deletion.inputSchema.properties.confirmed.type, 'boolean');
    assert.ok(deletion.inputSchema.required.includes('confirmed'));
  });

  await t.test('source-shaped list/get envelopes, numeric IDs, Unicode and exact Basic GET routes', async () => {
    const start = fake.observations.length;
    const projects = await success('list_projects');
    page(projects, 'projects', [9, 10], { total: 2, limit: 50, offset: 0, truncated: false });
    const project = (await success('get_project', { id: 9 })).project;
    assert.equal(project.id, 9);
    assert.equal(project.idStatus, 1);
    assert.equal(project.description, data.Project[0].description);
    assert.equal(project.name, 'QLDA_Nhom9');
    const activities = await success('list_activities');
    page(activities, 'activities', [101, 102, 103, 104], { total: 4, limit: 50, offset: 0, truncated: false });
    const activity = (await success('get_activity', { id: 101 })).activity;
    assert.equal(activity.id, 101);
    assert.equal(activity.idProject, 9);
    assert.equal(activity.name, data.Activity[0].name);
    const resources = await success('list_resources');
    page(resources, 'resources', [11, 12], { total: 2, limit: 50, offset: 0, truncated: false });
    page(await success('list_activity_types'), 'activityTypes', [1, 2], { total: 2, limit: 50, offset: 0, truncated: false });
    page(await success('list_statuses'), 'statuses', [1, 2], { total: 2, limit: 50, offset: 0, truncated: false });
    const observed = fake.observations.slice(start);
    for (const route of ['/api/Project/all', '/api/Project/9', '/api/Activity/all', '/api/Activity/101', '/api/Resource/all', '/api/ActivityType/all', '/api/Status/all']) {
      assert.ok(observed.some((item) => item.path === route && item.query === '' && item.method === 'GET' && item.basicMatches),
        `Missing exact allowlisted GET/Basic request ${route}`);
    }
  });

  await t.test('filter before client pagination; explicit totals and truncation', async () => {
    page(await success('list_projects', { limit: 1, offset: 1 }), 'projects', [10],
      { total: 2, limit: 1, offset: 1, truncated: false });
    page(await success('list_resources', { limit: 1, offset: 0 }), 'resources', [11],
      { total: 2, limit: 1, offset: 0, truncated: true });
    page(await success('list_activities', { projectId: 9, limit: 1, offset: 1 }), 'activities', [102],
      { total: 3, limit: 1, offset: 1, truncated: true });
    page(await success('list_activities', { projectId: 10 }), 'activities', [104],
      { total: 1, limit: 50, offset: 0, truncated: false });
    page(await success('list_activities', { projectId: 9999 }), 'activities', [],
      { total: 0, limit: 50, offset: 0, truncated: false });
    page(await success('list_projects', { limit: 1, offset: 10 }), 'projects', [],
      { total: 2, limit: 1, offset: 10, truncated: false });
    const last = decodeURIComponent(fake.observations.at(-1).path);
    assert.equal(last, '/api/Project/all', 'Unverified upstream limit/offset routes must not be invented');
  });

  await t.test('empty lists and absent single records do not become fixture data', async () => {
    for (const tool of tools.filter((item) => item.collection)) {
      fake.setScenario(tool.className, 'empty');
      page(await success(tool.name), tool.collection, [], { total: 0, limit: 50, offset: 0, truncated: false });
      fake.setScenario(tool.className, 'normal');
    }
    for (const tool of tools.filter((item) => item.singular)) {
      const result = await call(tool.name, { id: 9999 });
      if (!result.result?.isError) {
        assert.ok(!result.error, 'Unknown ID should be a tool-level absence/error, not protocol failure');
        assert.equal(result.result.structuredContent?.mode, 'real');
        assert.equal(result.result.structuredContent[tool.singular], null, 'Absent record must be explicit null or a tool error');
      }
    }
  });

  await t.test('invalid IDs, pagination and model-controlled extra args issue zero upstream requests', async () => {
    const before = fake.observations.length;
    const invalid = [
      ...['get_project', 'get_activity'].flatMap((name) => [0, -1, 1.5, '9', null, 9_007_199_254_740_992]
        .map((id) => ({ name, args: { id } }))),
      ...[0, -1, 1.5, '9', null, 9_007_199_254_740_992]
        .map((activityId) => ({ name: 'delete_activity', args: { activityId, confirmed: true } })),
      ...tools.map((tool) => ({ name: tool.name, args: { ...tool.arguments, approval: true } })),
      { name: 'list_activities', args: { projectId: '9 OR 1=1' } },
      { name: 'list_activities', args: { projectId: 0 } },
      { name: 'list_activities', args: { projectId: -1 } },
      { name: 'list_activities', args: { projectId: 9_007_199_254_740_992 } },
      { name: 'list_projects', args: { rawSql: '1=1' } },
      { name: 'list_resources', args: { upstreamUrl: `http://127.0.0.1:${sink.address().port}/tool-input-must-not-control-upstream` } },
      ...tools.filter((tool) => tool.collection).flatMap((tool) => [
        { name: tool.name, args: { limit: 0 } }, { name: tool.name, args: { limit: 101 } },
        { name: tool.name, args: { offset: -1 } }, { name: tool.name, args: { offset: '1' } },
      ]),
    ];
    for (const { name, args } of invalid) {
      const response = await call(name, args);
      assert.ok(response.error || response.result?.isError, `${name} accepted invalid input`);
    }
    assert.equal(fake.observations.length, before, 'Validation failures must never reach upstream');
  });

  await t.test('public outputs strip untrusted secret/hidden/unexpected fields for all direct read tools', async () => {
    for (const tool of tools) {
      fake.setScenario(tool.className, 'secrets');
      const result = await success(tool.name, tool.arguments);
      const records = tool.collection ? result[tool.collection] : [result[tool.singular]];
      for (const record of records) {
        for (const key of ['password', 'apiKey', '_internal', 'unexpectedSecret']) assert.ok(!Object.hasOwn(record, key));
      }
      fake.setScenario(tool.className, 'normal');
    }
  });

  for (const scenario of ['401', '403', '500', 'api-error', 'source-error', 'html', 'invalid-json',
    'wrong-envelope', 'wrong-identifier', 'invalid-item', 'error-secrets', 'delay', 'slow-body',
    'large', 'chunked-large', 'redirect', 'disconnect']) {
    await t.test(`upstream ${scenario}: sanitized errors, no mock fallback for all direct read tools`, async () => {
      for (const tool of tools) {
        fake.setScenario(tool.className, scenario);
        await upstreamError(tool, scenario);
        fake.setScenario(tool.className, 'normal');
      }
      assert.equal(sinkRequests.length, 0, 'Redirects must never be followed, even to a separate local sink');
    });
  }

  await t.test('upstream connection refusal remains an error for all direct read tools', async () => {
    await fake.close();
    fakeClosed = true;
    for (const tool of tools) await upstreamError(tool, 'connection-refused');
  });

  await t.test('every observed upstream call is allowlisted GET with exact synthetic Basic auth; no secret logs', () => {
    for (const observed of fake.observations) {
      const route = decodeURIComponent(observed.path);
      assert.equal(observed.method, 'GET', 'No upstream write method is authorized in M2');
      assert.equal(observed.basicMatches, true, 'Local bearer must never replace/augment upstream Basic auth');
      assert.equal(observed.query, '', 'No unverified pagination/query-string contract');
      assert.match(route, /^\/api\/(Project|Activity|Resource|ActivityType|Status)\/(all|[1-9]\d*|search\/idProject=[1-9]\d*)$/);
    }
    assert.equal(sinkRequests.length, 0);
    backend.assertLogsSanitized();
  });
});
