import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AuthorizationRequestError, InMemoryAuthorizationCodeRepository, consumeAuthorizationCode,
  issueAuthorizationCode, validateAuthorizationRequest, validateRedirectUri, verifyPkceS256,
} from '../../dist/oauth/authorization.js';
import { registerCimdClient, registerPublicClient, validateClientId } from '../../dist/oauth/client-registration.js';
import { createAuthorizationServerMetadata, createProtectedResourceMetadata } from '../../dist/oauth/discovery.js';
import { OAuthTokenError, OAuthTokenService } from '../../dist/oauth/tokens.js';
import { FileTokenRepository, InMemoryTokenRepository } from '../../dist/oauth/token-store.js';
import { oauthUiHeaders, renderConnectionsPage, renderConsentPage, renderLoginPage, renderRevokeConfirmation } from '../../dist/oauth/ui.js';

const verifier = 'v'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const redirect = 'https://client.example/callback?keep=1';
const resource = 'https://api.example';
const client = Object.freeze({ clientId: 'client-1', redirectUris: [redirect], allowedScopes: ['read', 'write'], allowedResources: [resource] });
const clients = new Map([[client.clientId, client]]);
const authRequest = (extra = {}) => ({ response_type: 'code', client_id: client.clientId, redirect_uri: redirect,
  scope: 'read', resource, code_challenge: challenge, code_challenge_method: 'S256', state: 'state-1', ...extra });
const options = { userId: 'user-1', issuer: 'https://issuer.example', audience: resource, clientId: client.clientId, scopes: ['read', 'write'] };
const fail = (fn, code) => assert.throws(fn, e => e instanceof OAuthTokenError && e.code === code);

test('PKCE accepts only S256 verifier/challenge pairs and fails closed on malformed values', () => {
  assert.equal(verifyPkceS256(verifier, challenge), true);
  for (const [v, c] of [['wrong', challenge], ['!'.repeat(43), challenge], ['v'.repeat(42), challenge], ['v'.repeat(129), challenge], [verifier, 'A'.repeat(42)], [verifier, 'A'.repeat(43)]])
    assert.equal(verifyPkceS256(v, c), false);
  for (const params of [{ code_challenge_method: 'plain' }, { code_challenge: 'A'.repeat(44) }, { code_challenge: '\n'.repeat(43) }])
    assert.throws(() => validateAuthorizationRequest(authRequest(params), clients, resource), AuthorizationRequestError);
});

test('redirect matching is exact and blocks open redirects and URI parser normalization tricks', () => {
  const attacks = ['https://client.example/callback.evil?keep=1', 'https://client.example@attacker.example/callback',
    'https://client.example/callback?keep=1&next=https://attacker.example', 'https://client.example/callback?keep=1#@attacker.example',
    'javascript:alert(1)', 'data:text/html,x', 'http://attacker.example/callback', 'https://client.example\\@attacker.example/callback'];
  for (const uri of attacks) assert.equal(validateRedirectUri(uri, [redirect]), false, uri);
  assert.throws(() => validateAuthorizationRequest(authRequest({ redirect_uri: 'https://attacker.example/' }), clients, resource), e => {
    assert.ok(e instanceof AuthorizationRequestError); assert.equal(e.redirectUri, undefined); return true;
  });
  // A validated redirect may carry only explicitly registered destination; query values are not destination changes.
  const result = validateAuthorizationRequest(authRequest(), clients, resource);
  assert.equal(result.context.redirectUri, redirect);
});

test('authorization rejects cross-resource, scope escalation, duplicate scope and oversized attacker fields', () => {
  for (const params of [
    { resource: 'https://other.example' }, { scope: 'read admin' }, { scope: 'read read' },
    { scope: 'read'.repeat(500) }, { state: 'x'.repeat(1025) }, { client_id: 'x'.repeat(201) },
  ]) assert.throws(() => validateAuthorizationRequest(authRequest(params), clients, resource), AuthorizationRequestError);
  assert.throws(() => validateAuthorizationRequest(authRequest({ resource: 'https://other.example' }), clients, resource), e => e.redirectUri === redirect);
});

test('authorization codes are single-use under parallel redemption and never stored raw', async () => {
  const repo = new InMemoryAuthorizationCodeRepository();
  const issued = await issueAuthorizationCode(repo, { clientId: client.clientId, redirectUri: redirect, resource, userId: 'u', scopes: ['read'], codeChallenge: challenge }, 10_000);
  const outcomes = await Promise.all(Array.from({ length: 100 }, () => consumeAuthorizationCode(repo, issued.code, 10_001)));
  assert.equal(outcomes.filter(Boolean).length, 1);
  assert.equal(JSON.stringify(repo).includes(issued.code), false);
  assert.equal(await consumeAuthorizationCode(repo, issued.code, 10_001), undefined);
});

test('DCR/CIMD reject hostile redirects, arbitrary metadata and unregistered URL dereferencing', () => {
  assert.throws(() => registerPublicClient({ redirect_uris: ['https://attacker.example/cb'], client_secret: 'secret' }));
  assert.throws(() => registerPublicClient({ redirect_uris: ['javascript:alert(1)'] }));
  const registry = new Map();
  assert.throws(() => validateClientId('https://attacker.example/metadata', registry));
  assert.equal(registry.size, 0, 'validation must not fetch or auto-register CIMD URLs');
  const registered = registerCimdClient('https://client.example/metadata.json', [redirect], registry);
  assert.equal(validateClientId(registered.client_id, registry), registered);
  assert.throws(() => registerPublicClient({ redirect_uris: ['https://client.example/cb'], client_name: '<script>alert(1)</script>' }));
});

test('discovery identifiers cannot inject local/private or attacker-controlled endpoints', () => {
  const endpoints = { issuer: 'https://issuer.example', resource, authorizationEndpoint: 'https://issuer.example/authorize',
    tokenEndpoint: 'https://issuer.example/token', revocationEndpoint: 'https://issuer.example/revoke',
    registrationEndpoint: 'https://issuer.example/register', scopesSupported: ['read'] };
  assert.equal(createAuthorizationServerMetadata(endpoints).code_challenge_methods_supported[0], 'S256');
  assert.equal(createProtectedResourceMetadata({ issuer: endpoints.issuer, resource, scopesSupported: ['read'] }).resource, `${resource}/`);
  assert.throws(() => createAuthorizationServerMetadata({ ...endpoints, tokenEndpoint: 'https://attacker.example/token' }));
  assert.throws(() => createProtectedResourceMetadata({ issuer: 'https://127.0.0.1', resource, scopesSupported: ['read'] }));
});

test('OAuth forms escape attacker content and include CSRF fields without reflecting secrets', () => {
  const marker = '<script>alert(1)</script>';
  const pages = [renderLoginPage({ csrfToken: 'csrf" onfocus="xss', error: true }),
    renderConsentPage({ csrfToken: 'csrf', clientName: marker, clientId: marker, resource: marker, scopes: [{ name: marker, description: marker }] }),
    renderConnectionsPage({ csrfToken: 'csrf', grants: [{ grantId: marker, clientId: marker, clientName: marker, scopes: [marker], resource: marker }] }),
    renderRevokeConfirmation({ csrfToken: 'csrf', clientName: marker, grantId: marker })];
  for (const html of pages) {
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /name="csrf_token"/);
  }
  assert.match(pages[0], /value="csrf&amp;quot;|value="csrf&quot; onfocus=&quot;xss"/);
  assert.equal(oauthUiHeaders['Cache-Control'], 'no-store');
  assert.equal(oauthUiHeaders['Content-Type'], 'text/html; charset=utf-8');
});

test('refresh rotation replay revokes the entire family including descendants and access credentials', () => {
  let now = 1000;
  const repository = new InMemoryTokenRepository();
  const service = new OAuthTokenService({ repository, now: () => now, accessTtlSeconds: 60, refreshTtlSeconds: 3600, refreshIdleTtlSeconds: 600 });
  const first = service.issue(options);
  const second = service.refresh({ refreshToken: first.refresh_token, clientId: options.clientId, audience: resource });
  const third = service.refresh({ refreshToken: second.refresh_token, clientId: options.clientId, audience: resource });
  fail(() => service.refresh({ refreshToken: first.refresh_token, clientId: options.clientId, audience: resource }), 'invalid_grant');
  fail(() => service.validateAccess(first.access_token, { issuer: options.issuer, audience: resource }), 'invalid_token');
  fail(() => service.validateAccess(second.access_token, { issuer: options.issuer, audience: resource }), 'invalid_token');
  fail(() => service.validateAccess(third.access_token, { issuer: options.issuer, audience: resource }), 'invalid_token');
  fail(() => service.refresh({ refreshToken: third.refresh_token, clientId: options.clientId, audience: resource }), 'invalid_grant');
  now += 61_000;
});

test('parallel refresh permits one rotation, and replay revokes the winning descendant', async () => {
  const service = new OAuthTokenService();
  const first = service.issue(options);
  const settled = await Promise.allSettled([1, 2].map(() => Promise.resolve().then(() => service.refresh({ refreshToken: first.refresh_token, clientId: options.clientId, audience: resource }))));
  assert.equal(settled.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(settled.filter(x => x.status === 'rejected').length, 1);
  const winner = settled.find(x => x.status === 'fulfilled').value;
  fail(() => service.validateAccess(winner.access_token, { issuer: options.issuer, audience: resource }), 'invalid_token');
});

test('access expiry, client/resource binding, scope narrowing and revocation all fail closed', () => {
  let now = 5_000;
  const service = new OAuthTokenService({ now: () => now, accessTtlSeconds: 1, refreshTtlSeconds: 100, refreshIdleTtlSeconds: 20 });
  const first = service.issue(options);
  assert.throws(() => service.refresh({ refreshToken: first.refresh_token, clientId: 'other', audience: resource }), e => e.code === 'invalid_grant');
  assert.throws(() => service.refresh({ refreshToken: first.refresh_token, clientId: options.clientId, audience: 'https://other.example' }), e => e.code === 'invalid_grant');
  const narrowed = service.refresh({ refreshToken: first.refresh_token, clientId: options.clientId, audience: resource, scopes: ['read'] });
  assert.equal(narrowed.scope, 'read');
  assert.throws(() => service.validateAccess(narrowed.access_token, { issuer: options.issuer, audience: resource, scopes: ['write'] }), e => e.code === 'insufficient_scope');
  now += 1000;
  assert.throws(() => service.validateAccess(narrowed.access_token, { issuer: options.issuer, audience: resource }), e => e.code === 'invalid_token');
  service.revoke({ token: first.refresh_token });
  assert.throws(() => service.refresh({ refreshToken: narrowed.refresh_token, clientId: options.clientId, audience: resource }), e => e.code === 'invalid_grant');
});

test('malformed and oversized token inputs are bounded; repository JSON/stringification contains no raw tokens', () => {
  const repository = new InMemoryTokenRepository();
  const service = new OAuthTokenService({ repository });
  const out = service.issue(options);
  for (const token of ['', 'x'.repeat(1_000_000), 'Ａ'.repeat(43), 'a'.repeat(42)]) {
    assert.throws(() => service.validateAccess(token, { issuer: options.issuer, audience: resource }), e => e.code === 'invalid_token');
    if (token.length === 0 || token.length > 4096) assert.throws(() => service.revoke({ token }), e => e.code === 'invalid_request');
    else assert.doesNotThrow(() => service.revoke({ token }));
  }
  assert.throws(() => service.refresh({ refreshToken: 'x'.repeat(10_000_000), clientId: options.clientId, audience: resource }), e => e.code === 'invalid_grant');
  const serialized = JSON.stringify(repository);
  assert.equal(serialized.includes(out.access_token), false);
  assert.equal(serialized.includes(out.refresh_token), false);
  assert.equal(String(repository).includes(out.access_token), false);
  assert.equal(String(repository).includes(out.refresh_token), false);
});

test('durable token repository persists digests only, never raw access or refresh credentials', () => {
  const directory = mkdtempSync(join(tmpdir(), 'oauth-token-security-'));
  try {
    const repository = new FileTokenRepository(directory);
    const service = new OAuthTokenService({ repository });
    const out = service.issue(options);
    const disk = readFileSync(join(directory, 'tokens.json'), 'utf8');
    assert.equal(disk.includes(out.access_token), false);
    assert.equal(disk.includes(out.refresh_token), false);
    assert.equal(JSON.stringify(repository).includes(out.access_token), false);
    assert.equal(JSON.stringify(repository).includes(out.refresh_token), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
