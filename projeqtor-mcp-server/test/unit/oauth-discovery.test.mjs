import test from 'node:test';
import assert from 'node:assert/strict';
import { createProtectedResourceMetadata, createAuthorizationServerMetadata, oauthEndpoints, validatePublicHttpsIdentifier, validateOAuthBaseUrl } from '../../dist/oauth/discovery.js';
import { registerPublicClient, validateRedirectUri, registerCimdClient, validateClientId } from '../../dist/oauth/client-registration.js';

const input = oauthEndpoints('https://auth.example.com', 'https://api.example.com/mcp', ['projects:read']);

test('builds RFC 9728 protected resource metadata exactly', () => {
  assert.deepEqual(createProtectedResourceMetadata(input), {
    resource: 'https://api.example.com/mcp', authorization_servers: ['https://auth.example.com/'], scopes_supported: ['projects:read']
  });
});

test('builds RFC 8414 authorization server metadata with PKCE and public auth', () => {
  assert.deepEqual(createAuthorizationServerMetadata(input), {
    issuer: 'https://auth.example.com/', authorization_endpoint: 'https://auth.example.com/authorize',
    token_endpoint: 'https://auth.example.com/token', revocation_endpoint: 'https://auth.example.com/revoke',
    registration_endpoint: 'https://auth.example.com/register', response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'], authorization_response_iss_parameter_supported: true
  });
});

test('rejects noncanonical, private, queried, or credentialed resource and issuer URLs', () => {
  for (const bad of ['http://api.example.com', 'https://user@api.example.com', 'https://api.example.com/?x=1', 'https://localhost/mcp', 'https://192.168.1.1/mcp']) {
    assert.throws(() => validatePublicHttpsIdentifier(bad));
  }
  assert.throws(() => validateOAuthBaseUrl('https://auth.example.com?next=https://evil.test'));
});

test('validates the deployment base URL including test-only loopback HTTP', () => {
  assert.equal(validateOAuthBaseUrl('https://auth.example.com/'), 'https://auth.example.com');
  assert.throws(() => validateOAuthBaseUrl('http://auth.example.com'));
  assert.equal(validateOAuthBaseUrl('http://127.0.0.1:8788', { allowLoopbackHttp: true }), 'http://127.0.0.1:8788');
});

test('DCR allows bounded HTTPS public client metadata and returns no secret', () => {
  const client = registerPublicClient({ client_name: 'ChatGPT', redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'], grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none' }, { clientId: () => 'client-id-1234567890' });
  assert.equal(client.client_id, 'client-id-1234567890');
  assert.equal(client.token_endpoint_auth_method, 'none');
  assert.equal('client_secret' in client, false);
  assert.equal(client.redirect_uris[0], 'https://chatgpt.com/connector_platform_oauth_redirect');
});

test('DCR rejects malicious redirects and confidential client metadata', () => {
  for (const redirect of ['javascript:alert(1)', 'https://user@safe.example/cb', 'https://safe.example/cb#https://evil.example', 'http://evil.example/cb']) {
    assert.throws(() => validateRedirectUri(redirect));
  }
  assert.throws(() => registerPublicClient({ redirect_uris: ['https://safe.example/cb'], token_endpoint_auth_method: 'client_secret_basic' }));
  assert.throws(() => registerPublicClient({ redirect_uris: ['https://safe.example/cb'], client_secret: 'oops' }));
});

test('loopback HTTP callbacks are accepted only in explicit test mode', () => {
  assert.throws(() => validateRedirectUri('http://127.0.0.1:3456/callback'));
  assert.equal(validateRedirectUri('http://127.0.0.1:3456/callback', { allowLoopbackHttp: true }), 'http://127.0.0.1:3456/callback');
});

test('CIMD URLs require explicit pre-registration and are never fetched', () => {
  const clients = new Map();
  const id = 'https://chatgpt.com/.well-known/oauth-client/abc';
  const registered = registerCimdClient(id, ['https://chatgpt.com/connector_platform_oauth_redirect'], clients);
  assert.equal(validateClientId(id, clients), registered);
  assert.throws(() => validateClientId('https://attacker.example/client.json', clients), /pre-registered/);
  assert.throws(() => registerCimdClient('http://127.0.0.1/client', ['https://chatgpt.com/cb'], clients));
});
