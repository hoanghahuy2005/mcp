import test from 'node:test';
import assert from 'node:assert/strict';
import { MockProjectClient } from '../../dist/clients/mock.js';

test('mock fixture identifies synthetic data and paginates without mutation', async () => {
  const client = new MockProjectClient();
  const first = await client.listProjects(1, 0);
  assert.equal(first.mode, 'mock'); assert.equal(first.total, 2);
  assert.equal(first.projects.length, 1); assert.equal(first.truncated, true);
  assert.match(first.projects[0].description, /Synthetic mock/);
  const next = await client.listProjects(1, 1);
  assert.equal(next.projects[0].id, 2); assert.equal(next.projects[0].description, null);
  assert.equal(next.truncated, false);
  assert.equal((await client.listProjects(50, 100)).projects.length, 0);
  first.projects[0].name = 'local mutation';
  assert.notEqual((await client.listProjects(1, 0)).projects[0].name, 'local mutation');
});
