import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import {
  AuthorizationRequestError, InMemoryAuthorizationCodeRepository, authorizationErrorRedirect,
  authorizationSuccessRedirect, consumeAuthorizationCode, issueAuthorizationCode,
  validateAuthorizationRequest, validateRedirectUri, verifyPkceS256
} from '../../dist/oauth/authorization.js';

const verifier = 'v'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const redirectUri = 'https://client.example/callback?existing=1';
const client = Object.freeze({ clientId: 'client-1', redirectUris: [redirectUri], allowedScopes: ['read', 'write'], allowedResources: ['https://api.example'] });
const clients = new Map([[client.clientId, client]]);
const request = (overrides = {}) => ({ response_type: 'code', client_id: client.clientId, redirect_uri: redirectUri,
  scope: 'read write', state: 'state-123', resource: 'https://api.example', code_challenge: challenge,
  code_challenge_method: 'S256', ...overrides });

test('validates request, PKCE challenge and issuer-bearing success/error redirects', () => {
  const validated = validateAuthorizationRequest(request(), clients, 'https://api.example');
  assert.deepEqual(validated.context.scopes, ['read', 'write']);
  assert.equal(verifyPkceS256(verifier, challenge), true);
  assert.equal(verifyPkceS256('wrong', challenge), false);
  const success = new URL(authorizationSuccessRedirect('https://issuer.example', redirectUri, 'code', 'state-123'));
  assert.equal(success.searchParams.get('iss'), 'https://issuer.example');
  assert.equal(success.searchParams.get('state'), 'state-123');
  const failure = new URL(authorizationErrorRedirect('https://issuer.example', redirectUri, 'invalid_scope'));
  assert.equal(failure.searchParams.get('error'), 'invalid_scope');
  assert.equal(failure.searchParams.get('iss'), 'https://issuer.example');
});

test('rejects redirect mismatch and never attaches an untrusted redirect', () => {
  assert.equal(validateRedirectUri('https://client.example/callback.evil', client.redirectUris), false);
  assert.throws(() => validateAuthorizationRequest(request({ redirect_uri: 'https://attacker.invalid/' }), clients, 'https://api.example'),
    e => e instanceof AuthorizationRequestError && e.redirectUri === undefined);
});

test('rejects invalid scope, resource, response type and PKCE requirements', () => {
  for (const params of [
    { scope: 'admin' }, { scope: 'read read' }, { resource: 'https://other.example' },
    { response_type: 'token' }, { code_challenge_method: 'plain' }, { code_challenge: undefined }
  ]) assert.throws(() => validateAuthorizationRequest(request(params), clients, 'https://api.example'), AuthorizationRequestError);
});

test('accepts a pre-registered HTTPS CIMD client_id without dereferencing arbitrary URLs', () => {
  const cimdId = 'https://chatgpt.com/oauth/client.json';
  const cimd = Object.freeze({ ...client, clientId: cimdId, redirectUris: ['https://chatgpt.com/connector_platform_oauth_redirect'] });
  const cimdClients = new Map([[cimdId, cimd]]);
  const validated = validateAuthorizationRequest(request({ client_id: cimdId, redirect_uri: cimd.redirectUris[0] }), cimdClients, 'https://api.example');
  assert.equal(validated.client.clientId, cimdId);
  assert.throws(() => validateAuthorizationRequest(request({ client_id: 'https://attacker.example/client.json' }), cimdClients, 'https://api.example'),
    e => e instanceof AuthorizationRequestError && e.oauthError === 'unauthorized_client');
});

test('redirect URI validation disallows fragments, userinfo, unsafe schemes and non-loopback HTTP', () => {
  for (const uri of ['javascript:alert(1)', 'http://client.example/cb', 'https://user@client.example/cb',
    'https://client.example/cb#fragment'])
    assert.equal(validateRedirectUri(uri, [uri]), false, uri);
  assert.equal(validateRedirectUri('https://client.example/cb/', ['https://client.example/cb']), false);
  assert.equal(validateRedirectUri('http://127.0.0.1:3000/cb', ['http://127.0.0.1:3000/cb']), true);
});

test('authorization code is opaque, expires, and can be consumed exactly once', async () => {
  const repository = new InMemoryAuthorizationCodeRepository();
  const context = { ...validateAuthorizationRequest(request(), clients, 'https://api.example').context, userId: 'user-1' };
  const issued = await issueAuthorizationCode(repository, context, 1000);
  assert.equal(issued.code.length, 43);
  assert.equal(await consumeAuthorizationCode(repository, issued.code, issued.expiresAt), undefined);
  assert.equal(await consumeAuthorizationCode(repository, issued.code, 1000), undefined);
});

test('concurrent consumption is single-use and unguessable malformed codes fail closed', async () => {
  const repository = new InMemoryAuthorizationCodeRepository();
  const context = { ...validateAuthorizationRequest(request(), clients, 'https://api.example').context, userId: 'user-1' };
  const issued = await issueAuthorizationCode(repository, context, 1000);
  const results = await Promise.all(Array.from({ length: 20 }, () => consumeAuthorizationCode(repository, issued.code, 1001)));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await consumeAuthorizationCode(repository, randomBytes(32).toString('base64url'), 1001), undefined);
  assert.equal(await consumeAuthorizationCode(repository, 'bad', 1001), undefined);
});
