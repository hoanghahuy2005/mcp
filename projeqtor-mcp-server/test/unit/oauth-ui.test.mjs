import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjeqtorApiUserAuthenticator } from '../../dist/oauth/user-authenticator.js';
import { oauthUiHeaders, parseConsentDecision, renderConsentPage, renderConnectionsPage, renderLoginPage, renderRevokeConfirmation, renderRevokeResult } from '../../dist/oauth/ui.js';

const jsonResponse = (body = '{"identifier":"id","items":[]}', headers = { 'content-type': 'application/json' }, status = 200) => new Response(body, { status, headers });

test('UI escapes dynamic content, includes CSRF fields and emits no-store-compatible headers', () => {
  const login = renderLoginPage({ csrfToken: '" onfocus="xss', error: true });
  assert.match(login, /value="&quot; onfocus=&quot;xss"/);
  assert.doesNotMatch(login, /<script/i);
  assert.match(login, /type="password"/);
  assert.match(oauthUiHeaders['Cache-Control'], /no-store/);
  const consent = renderConsentPage({ csrfToken: 'csrf', clientName: '<img src=x>', clientId: 'id&1', resource: '<api>', scopes: [{ name: '<admin>', description: '"quoted"' }] });
  assert.match(consent, /&lt;img src=x&gt;/);
  assert.match(consent, /&lt;admin&gt;/);
  assert.match(consent, /name="csrf_token"/);
  assert.match(consent, /value="approve"/);
  assert.match(consent, /value="deny"/);
  assert.equal(parseConsentDecision('approve'), 'approve');
  assert.equal(parseConsentDecision('wat'), undefined);
  const connections = renderConnectionsPage({ csrfToken: 'csrf', grants: [{ grantId: 'g1', clientId: 'c', clientName: '<client>', scopes: ['read'], resource: 'https://api' }] });
  assert.match(connections, /name="grant_id" value="g1"/);
  assert.match(connections, /&lt;client&gt;/);
  assert.doesNotMatch(connections, /access_token|refresh_token|token_value/i);
  assert.match(renderRevokeConfirmation({ csrfToken: 'csrf', clientName: 'app', grantId: 'g1' }), /name="csrf_token"/);
  assert.match(renderRevokeResult(true), /Access revoked/);
});

test('login page never reflects submitted credentials or caller-controlled error text', () => {
  const password = 's3cret-unique';
  const html = renderLoginPage({ csrfToken: 't', error: true });
  assert.equal(html.includes(password), false);
  assert.equal(html.includes('Authorization'), false);
});

test('authenticator sends Basic only to fixed API endpoint and accepts a valid response', async () => {
  let seen;
  const auth = new ProjeqtorApiUserAuthenticator({ baseUrl: 'https://host.example/app/api/', fetchImpl: async (url, init) => {
    seen = { url: String(url), init }; return jsonResponse();
  } });
  assert.deepEqual(await auth.authenticate('alice', 'secret'), { subject: 'alice' });
  assert.equal(seen.url, 'https://host.example/app/api/Project/all');
  assert.equal(seen.init.method, 'GET');
  assert.equal(seen.init.redirect, 'manual');
  assert.match(seen.init.headers.Authorization, /^Basic /);
});

test('authenticator fails closed for content type, redirects, HTTP/auth failures and invalid envelopes', async () => {
  for (const response of [jsonResponse('ok', { 'content-type': 'text/html' }), jsonResponse('', {}, 302), jsonResponse('', {}, 401), jsonResponse('{"error":"bad"}')]) {
    const auth = new ProjeqtorApiUserAuthenticator({ baseUrl: 'https://host.example/api/', fetchImpl: async () => response });
    assert.equal(await auth.authenticate('alice', 'secret'), undefined);
  }
});

test('authenticator bounds response size and times out without exposing credentials', async () => {
  const oversized = new ProjeqtorApiUserAuthenticator({ baseUrl: 'https://host.example/api/', maxResponseBytes: 4,
    fetchImpl: async () => jsonResponse('{"identifier":"id","items":[]}') });
  assert.equal(await oversized.authenticate('alice', 'secret'), undefined);
  const timeout = new ProjeqtorApiUserAuthenticator({ baseUrl: 'https://host.example/api/', timeoutMs: 10,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  assert.equal(await timeout.authenticate('alice', 'do-not-reflect'), undefined);
});

test('authenticator rejects path escape and unsafe credentials', async () => {
  assert.throws(() => new ProjeqtorApiUserAuthenticator({ baseUrl: 'https://host.example/api/', verificationPath: '../outside' }));
  const auth = new ProjeqtorApiUserAuthenticator({ baseUrl: 'https://host.example/api/', fetchImpl: async () => { throw new Error('must not call'); } });
  assert.equal(await auth.authenticate('bad\nuser', 'p'), undefined);
});
