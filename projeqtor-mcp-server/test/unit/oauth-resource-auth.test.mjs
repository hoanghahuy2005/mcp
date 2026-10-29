import test from 'node:test';
import assert from 'node:assert/strict';
import { OAuthTokenService } from '../../dist/oauth/tokens.js';
import { InMemoryTokenRepository } from '../../dist/oauth/token-store.js';
import { bearerChallenge, verifyResourceAuthorization, ResourceAuthError } from '../../dist/oauth/resource-auth.js';

const oauth = { issuer: 'https://issuer.test', resource: 'https://api.test/mcp', resourceMetadataUrl: 'https://api.test/.well-known/oauth-protected-resource', scopes: ['mcp:read', 'mcp:write'] };
const options = { mode: 'oauth', oauth };
const tokenService = new OAuthTokenService({ repository: new InMemoryTokenRepository(), now: () => 1_800_000_000_000 });
const issued = tokenService.issue({ userId: 'subject-123', issuer: oauth.issuer, audience: oauth.resource, clientId: 'client-123', scopes: ['mcp:read'] });
function expectFailure(fn, status, code) {
  assert.throws(fn, error => error instanceof ResourceAuthError && error.status === status && error.code === code);
}

test('requires exactly one well-formed Bearer header', () => {
  expectFailure(() => verifyResourceAuthorization(undefined, options, tokenService), 401, 'invalid_token');
  expectFailure(() => verifyResourceAuthorization(['Basic abc'], options, tokenService), 401, 'invalid_token');
  expectFailure(() => verifyResourceAuthorization(['Bearer one', 'Bearer two'], options, tokenService), 401, 'invalid_token');
});

test('rejects unknown OAuth tokens and binds issuer and audience', () => {
  expectFailure(() => verifyResourceAuthorization(['Bearer ' + 'x'.repeat(43)], options, tokenService), 401, 'invalid_token');
  expectFailure(() => verifyResourceAuthorization(['Bearer ' + issued.access_token], { ...options, oauth: { ...oauth, resource: 'https://wrong.test' } }, tokenService), 401, 'invalid_token');
});

test('enforces required scopes and produces RFC 9728 challenge parameters', () => {
  expectFailure(() => verifyResourceAuthorization(['Bearer ' + issued.access_token], options, tokenService, 'mcp:write'), 403, 'insufficient_scope');
  assert.equal(bearerChallenge(options, { scope: 'mcp:write', error: 'insufficient_scope' }),
    'Bearer resource_metadata="https://api.test/.well-known/oauth-protected-resource", scope="mcp:write", error="insufficient_scope"');
  assert.throws(() => verifyResourceAuthorization(['Bearer ' + issued.access_token], options, tokenService, 'mcp:write'), error =>
    error.headers['WWW-Authenticate'].includes('resource_metadata=') && error.headers['WWW-Authenticate'].includes('scope="mcp:write"'));
});

test('legacy mode uses the static credential and both mode accepts it without OAuth downgrade', () => {
  const secret = 'legacy-secret-random-long-value';
  const legacy = { mode: 'legacy', bearerToken: secret };
  assert.equal(verifyResourceAuthorization(['Bearer ' + secret], legacy).method, 'legacy');
  expectFailure(() => verifyResourceAuthorization(['Bearer wrong'], legacy), 401, 'invalid_token');
  const both = { ...options, mode: 'both', bearerToken: secret };
  assert.equal(verifyResourceAuthorization(['Bearer ' + secret], both, tokenService).method, 'legacy');
  const context = verifyResourceAuthorization(['Bearer ' + issued.access_token], both, tokenService, 'mcp:read');
  assert.deepEqual({ subject: context.subject, scopes: context.scopes, method: context.method }, { subject: 'subject-123', scopes: ['mcp:read'], method: 'oauth' });
  expectFailure(() => verifyResourceAuthorization(['Bearer ' + 'z'.repeat(43)], both, tokenService), 401, 'invalid_token');
});
