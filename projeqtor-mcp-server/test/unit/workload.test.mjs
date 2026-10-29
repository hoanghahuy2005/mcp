import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWorkload } from '../../dist/services/workload.js';
import { RestReadClient } from '../../dist/clients/rest.js';
import { startFakeUpstream, fakeCredentials } from '../../tests/integration/support/fake-upstream.mjs';
import { sourceData, workloadOracle } from '../../tests/integration/support/source-contract.mjs';

async function setup(t, data = sourceData()) {
  const fake = await startFakeUpstream({ data });
  t.after(() => fake.close());
  const client = new RestReadClient({ baseUrl: fake.baseUrl, ...fakeCredentials, timeoutMs: 1000, maxResponseBytes: 1048576 });
  return { fake, client, data };
}

test('workload matches hand-calculated QA oracle, including partial work and unknown resources', async t => {
  const { client, fake } = await setup(t);
  const result = await analyzeWorkload(client, 9);
  assert.equal(result.mode, 'real');
  assert.equal(result.unit, workloadOracle.unit);
  assert.equal(result.activityCount, 3);
  assert.equal(result.ignoredAssignmentCount, 2);
  assert.deepEqual(result.unassignedActivityIds, workloadOracle.unassignedActivityIds);
  for (const [id, expected] of Object.entries(workloadOracle.resources)) {
    const actual = result.resources.find(item => item.resourceId === Number(id));
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value, `resource ${id}/${key}`);
  }
  assert.deepEqual(result.resources.find(item => item.resourceId === 11).activityIds, [101, 102]);
  assert.ok(result.warnings.includes('PARTIAL_WORK_DATA'));
  assert.ok(result.warnings.includes('UNKNOWN_RESOURCE'));
  assert.ok(fake.observations.every(item => item.method === 'GET' && item.basicMatches));
  assert.equal(fake.observations.length, 4, 'one bounded read per entity, no pagination refetching');
});

test('assignment project, class, activity visibility and resource gaps cannot inflate totals', async t => {
  const data = sourceData();
  data.Assignment.push({ id: '210', idProject: '9', refType: 'Activity', refId: '103', idResource: '', plannedWork: '999' });
  const { client } = await setup(t, data);
  const result = await analyzeWorkload(client, 9);
  assert.equal(result.assignmentsWithoutResource, 1);
  assert.deepEqual(result.unassignedActivityIds, [103]);
  assert.equal(result.resources.find(item => item.resourceId === 11).plannedWork.knownSubtotal, 4);
  assert.ok(!JSON.stringify(result).includes('999'));
});

test('decimal totals preserve zero and do not expose floating point addition noise', async t => {
  const data = sourceData();
  data.Assignment = [0.1, 0.2, 0].map((work, i) => ({ id: String(400 + i), idProject: '9', refType: 'Activity',
    refId: '101', idResource: '11', plannedWork: String(work), realWork: '0', leftWork: '0' }));
  const { client } = await setup(t, data);
  const row = (await analyzeWorkload(client, 9)).resources[0];
  assert.deepEqual(row.plannedWork, { total: 0.3, knownSubtotal: 0.3, missingCount: 0 });
  assert.deepEqual(row.realWork, { total: 0, knownSubtotal: 0, missingCount: 0 });
  assert.equal(row.activityCount, 1);
  assert.equal(row.assignmentCount, 3);
});

test('unknown project, denied assignments, duplicated IDs and numeric overflow fail explicitly', async t => {
  const { client, fake, data } = await setup(t);
  await assert.rejects(analyzeWorkload(client, 999), { code: 'PROJECT_NOT_FOUND' });
  fake.setScenario('Assignment', '403');
  await assert.rejects(analyzeWorkload(client, 9), { code: 'UPSTREAM_HTTP_ERROR' });
  fake.setScenario('Assignment', 'normal');
  data.Assignment.push({ ...data.Assignment[0] });
  await assert.rejects(analyzeWorkload(client, 9), { code: 'UPSTREAM_INVALID_RESPONSE' });
  data.Assignment = [1, 2].map(id => ({ id: String(id), idProject: '9', refType: 'Activity', refId: '101', idResource: '11', plannedWork: 1e308 }));
  await assert.rejects(analyzeWorkload(client, 9), { code: 'WORK_TOTAL_OVERFLOW' });
});
