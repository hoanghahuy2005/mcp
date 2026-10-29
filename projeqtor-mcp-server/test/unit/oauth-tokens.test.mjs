import test from 'node:test';
import assert from 'node:assert/strict';
import { OAuthTokenService, OAuthTokenError } from '../../dist/oauth/tokens.js';
import { InMemoryTokenRepository } from '../../dist/oauth/token-store.js';

let clock;
function setup() { clock = 1_800_000_000_000; const repository = new InMemoryTokenRepository(); return { repository, service: new OAuthTokenService({ repository, now: () => clock, accessTtlSeconds: 60, refreshTtlSeconds: 3600, refreshIdleTtlSeconds: 600 }) }; }
const options = { userId: 'u-1', issuer: 'https://issuer.test', audience: 'https://api.test', clientId: 'client-1', scopes: ['read', 'write'] };
const rejectCode = (fn, code) => assert.throws(fn, e => e instanceof OAuthTokenError && e.code === code);

test('issue and validate opaque access token; response uses OAuth fields', () => {
  const { service } = setup(), out = service.issue(options);
  assert.equal(out.token_type, 'Bearer'); assert.equal(out.expires_in, 60); assert.equal(out.scope, 'read write');
  assert.equal(out.access_token.length, 43); assert.equal(out.refresh_token.length, 43);
  assert.equal(service.validateAccess(out.access_token, { issuer: options.issuer, audience: options.audience, clientId: options.clientId, scopes: ['read'] }).userId, 'u-1');
});
test('expired access token fails closed', () => { const { service } = setup(), out = service.issue(options); clock += 60_000; rejectCode(() => service.validateAccess(out.access_token, { issuer: options.issuer, audience: options.audience }), 'invalid_token'); });
test('wrong audience, client, and scope are rejected', () => {
  const { service } = setup(), out = service.issue(options);
  rejectCode(() => service.validateAccess(out.access_token, { issuer: options.issuer, audience: 'wrong' }), 'invalid_token');
  rejectCode(() => service.validateAccess(out.access_token, { issuer: options.issuer, audience: options.audience, clientId: 'wrong' }), 'invalid_token');
  rejectCode(() => service.validateAccess(out.access_token, { issuer: options.issuer, audience: options.audience, scopes: ['admin'] }), 'insufficient_scope');
});
test('refresh rotates once, preserves binding, and old token replay revokes descendants', () => {
  const { service } = setup(), original = service.issue(options);
  const rotated = service.refresh({ refreshToken: original.refresh_token, clientId: options.clientId, audience: options.audience });
  assert.notEqual(rotated.refresh_token, original.refresh_token);
  const second = service.refresh({ refreshToken: rotated.refresh_token, clientId: options.clientId, audience: options.audience });
  rejectCode(() => service.refresh({ refreshToken: original.refresh_token, clientId: options.clientId, audience: options.audience }), 'invalid_grant');
  rejectCode(() => service.validateAccess(rotated.access_token, { issuer: options.issuer, audience: options.audience }), 'invalid_token');
  rejectCode(() => service.validateAccess(second.access_token, { issuer: options.issuer, audience: options.audience }), 'invalid_token');
});
test('concurrent refresh: only one succeeds', async () => {
  const { service } = setup(), original = service.issue(options);
  const settled = await Promise.allSettled([Promise.resolve().then(() => service.refresh({ refreshToken: original.refresh_token, clientId: options.clientId, audience: options.audience })), Promise.resolve().then(() => service.refresh({ refreshToken: original.refresh_token, clientId: options.clientId, audience: options.audience }))]);
  assert.equal(settled.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(settled.filter(x => x.status === 'rejected').length, 1);
});
test('refresh validates client/resource binding and expiry', () => {
  const { service } = setup(), out = service.issue(options);
  rejectCode(() => service.refresh({ refreshToken: out.refresh_token, clientId: 'other', audience: options.audience }), 'invalid_grant');
  rejectCode(() => service.refresh({ refreshToken: out.refresh_token, clientId: options.clientId, audience: 'other' }), 'invalid_grant');
  clock += 3_600_000;
  rejectCode(() => service.refresh({ refreshToken: out.refresh_token, clientId: options.clientId, audience: options.audience }), 'invalid_grant');
});
test('revoke is idempotent and revokes access token family', () => {
  const { service } = setup(), out = service.issue(options);
  service.revoke({ token: out.refresh_token, tokenTypeHint: 'access_token' }); service.revoke({ token: out.refresh_token }); service.revoke({ token: 'unknown' });
  rejectCode(() => service.validateAccess(out.access_token, { issuer: options.issuer, audience: options.audience }), 'invalid_token');
});
test('malformed token fails validation; repository representation never contains raw secrets', () => {
  const { service, repository } = setup(), out = service.issue(options);
  rejectCode(() => service.validateAccess('abc', { issuer: options.issuer, audience: options.audience }), 'invalid_token');
  const serialized = JSON.stringify(repository);
  assert.ok(!serialized.includes(out.access_token)); assert.ok(!serialized.includes(out.refresh_token));
});
