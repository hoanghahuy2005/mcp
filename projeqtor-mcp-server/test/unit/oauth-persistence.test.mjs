import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OAuthTokenService, OAuthTokenError } from '../../dist/oauth/tokens.js';
import { FileTokenRepository } from '../../dist/oauth/token-store.js';

test('refresh credentials survive restart without raw tokens on disk; reuse revocation also persists', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'projeqtor-oauth-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let now = 1_800_000_000_000;
  const make = () => new OAuthTokenService({ repository: new FileTokenRepository(directory), now: () => now,
    accessTtlSeconds: 60, refreshTtlSeconds: 3600, refreshIdleTtlSeconds: 600 });
  const binding = { userId: 'persistent-user', issuer: 'https://issuer.test', audience: 'https://api.test/mcp', clientId: 'client-persist', scopes: ['mcp:read'] };
  const first = make().issue(binding);
  const disk = await readFile(join(directory, 'tokens.json'), 'utf8');
  assert.equal(disk.includes(first.access_token), false);
  assert.equal(disk.includes(first.refresh_token), false);
  const afterRestart = make();
  assert.equal(afterRestart.validateAccess(first.access_token, { issuer: binding.issuer, audience: binding.audience }).userId, binding.userId);
  const rotated = afterRestart.refresh({ refreshToken: first.refresh_token, clientId: binding.clientId, audience: binding.audience, issuer: binding.issuer });
  const secondRestart = make();
  assert.equal(secondRestart.validateAccess(rotated.access_token, { issuer: binding.issuer, audience: binding.audience }).userId, binding.userId);
  assert.throws(() => secondRestart.refresh({ refreshToken: first.refresh_token, clientId: binding.clientId, audience: binding.audience }),
    error => error instanceof OAuthTokenError && error.code === 'invalid_grant');
  const thirdRestart = make();
  assert.throws(() => thirdRestart.validateAccess(rotated.access_token, { issuer: binding.issuer, audience: binding.audience }),
    error => error instanceof OAuthTokenError && error.code === 'invalid_token');
  now += 1;
});
