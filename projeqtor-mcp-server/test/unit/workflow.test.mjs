import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockProjectClient } from '../../dist/clients/mock.js';
import { ActivityWorkflow } from '../../dist/services/activity-workflow.js';
import { ReadError } from '../../dist/domain/errors.js';

async function stateDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'projeqtor-direct-write-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

const mockInput = { projectId: 1, name: 'Direct mock activity' };
const realInput = { projectId: 1, name: 'Direct real activity', activityTypeId: 2, statusId: 1, creationDate: '2026-10-29',
  startDate: '2026-11-02', endDate: '2026-11-06' };
const saved = { id: 501, name: realInput.name, description: null, idProject: 1, idStatus: 1,
  idResource: null, idActivityType: 2, creationDate: '2026-10-29',
  startDate: '2026-11-02', endDate: '2026-11-06', plannedWork: null, realWork: null, leftWork: null };

test('create_activity writes mock data directly without proposal state', async t => {
  const directory = await stateDirectory(t);
  const workflow = new ActivityWorkflow(new MockProjectClient(directory), { stateDirectory: directory, enableWrite: true });
  const result = await workflow.createDirect(mockInput);
  assert.equal(result.persisted, true);
  assert.equal(result.activity.name, mockInput.name);
  const state = await workflow.store.read();
  assert.equal(state.version, 2);
  assert.deepEqual(state.operations, {});
  assert.equal(state.activities.length, 1);
});

test('create_activity accepts optional dates and rejects an inverted range', async t => {
  const directory = await stateDirectory(t);
  const workflow = new ActivityWorkflow(new MockProjectClient(directory), { stateDirectory: directory, enableWrite: true });
  const result = await workflow.createDirect({ ...mockInput, startDate: '2026-11-02', endDate: '2026-11-06' });
  assert.equal(result.activity.startDate, '2026-11-02');
  assert.equal(result.activity.endDate, '2026-11-06');
  await assert.rejects(workflow.createDirect({ ...mockInput, startDate: '2026-11-07', endDate: '2026-11-06' }),
    { code: 'INVALID_ARGUMENT' });
});

test('direct real create verifies and deduplicates the same payload', async t => {
  const directory = await stateDirectory(t);
  let creates = 0;
  const client = { mode: 'real',
    getProject: async id => ({ mode: 'real', project: { id } }),
    createActivity: async () => { creates++; return saved; },
    getActivity: async id => ({ mode: 'real', activity: id === saved.id ? saved : null }),
    readActivities: async () => [saved] };
  const workflow = new ActivityWorkflow(client, { stateDirectory: directory, enableWrite: true, enableRealWrite: true });
  assert.equal((await workflow.createDirect(realInput)).activity.id, saved.id);
  const repeated = await workflow.createDirect(realInput);
  assert.equal(repeated.deduplicated, true);
  assert.equal(creates, 1);
});

test('explicit upstream rejection removes the operation so a corrected retry is possible', async t => {
  const directory = await stateDirectory(t);
  const client = { mode: 'real',
    getProject: async id => ({ mode: 'real', project: { id } }),
    createActivity: async () => { throw new ReadError('UPSTREAM_WRITE_REJECTED', { upstreamMessage: 'Rejected' }); },
    getActivity: async () => null,
    readActivities: async () => [] };
  const workflow = new ActivityWorkflow(client, { stateDirectory: directory, enableWrite: true, enableRealWrite: true });
  await assert.rejects(workflow.createDirect(realInput), { code: 'UPSTREAM_WRITE_REJECTED' });
  assert.deepEqual((await workflow.store.read()).operations, {});
});

test('uncertain write is not submitted twice and can reconcile one matching Activity', async t => {
  const directory = await stateDirectory(t);
  let creates = 0;
  let visible = [];
  const client = { mode: 'real',
    getProject: async id => ({ mode: 'real', project: { id } }),
    createActivity: async () => { creates++; throw new Error('connection lost'); },
    getActivity: async () => ({ mode: 'real', activity: null }),
    readActivities: async () => visible };
  const workflow = new ActivityWorkflow(client, { stateDirectory: directory, enableWrite: true, enableRealWrite: true });
  await assert.rejects(workflow.createDirect(realInput), { code: 'UPSTREAM_WRITE_UNCERTAIN' });
  await assert.rejects(workflow.createDirect(realInput), { code: 'OPERATION_OUTCOME_UNKNOWN' });
  visible = [saved];
  const reconciled = await workflow.createDirect(realInput);
  assert.equal(reconciled.reconciled, true);
  assert.equal(creates, 1);
});

test('delete_activity requires confirmation, deletes in Real Mode, and verifies absence', async t => {
  const directory = await stateDirectory(t);
  let current = saved;
  let deletes = 0;
  const client = { mode: 'real',
    getActivity: async id => ({ mode: 'real', activity: id === saved.id ? current : null }),
    deleteActivity: async id => { assert.equal(id, saved.id); deletes++; current = null; } };
  const workflow = new ActivityWorkflow(client, { stateDirectory: directory, enableWrite: true, enableRealWrite: true });
  const preview = await workflow.deleteDirect({ activityId: saved.id, confirmed: false });
  assert.equal(preview.confirmationRequired, true);
  assert.equal(preview.activity.name, saved.name);
  assert.deepEqual(preview.confirmationArguments, { activityId: saved.id, confirmed: true });
  assert.equal(deletes, 0);
  const result = await workflow.deleteDirect({ activityId: saved.id, confirmed: true });
  assert.deepEqual(result, { mode: 'real', activityId: saved.id, name: saved.name, deleted: true, verified: true });
  assert.equal(deletes, 1);
});

test('delete_activity rejects invalid/missing IDs and a failed post-delete verification', async t => {
  const directory = await stateDirectory(t);
  const client = { mode: 'real',
    getActivity: async id => ({ mode: 'real', activity: id === saved.id ? saved : null }),
    deleteActivity: async () => {} };
  const workflow = new ActivityWorkflow(client, { stateDirectory: directory, enableWrite: true, enableRealWrite: true });
  await assert.rejects(workflow.deleteDirect({ activityId: 0, confirmed: true }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(workflow.deleteDirect({ activityId: 999, confirmed: true }), { code: 'ACTIVITY_NOT_FOUND' });
  await assert.rejects(workflow.deleteDirect({ activityId: saved.id, confirmed: true }), { code: 'UPSTREAM_DELETE_NOT_VERIFIED' });
});

test('delete_activity reports explicit API rejection and reconciles an uncertain response', async t => {
  const directory = await stateDirectory(t);
  let current = saved;
  let rejected = true;
  const client = { mode: 'real',
    getActivity: async id => ({ mode: 'real', activity: id === saved.id ? current : null }),
    deleteActivity: async () => {
      if (rejected) throw new ReadError('UPSTREAM_DELETE_REJECTED');
      current = null;
      throw new Error('connection lost');
    } };
  const workflow = new ActivityWorkflow(client, { stateDirectory: directory, enableWrite: true, enableRealWrite: true });
  await assert.rejects(workflow.deleteDirect({ activityId: saved.id, confirmed: true }), { code: 'UPSTREAM_DELETE_REJECTED' });
  rejected = false;
  const result = await workflow.deleteDirect({ activityId: saved.id, confirmed: true });
  assert.equal(result.reconciled, true);
  assert.equal(result.verified, true);
});
