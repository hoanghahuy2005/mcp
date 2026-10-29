import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHttpServer as createMcpServer } from '../../dist/transports/http.js';
import { rawHttp } from './support/mcp-http.mjs';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function form(fields) { return new URLSearchParams(fields).toString(); }
function hidden(html, name) {
  const match = new RegExp(`name="${name}" value="([^"]+)"`).exec(html);
  assert.ok(match, `Missing ${name} field`);
  return match[1].replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

async function startOAuthHarness(t) {
  const upstream = createHttpServer((req, res) => {
    if (req.url !== '/api/Project/all' || req.method !== 'GET' || req.headers.authorization !== `Basic ${Buffer.from('qa-user:qa-password').toString('base64')}`) {
      res.writeHead(401, { 'content-type': 'application/json' }); res.end('{}'); return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"identifier":"id","items":[]}');
  });
  const upstreamPort = await listen(upstream);
  const stateDirectory = await mkdtemp(join(tmpdir(), 'projeqtor-oauth-qa-'));
  const port = await new Promise((resolve, reject) => {
    const probe = createHttpServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const p = probe.address().port; probe.close(() => resolve(p)); });
  });
  const issuer = 'https://oauth.example';
  const resource = `${issuer}/mcp`;
  const config = {
    mode: 'mock', transport: 'http', host: '127.0.0.1', port, authMode: 'both',
    bearerToken: 'legacy-qa-token-which-is-long-and-unique-998877',
    oauth: { issuer, resource, resourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource`,
      scopes: ['mcp:read', 'mcp:write'], accessTtlSeconds: 600, refreshTtlSeconds: 3600,
      refreshIdleTtlSeconds: 900, stateDirectory, chatgptClientId: 'https://chatgpt.com/oauth/client.json',
      chatgptRedirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect',
      projeqtorBaseUrl: `http://127.0.0.1:${upstreamPort}/api/` },
    allowedHosts: [`127.0.0.1:${port}`, 'oauth.example'], allowedOrigins: ['https://oauth.example'], enableWrite: false,
    stateDirectory, proposalTtlSeconds: 300,
  };
  const app = createMcpServer(config);
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(port, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${port}`;
  t.after(async () => {
    await app.close().catch(() => {});
    await new Promise(resolve => upstream.close(resolve));
    await rm(stateDirectory, { recursive: true, force: true });
  });
  return { url, issuer, resource, config };
}

async function register(url, name) {
  const response = await rawHttp(`${url}/register`, { headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: name, redirect_uris: ['https://client.example/callback'], scope: 'mcp:read mcp:write' }) });
  assert.equal(response.status, 201, response.text);
  return JSON.parse(response.text).client_id;
}

async function authorize(url, { clientId, issuer, resource, scope = 'mcp:read mcp:write' }) {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = 'qa-state-01';
  const query = new URLSearchParams({ response_type: 'code', client_id: clientId,
    redirect_uri: 'https://client.example/callback', scope, resource,
    code_challenge: challenge, code_challenge_method: 'S256', state });
  const login = await rawHttp(`${url}/authorize?${query}`, { method: 'GET' });
  assert.equal(login.status, 200, login.text);
  const setCookie = Array.isArray(login.headers['set-cookie']) ? login.headers['set-cookie'][0] : login.headers['set-cookie'];
  const cookie = setCookie?.split(';')[0];
  assert.ok(cookie?.startsWith('projeqtor_oauth='));
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.equal(login.headers['cache-control'], 'no-store');
  assert.equal(login.headers['referrer-policy'], 'same-origin', 'form POSTs must preserve their same-origin Origin header');
  const csrf = hidden(login.text, 'csrf_token');

  const csrfAttack = await rawHttp(`${url}/oauth/login`, { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: form({ csrf_token: 'wrong', username: 'qa-user', password: 'qa-password' }) });
  assert.equal(csrfAttack.status, 400, 'login must reject invalid CSRF token');
  const authenticated = await rawHttp(`${url}/oauth/login`, { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: form({ csrf_token: csrf, username: 'qa-user', password: 'qa-password' }) });
  assert.equal(authenticated.status, 200, authenticated.text);
  assert.match(authenticated.text, /Authorize access/);
  assert.match(authenticated.headers['content-security-policy'], /form-action 'self' https:\/\/chatgpt\.com/);
  assert.match(authenticated.text, /src="\/oauth\/consent\.js\?v=2"/);
  const consentScript = await rawHttp(`${url}/oauth/consent.js`, { method: 'GET' });
  assert.equal(consentScript.status, 200, consentScript.text);
  assert.equal(consentScript.headers['cache-control'], 'no-store');
  assert.match(consentScript.text, /e\.submitter/);
  assert.match(consentScript.text, /type='hidden'/);
  const consentCsrf = hidden(authenticated.text, 'csrf_token');
  const approved = await rawHttp(`${url}/oauth/consent`, { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: form({ csrf_token: consentCsrf, decision: 'approve' }) });
  assert.equal(approved.status, 302, approved.text);
  const callback = new URL(approved.headers.location);
  assert.equal(callback.origin, 'https://client.example');
  assert.equal(callback.searchParams.get('state'), state);
  assert.equal(callback.searchParams.get('iss'), new URL(issuer).href);
  const code = callback.searchParams.get('code');
  assert.ok(code);

  const exchanged = await rawHttp(`${url}/token`, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'authorization_code', client_id: clientId,
    code, redirect_uri: 'https://client.example/callback', code_verifier: verifier, resource }) });
  assert.equal(exchanged.status, 200, exchanged.text);
  const tokens = JSON.parse(exchanged.text);
  assert.equal(tokens.token_type, 'Bearer'); assert.equal(tokens.scope, scope);
  assert.equal(tokens.access_token.length, 43); assert.equal(tokens.refresh_token.length, 43);
  const replay = await rawHttp(`${url}/token`, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'authorization_code', client_id: clientId,
    code, redirect_uri: 'https://client.example/callback', code_verifier: verifier, resource }) });
  assert.equal(replay.status, 400);
  assert.equal(JSON.parse(replay.text).error, 'invalid_grant');
  return { tokens, verifier };
}

async function mcp(url, token, id = 1) {
  return rawHttp(`${url}/mcp`, { headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'oauth-qa', version: '1' } } }) });
}
async function callTool(url, token, name, args, id = 10) {
  return rawHttp(`${url}/mcp`, { headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) });
}

test('OAuth HTTP flow, token binding/rotation/reuse, MCP auth and legacy coexistence', async t => {
  const { url, issuer, resource } = await startOAuthHarness(t);
  const metadata = await rawHttp(`${url}/.well-known/oauth-authorization-server`, { method: 'GET' });
  assert.equal(metadata.status, 200);
  assert.equal(JSON.parse(metadata.text).code_challenge_methods_supported[0], 'S256');
  const clientId = await register(url, 'QA Chat');
  const unrelatedClientId = await register(url, 'Other registered app');
  const { tokens: first } = await authorize(url, { clientId, issuer, resource });

  const missingBearer = await rawHttp(`${url}/mcp`, { headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
  assert.equal(missingBearer.status, 401);
  assert.match(missingBearer.headers['www-authenticate'], /Bearer/);
  assert.match(missingBearer.headers['www-authenticate'], /resource_metadata=/);
  const wrongBearer = await mcp(url, 'x'.repeat(43));
  assert.equal(wrongBearer.status, 401);
  assert.match(wrongBearer.headers['www-authenticate'], /error="invalid_token"/);
  const goodMcp = await mcp(url, first.access_token);
  assert.equal(goodMcp.status, 200, goodMcp.text);
  assert.match(goodMcp.text, /projeqtor-mcp-server/);

  // Public client IDs are not sufficient authority to revoke another client's token.
  const crossClientRevoke = await rawHttp(`${url}/revoke`, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ token: first.refresh_token, client_id: unrelatedClientId }) });
  assert.equal(crossClientRevoke.status, 200);
  assert.equal((await mcp(url, first.access_token)).status, 200, 'foreign-client revocation must be a no-op');

  const rotatedResponse = await rawHttp(`${url}/token`, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'refresh_token', client_id: clientId, refresh_token: first.refresh_token, resource }) });
  assert.equal(rotatedResponse.status, 200, rotatedResponse.text);
  const rotated = JSON.parse(rotatedResponse.text);
  assert.notEqual(rotated.refresh_token, first.refresh_token);
  assert.equal((await mcp(url, rotated.access_token)).status, 200);
  const reuse = await rawHttp(`${url}/token`, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'refresh_token', client_id: clientId, refresh_token: first.refresh_token, resource }) });
  assert.equal(reuse.status, 400);
  assert.equal(JSON.parse(reuse.text).error, 'invalid_grant');
  const revokedDescendant = await mcp(url, rotated.access_token);
  assert.equal(revokedDescendant.status, 401, 'refresh-token reuse must revoke access descendants');
  const descendantRefresh = await rawHttp(`${url}/token`, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'refresh_token', client_id: clientId, refresh_token: rotated.refresh_token, resource }) });
  assert.equal(descendantRefresh.status, 400);

  const { tokens: reauthenticated } = await authorize(url, { clientId, issuer, resource });
  assert.equal((await mcp(url, reauthenticated.access_token, 2)).status, 200, 'reauthorization should produce a fresh usable family');
  const legacy = await mcp(url, 'legacy-qa-token-which-is-long-and-unique-998877', 3);
  assert.equal(legacy.status, 200, 'configured legacy bearer remains accepted in both mode');

  const deniedClient = await rawHttp(`${url}/token`, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'refresh_token', client_id: unrelatedClientId, refresh_token: reauthenticated.refresh_token, resource }) });
  assert.equal(deniedClient.status, 400);
  assert.equal(JSON.parse(deniedClient.text).error, 'invalid_grant');

  const { tokens: readOnly } = await authorize(url, { clientId, issuer, resource, scope: 'mcp:read' });
  const deniedWrite = await callTool(url, readOnly.access_token, 'create_activity', { projectId: 1, name: 'must-not-run' });
  assert.equal(deniedWrite.status, 403);
  assert.match(deniedWrite.text, /insufficient_scope/);
  assert.match(deniedWrite.headers['www-authenticate'], /resource_metadata=/);
  assert.match(deniedWrite.headers['www-authenticate'], /scope="mcp:write"/);
});

test('ChatGPT stable CIMD client_id passes authorization validation with canonical issuer', async t => {
  const { url, issuer, resource } = await startOAuthHarness(t);
  const metadata = await rawHttp(`${url}/.well-known/oauth-authorization-server`, { method: 'GET' });
  const metadataJson = JSON.parse(metadata.text);
  assert.equal(metadataJson.issuer, new URL(issuer).href);
  assert.equal(metadataJson.client_id_metadata_document_supported, true);
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const query = new URLSearchParams({ response_type: 'code', client_id: 'https://chatgpt.com/oauth/client.json',
    redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect', scope: 'mcp:read mcp:write', resource,
    code_challenge: challenge, code_challenge_method: 'S256', state: 'chatgpt-cimd-state' });
  const response = await rawHttp(`${url}/authorize?${query}`, { method: 'GET' });
  assert.equal(response.status, 200, response.text);
  assert.match(response.text, /Sign in|Log in|username/i);
});

test('OAuth browser form POST accepts the configured public origin through a proxy boundary', async t => {
  const { url, resource } = await startOAuthHarness(t);
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const query = new URLSearchParams({ response_type: 'code', client_id: 'https://chatgpt.com/oauth/client.json',
    redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect', scope: 'mcp:read', resource,
    code_challenge: challenge, code_challenge_method: 'S256', state: 'proxy-origin-state' });
  const boundaryHeaders = { Host: 'oauth.example', Origin: 'https://oauth.example' };
  const login = await rawHttp(`${url}/authorize?${query}`, { method: 'GET', headers: boundaryHeaders });
  assert.equal(login.status, 200, login.text);
  const setCookie = Array.isArray(login.headers['set-cookie']) ? login.headers['set-cookie'][0] : login.headers['set-cookie'];
  const cookie = setCookie?.split(';')[0];
  const csrf = hidden(login.text, 'csrf_token');
  const authenticated = await rawHttp(`${url}/oauth/login`, { headers: { ...boundaryHeaders, cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ csrf_token: csrf, username: 'qa-user', password: 'qa-password' }) });
  assert.equal(authenticated.status, 200, authenticated.text);
  assert.match(authenticated.text, /Authorize access/);
});

test('OAuth HTTP form handlers reject oversized bodies and duplicate security parameters', async t => {
  const { url } = await startOAuthHarness(t);
  const oversized = await rawHttp(`${url}/token`, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `x=${'a'.repeat(20_000)}` });
  assert.equal(oversized.status, 400);
  const duplicate = await rawHttp(`${url}/token`, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'authorization_code', client_id: 'a', resource: 'x' }) + '&client_id=b' });
  assert.equal(duplicate.status, 400);
});
