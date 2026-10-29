import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { fake, envelope, data, secret } from './fake.mjs';
import { decryptProjeqtorData } from '../../dist/clients/projeqtor-crypto.js';

const fails = (action, code) => assert.rejects(action, error => error.code === code && !error.message.includes(secret));

test('REST reads use only fixed GET routes and Basic; normalize and strip hidden/secret fields', async t => {
  const { client, observations } = await fake(t);
  assert.equal(observations.length, 0, 'construction must not contact any upstream');
  const projects = await client.listProjects(1, 0);
  assert.deepEqual(projects, { mode: 'real', total: 2, limit: 1, offset: 0, truncated: true,
    projects: [{ id: 9, name: 'Unit project', description: null, idStatus: 1 }] });
  assert.equal((await client.getProject(9)).project.id, 9);
  assert.equal((await client.getProject(999)).project, null);
  assert.equal((await client.listActivities(50, 0)).total, 2);
  const activity = (await client.listActivities(50, 0, 9)).activities[0];
  assert.equal(activity.id, 41); assert.equal(activity.idStatus, null);
  assert.equal(activity.startDate, '2026-11-02'); assert.equal(activity.endDate, '2026-11-06');
  assert.equal(activity.plannedWork, 2.75); assert.equal(activity.realWork, 0); assert.equal(activity.leftWork, null);
  assert.equal((await client.getActivity(41)).activity.id, 41);
  assert.equal((await client.getActivity(999)).activity, null);
  assert.deepEqual((await client.listResources(50, 0)).resources, [{ id: 11, name: 'Unit person' }, { id: 12, name: null }]);
  assert.equal((await client.listAssignments())[0].plannedWork, 1.25);
  assert.equal((await client.listAssignments(9))[0].leftWork, null);
  assert.equal((await client.listAssignments(10)).length, 0);
  assert.deepEqual((await client.listActivityTypes(50, 0)).activityTypes, [{ id: 2, name: 'Unit activity type' }]);
  assert.deepEqual((await client.listStatuses(50, 0)).statuses, [{ id: 1, name: 'Unit status' }]);
  assert.equal((await client.listProjects(50, 100)).projects.length, 0);
  assert.ok(!JSON.stringify({ projects, activity }).includes(secret));
  assert.ok(observations.every(row => row.method === 'GET' && row.basicMatches && !row.hasSession));
  assert.deepEqual([...new Set(observations.map(row => row.path))], ['/api/Project/all', '/api/Project/9', '/api/Project/999',
    '/api/Activity/all', '/api/Activity/search/idProject=9', '/api/Activity/41', '/api/Activity/999', '/api/Resource/all',
    '/api/Assignment/all', '/api/Assignment/search/idProject=9', '/api/Assignment/search/idProject=10',
    '/api/ActivityType/all', '/api/Status/all']);
});

test('project scope is checked locally even when upstream search returns foreign rows', async t => {
  const { client } = await fake(t, (req, res) => res.end(envelope(req.url.includes('Assignment') ? [
    ...data.Assignment, { ...data.Assignment[0], id: '72', idProject: '10' }
  ] : data.Activity)));
  assert.equal((await client.listActivities(50, 0, 9)).total, 1);
  assert.equal((await client.listAssignments(9)).length, 1);
});

for (const status of [401, 403, 404, 500, 503]) test(`upstream HTTP ${status} fails without body leakage or fallback`, async t => {
  const { client } = await fake(t, (_req, res) => { res.writeHead(status); res.end(secret); });
  await fails(client.listProjects(50, 0), 'UPSTREAM_HTTP_ERROR');
});

const invalidBodies = [
  JSON.stringify({ error: 'invalid API query', message: secret }),
  '{"error":"invalid API query", "message":""user disabled""}',
  '<html>Login required</html>', '{invalid JSON', 'null', '[]',
  JSON.stringify({ identifier: 'other', items: [] }), JSON.stringify({ items: [] }),
  JSON.stringify({ identifier: 'id', items: {} }),
  JSON.stringify({ identifier: 'id', items: [], error: secret }),
  envelope([null]), envelope([[]]), envelope([{ id: '', name: 'bad' }]),
  envelope([{ id: '0', name: 'bad' }]), envelope([{ id: '9007199254740992', name: 'bad' }]),
  envelope([{ id: '1', name: {} }]), envelope([{ id: '1', name: 'A' }, { id: '1', name: 'B' }])
];
for (let i = 0; i < invalidBodies.length; i++) test(`reject malformed/error/envelope/identity response ${i + 1}`, async t => {
  const { client } = await fake(t, (_req, res) => res.end(invalidBodies[i]));
  await fails(client.listProjects(50, 0), [0, 9].includes(i) ? 'UPSTREAM_API_ERROR' : 'UPSTREAM_INVALID_RESPONSE');
});

test('HTML content type is rejected even if the body looks like an API envelope', async t => {
  const { client } = await fake(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(envelope([])); });
  await fails(client.listProjects(50, 0), 'UPSTREAM_INVALID_RESPONSE');
});

test('single lookup rejects unrelated or multiple records instead of choosing one', async t => {
  let rows = data.Project;
  const { client } = await fake(t, (_req, res) => res.end(envelope(rows)));
  await fails(client.getProject(9), 'UPSTREAM_INVALID_RESPONSE');
  rows = [data.Project[1]];
  await fails(client.getProject(9), 'UPSTREAM_INVALID_RESPONSE');
});

test('redirect target receives zero requests and no credentials', async t => {
  const sink = await fake(t);
  const upstream = await fake(t, (_req, res) => { res.writeHead(302, { Location: `${sink.config.upstream.baseUrl}Project/all` }); res.end(); });
  await fails(upstream.client.listProjects(50, 0), 'UPSTREAM_REDIRECT');
  assert.equal(sink.observations.length, 0);
  assert.equal(upstream.observations.length, 1, 'no retry');
});

test('timeout covers headers and a body that stalls after headers', async t => {
  for (const headersFirst of [false, true]) {
    const upstream = await fake(t, (_req, res) => {
      if (headersFirst) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"identifier":"id","items":['); }
    }, { PROJEQTOR_TIMEOUT_MS: '50' });
    await fails(upstream.client.listProjects(50, 0), 'UPSTREAM_TIMEOUT');
  }
});

test('byte bound covers declared, chunked and decompressed responses', async t => {
  for (const kind of ['declared', 'chunked', 'gzip']) {
    const upstream = await fake(t, (_req, res) => {
      const body = envelope([{ id: '9', name: 'x'.repeat(1024) }]);
      if (kind === 'declared') { res.writeHead(200, { 'Content-Length': Buffer.byteLength(body) }); res.end(body); }
      if (kind === 'chunked') { res.write(body.slice(0, 200)); res.end(body.slice(200)); }
      if (kind === 'gzip') { res.writeHead(200, { 'Content-Encoding': 'gzip' }); res.end(gzipSync(body)); }
    }, { PROJEQTOR_MAX_RESPONSE_BYTES: '256' });
    await fails(upstream.client.listProjects(50, 0), 'UPSTREAM_RESPONSE_LIMIT');
  }
});

test('collection cap fails explicitly rather than giving an incomplete total', async t => {
  const { client } = await fake(t, (_req, res) => res.end(envelope(Array.from({ length: 10001 }, (_, i) => ({ id: String(i + 1), name: 'A' })))));
  await fails(client.listProjects(1, 0), 'UPSTREAM_COLLECTION_LIMIT');
});

test('connection failure is sanitized and never returns mock projects', async t => {
  const { client, server } = await fake(t);
  await new Promise(resolve => server.close(resolve));
  await fails(client.listProjects(50, 0), 'UPSTREAM_UNAVAILABLE');
});

test('real Activity create sends only encrypted urlencoded data and validates one OK result', async t => {
  const apiKey = '0123456789abcdef0123456789abcdef';
  let wire = '';
  const { client, observations } = await fake(t, async (req, res) => {
    wire = Buffer.concat(await Array.fromAsync(req)).toString('utf8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(envelope([{ apiResult: 'OK', id: '501', name: 'Thiết kế cơ sở dữ liệu' }]));
  }, { ENABLE_WRITE: 'true', ENABLE_REAL_WRITE: 'true', PROJEQTOR_API_KEY: apiKey, PROJEQTOR_AES_KEY_LENGTH: '256' });
  const input = { projectId: 9, name: 'Thiết kế cơ sở dữ liệu', description: 'Tiếng Việt',
    activityTypeId: 2, statusId: 1, creationDate: '2026-10-28',
    startDate: '2026-11-02', endDate: '2026-11-06' };
  assert.deepEqual(await client.createActivity(input), {
    id: 501, name: input.name, description: input.description, idProject: 9, idStatus: 1,
    idResource: null, idActivityType: 2, creationDate: '2026-10-28',
    startDate: '2026-11-02', endDate: '2026-11-06',
    plannedWork: null, realWork: null, leftWork: null
  });
  assert.equal(observations[0].method, 'POST');
  assert.equal(observations[0].path, '/api/Activity');
  assert.equal(observations[0].basicMatches, true);
  assert.ok(!wire.includes(input.name));
  const encoded = new URLSearchParams(wire).get('data');
  assert.ok(encoded);
  assert.deepEqual(JSON.parse(decryptProjeqtorData(encoded, apiKey, 256)), {
    name: input.name, idProject: 9, idActivityType: 2, idStatus: 1,
    creationDate: '2026-10-28', initialStartDate: '2026-11-02', initialEndDate: '2026-11-06',
    description: 'Tiếng Việt'
  });
});

test('real Activity delete sends an encrypted ID and accepts one OK result', async t => {
  const apiKey = '0123456789abcdef0123456789abcdef';
  let wire = '';
  const { client, observations } = await fake(t, async (req, res) => {
    wire = Buffer.concat(await Array.fromAsync(req)).toString('utf8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(envelope([{ apiResult: 'OK', id: '' }]));
  }, { ENABLE_WRITE: 'true', ENABLE_REAL_WRITE: 'true', PROJEQTOR_API_KEY: apiKey, PROJEQTOR_AES_KEY_LENGTH: '256' });
  await client.deleteActivity(41);
  assert.equal(observations[0].method, 'DELETE');
  assert.equal(observations[0].path, '/api/Activity');
  assert.equal(observations[0].basicMatches, true);
  const encoded = new URLSearchParams(wire).get('data');
  assert.ok(encoded);
  assert.deepEqual(JSON.parse(decryptProjeqtorData(encoded, apiKey, 256)), { id: 41 });
});

test('real Activity delete sanitizes an upstream rejection', async t => {
  const { client } = await fake(t, async (req, res) => {
    await Array.fromAsync(req);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(envelope([{ apiResult: 'KO', apiResultMessage: secret }]));
  }, { ENABLE_WRITE: 'true', ENABLE_REAL_WRITE: 'true',
    PROJEQTOR_API_KEY: '0123456789abcdef0123456789abcdef', PROJEQTOR_AES_KEY_LENGTH: '128' });
  await assert.rejects(client.deleteActivity(41), error =>
    error.code === 'UPSTREAM_DELETE_REJECTED' && !error.message.includes(secret));
});

for (const [label, rows] of [
  ['empty result', []],
  ['multiple results', [{ apiResult: 'OK', id: '501' }, { apiResult: 'OK', id: '502' }]],
  ['KO result', [{ apiResult: 'KO', id: '501', apiResultMessage: secret }]],
  ['missing id', [{ apiResult: 'OK' }]]
]) test(`real Activity create rejects ${label} without exposing upstream details`, async t => {
  const { client } = await fake(t, async (req, res) => {
    await Array.fromAsync(req);
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(envelope(rows));
  }, { ENABLE_WRITE: 'true', ENABLE_REAL_WRITE: 'true',
    PROJEQTOR_API_KEY: '0123456789abcdef0123456789abcdef', PROJEQTOR_AES_KEY_LENGTH: '128' });
  await assert.rejects(client.createActivity({ projectId: 9, name: 'A', description: null,
    activityTypeId: 2, statusId: 1, creationDate: '2026-10-28' }), error =>
    ['UPSTREAM_INVALID_RESPONSE', 'UPSTREAM_WRITE_REJECTED'].includes(error.code) && !error.message.includes(secret));
});
