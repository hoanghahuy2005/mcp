import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OAuthConfig } from '../config.js';
import { log } from '../logging.js';
import { AuthorizationRequestError, InMemoryAuthorizationCodeRepository, authorizationErrorRedirect, authorizationSuccessRedirect,
  consumeAuthorizationCode, issueAuthorizationCode, validateAuthorizationRequest, verifyPkceS256, type ValidatedAuthorizationRequest } from './authorization.js';
import { registerPublicClient } from './client-registration.js';
import { FileOAuthClientStore, type StoredOAuthClient } from './client-store.js';
import { createAuthorizationServerMetadata, createProtectedResourceMetadata, oauthEndpoints } from './discovery.js';
import { FileTokenRepository } from './token-store.js';
import { OAuthTokenError, OAuthTokenService } from './tokens.js';
import { oauthUiHeaders, parseConsentDecision, renderConnectionsPage, renderConsentPage, renderLoginPage, renderRevokeConfirmation, renderRevokeResult } from './ui.js';
import { ProjeqtorApiUserAuthenticator, type UserAuthenticator } from './user-authenticator.js';

const BODY_LIMIT = 16_384;
const SESSION_TTL_MS = 15 * 60_000;
const COOKIE = 'projeqtor_oauth';
const STYLE = `:root{font-family:system-ui,sans-serif;color:#263238;background:#f4f6f8}body{margin:0}main{max-width:42rem;margin:5vh auto;background:#fff;border:1px solid #d8dee3;border-radius:.6rem;padding:2rem;box-shadow:0 .25rem 1.2rem #0001}header{color:#1676a3;font-weight:700;border-bottom:1px solid #e4e8eb;margin-bottom:1.5rem}label{display:block;font-weight:600;margin-top:1rem}input{box-sizing:border-box;width:100%;padding:.65rem;border:1px solid #aeb8bf;border-radius:.3rem}button,.button{margin:.9rem .5rem 0 0;padding:.65rem 1rem;border:0;border-radius:.3rem;background:#1676a3;color:white;cursor:pointer}.secondary{background:#5d6b73}button:disabled{opacity:.65;cursor:wait}.error{color:#a32323}code{overflow-wrap:anywhere}li{margin:.5rem 0}@media(max-width:48rem){main{margin:0;border:0;border-radius:0;min-height:100vh}}`;
const CONSENT_SCRIPT = `document.addEventListener('DOMContentLoaded',()=>{const f=document.querySelector('form[action="/oauth/consent"]');if(!f)return;let sent=false;f.addEventListener('submit',e=>{if(sent){e.preventDefault();return}const submitter=e.submitter;if(submitter&&submitter.name&&submitter.value){const selected=document.createElement('input');selected.type='hidden';selected.name=submitter.name;selected.value=submitter.value;f.appendChild(selected)}sent=true;f.querySelectorAll('button[type="submit"]').forEach(b=>{b.disabled=true;b.setAttribute('aria-disabled','true');if(b.value==='approve')b.textContent='Processing…'})})});`;

interface BrowserSession {
  readonly csrf: string;
  expiresAt: number;
  pending: ValidatedAuthorizationRequest | undefined;
  clientName?: string;
  userId?: string;
  manageConnections?: boolean;
}

export interface OAuthHttpServiceOptions { readonly authenticator?: UserAuthenticator; readonly tokenService?: OAuthTokenService; readonly now?: () => number; }

export class OAuthHttpService {
  readonly tokenService: OAuthTokenService;
  private readonly codes = new InMemoryAuthorizationCodeRepository();
  private readonly clients: FileOAuthClientStore;
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly authenticator: UserAuthenticator;
  private readonly now: () => number;
  private readonly metadata: Readonly<Record<string, unknown>>;
  private readonly protectedMetadata: Readonly<Record<string, unknown>>;

  readonly config: OAuthConfig;

  constructor(config: OAuthConfig, options: OAuthHttpServiceOptions = {}) {
    // OAuth identifiers are URL values. Keep one canonical representation
    // internally so an issuer configured as https://host and one configured as
    // https://host/ produce identical discovery, iss, and token bindings.
    const issuer = new URL(config.issuer).href;
    const resource = new URL(config.resource).href;
    this.config = Object.freeze({ ...config, issuer, resource,
      resourceMetadataUrl: new URL('/.well-known/oauth-protected-resource', issuer).href });
    this.now = options.now ?? Date.now;
    this.tokenService = options.tokenService ?? new OAuthTokenService({ repository: new FileTokenRepository(this.config.stateDirectory), now: this.now,
      accessTtlSeconds: this.config.accessTtlSeconds, refreshTtlSeconds: this.config.refreshTtlSeconds, refreshIdleTtlSeconds: this.config.refreshIdleTtlSeconds });
    this.authenticator = options.authenticator ?? new ProjeqtorApiUserAuthenticator({ baseUrl: this.config.projeqtorBaseUrl,
      ...(this.config.projeqtorTimeoutMs === undefined ? {} : { timeoutMs: this.config.projeqtorTimeoutMs }),
      ...(this.config.projeqtorMaxResponseBytes === undefined ? {} : { maxResponseBytes: this.config.projeqtorMaxResponseBytes }) });
    const initial: StoredOAuthClient = { clientId: this.config.chatgptClientId, clientName: 'ChatGPT', redirectUris: [this.config.chatgptRedirectUri],
      allowedScopes: this.config.scopes, allowedResources: [this.config.resource] };
    this.clients = new FileOAuthClientStore(this.config.stateDirectory, [initial]);
    const endpoints = oauthEndpoints(this.config.issuer, this.config.resource, this.config.scopes);
    this.protectedMetadata = createProtectedResourceMetadata(endpoints);
    this.metadata = Object.freeze({ ...createAuthorizationServerMetadata(endpoints), client_id_metadata_document_supported: true,
      scopes_supported: Object.freeze([...config.scopes]) });
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', this.config.issuer);
    if (req.method === 'GET' && (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp')) {
      json(res, 200, this.protectedMetadata); return true;
    }
    if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') { json(res, 200, this.metadata); return true; }
    if (req.method === 'GET' && url.pathname === '/oauth/style.css') {
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' }); res.end(STYLE); return true;
    }
    if (req.method === 'GET' && url.pathname === '/oauth/consent.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(CONSENT_SCRIPT); return true;
    }
    if (req.method === 'POST' && url.pathname === '/register') { await this.register(req, res); return true; }
    if (req.method === 'GET' && url.pathname === '/authorize') { this.authorize(url, res); return true; }
    if (req.method === 'POST' && url.pathname === '/oauth/login') { await this.login(req, res); return true; }
    if (req.method === 'POST' && url.pathname === '/oauth/consent') { await this.consent(req, res); return true; }
    if (req.method === 'POST' && url.pathname === '/token') { await this.token(req, res); return true; }
    if (req.method === 'POST' && url.pathname === '/revoke') { await this.revoke(req, res); return true; }
    if (req.method === 'GET' && url.pathname === '/oauth/connections') { this.connections(req, res); return true; }
    if (req.method === 'POST' && url.pathname === '/oauth/connections/revoke') { await this.revokePage(req, res, false); return true; }
    if (req.method === 'POST' && url.pathname === '/oauth/connections/revoke/confirm') { await this.revokePage(req, res, true); return true; }
    return false;
  }

  private authorize(url: URL, res: ServerResponse): void {
    try {
      const input: Record<string, unknown> = {};
      for (const key of ['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'resource', 'code_challenge', 'code_challenge_method']) {
        const values = url.searchParams.getAll(key); if (values.length > 1) throw new AuthorizationRequestError('invalid_request'); if (values.length === 1) input[key] = values[0];
      }
      const validated = validateAuthorizationRequest(input, this.clients.asMap(), this.config.resource);
      const id = secret(), session: BrowserSession = { csrf: secret(), expiresAt: this.now() + SESSION_TTL_MS, pending: validated,
        clientName: this.clients.get(validated.client.clientId)?.clientName ?? 'OAuth client' };
      this.sessions.set(id, session);
      html(res, 200, renderLoginPage({ csrfToken: session.csrf }), cookie(id));
    } catch (error) {
      if (error instanceof AuthorizationRequestError && error.redirectUri) redirect(res, authorizationErrorRedirect(this.config.issuer, error.redirectUri, error.oauthError, error.state));
      else oauthError(res, 400, error instanceof AuthorizationRequestError ? error.oauthError : 'invalid_request');
    }
  }

  private async login(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const session = this.session(req); if (!session || (!session.pending && !session.manageConnections)) {
      log('oauth_rejected', { status: 400, method: 'POST', reason: 'login_session_missing' });
      oauthError(res, 400, 'invalid_request'); return;
    }
    const form = await formBody(req).catch(() => undefined);
    if (!form || one(form, 'csrf_token') !== session.csrf) {
      log('oauth_rejected', { status: 400, method: 'POST', reason: form ? 'login_csrf_invalid' : 'login_form_invalid' });
      oauthError(res, 400, 'invalid_request'); return;
    }
    const username = one(form, 'username'), password = one(form, 'password');
    const identity = username !== undefined && password !== undefined ? await this.authenticator.authenticate(username, password) : undefined;
    if (!identity || (this.config.allowedUserId !== undefined && identity.subject.toLowerCase() !== this.config.allowedUserId.toLowerCase())) {
      log('oauth_rejected', { status: 401, method: 'POST', reason: 'login_credentials_invalid' });
      html(res, 401, renderLoginPage({ csrfToken: session.csrf, error: true })); return;
    }
    session.userId = identity.subject; session.expiresAt = this.now() + SESSION_TTL_MS;
    if (session.manageConnections && !session.pending) { redirect(res, '/oauth/connections'); return; }
    const pending = session.pending!;
    html(res, 200, renderConsentPage({ csrfToken: session.csrf, clientName: session.clientName ?? 'OAuth client', clientId: pending.client.clientId,
      resource: pending.context.resource, scopes: pending.context.scopes }));
  }

  private async consent(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const session = this.session(req); if (!session?.pending || !session.userId) { oauthError(res, 400, 'invalid_request'); return; }
    const form = await formBody(req).catch(() => undefined);
    if (!form || one(form, 'csrf_token') !== session.csrf) { oauthError(res, 400, 'invalid_request'); return; }
    const decision = parseConsentDecision(one(form, 'decision'));
    if (decision === 'deny') { redirect(res, authorizationErrorRedirect(this.config.issuer, session.pending.context.redirectUri, 'access_denied', session.pending.context.state)); session.pending = undefined; return; }
    if (decision !== 'approve') { oauthError(res, 400, 'invalid_request'); return; }
    const issued = await issueAuthorizationCode(this.codes, { ...session.pending.context, userId: session.userId }, this.now());
    const location = authorizationSuccessRedirect(this.config.issuer, session.pending.context.redirectUri, issued.code, session.pending.context.state);
    session.pending = undefined; session.expiresAt = this.now() + SESSION_TTL_MS; redirect(res, location);
  }

  private async token(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.headers.authorization !== undefined) { oauthError(res, 401, 'invalid_client'); return; }
    const form = await formBody(req).catch(() => undefined); if (!form) { oauthError(res, 400, 'invalid_request'); return; }
    const grant = one(form, 'grant_type'), clientId = one(form, 'client_id'), resource = one(form, 'resource');
    if (!clientId || !this.clients.get(clientId) || resource !== this.config.resource) { oauthError(res, 400, clientId ? 'invalid_target' : 'invalid_client'); return; }
    try {
      if (grant === 'authorization_code') {
        const code = one(form, 'code'), redirectUri = one(form, 'redirect_uri'), verifier = one(form, 'code_verifier');
        const record = code ? await consumeAuthorizationCode(this.codes, code, this.now()) : undefined;
        if (!record || record.clientId !== clientId || record.redirectUri !== redirectUri || record.resource !== resource || !verifier || !verifyPkceS256(verifier, record.codeChallenge)) {
          oauthError(res, 400, 'invalid_grant'); return;
        }
        json(res, 200, this.tokenService.issue({ userId: record.userId, issuer: this.config.issuer, audience: record.resource, clientId,
          scopes: record.scopes, accessTtlSeconds: this.config.accessTtlSeconds, refreshTtlSeconds: this.config.refreshTtlSeconds,
          refreshIdleTtlSeconds: this.config.refreshIdleTtlSeconds })); return;
      }
      if (grant === 'refresh_token') {
        const refreshToken = one(form, 'refresh_token'), scope = one(form, 'scope');
        if (!refreshToken) { oauthError(res, 400, 'invalid_grant'); return; }
        json(res, 200, this.tokenService.refresh({ refreshToken, clientId, audience: resource, issuer: this.config.issuer,
          ...(scope === undefined ? {} : { scopes: scope.split(' ') }) })); return;
      }
      oauthError(res, 400, 'unsupported_grant_type');
    } catch (error) { oauthError(res, 400, error instanceof OAuthTokenError ? error.code : 'server_error'); }
  }

  private async revoke(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const form = await formBody(req).catch(() => undefined); if (!form) { oauthError(res, 400, 'invalid_request'); return; }
    const token = one(form, 'token'), clientId = one(form, 'client_id');
    if (!token || !clientId || !this.clients.get(clientId)) { oauthError(res, 400, clientId ? 'invalid_request' : 'invalid_client'); return; }
    try { this.tokenService.revoke({ token, clientId, ...(one(form, 'token_type_hint') ? { tokenTypeHint: one(form, 'token_type_hint')! } : {}) }); json(res, 200, {}); }
    catch (error) { oauthError(res, 400, error instanceof OAuthTokenError ? error.code : 'server_error'); }
  }

  private async register(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const raw = await body(req); if (!contentType(req, 'application/json')) throw new Error();
      const registered = registerPublicClient(JSON.parse(raw));
      const requested = registered.scope?.split(' ').filter(Boolean) ?? [...this.config.scopes];
      if (requested.some(scope => !this.config.scopes.includes(scope))) { oauthError(res, 400, 'invalid_client_metadata'); return; }
      this.clients.add({ clientId: registered.client_id, clientName: registered.client_name ?? 'OAuth client', redirectUris: registered.redirect_uris,
        allowedScopes: requested, allowedResources: [this.config.resource] });
      json(res, 201, { ...registered, client_id_issued_at: Math.floor(this.now() / 1000) });
    } catch { oauthError(res, 400, 'invalid_client_metadata'); }
  }

  private connections(req: IncomingMessage, res: ServerResponse): void {
    let session = this.session(req);
    if (!session) {
      const id = secret(); session = { csrf: secret(), expiresAt: this.now() + SESSION_TTL_MS, pending: undefined, manageConnections: true };
      this.sessions.set(id, session); html(res, 401, renderLoginPage({ csrfToken: session.csrf }), cookie(id)); return;
    }
    if (!session.userId) { html(res, 401, renderLoginPage({ csrfToken: session.csrf })); return; }
    const grants = this.tokenService.listGrants(session.userId).map(g => ({ grantId: g.grantId, clientId: g.clientId,
      clientName: this.clients.get(g.clientId)?.clientName ?? 'OAuth client', scopes: g.scopes, resource: g.audience }));
    html(res, 200, renderConnectionsPage({ csrfToken: session.csrf, grants }));
  }

  private async revokePage(req: IncomingMessage, res: ServerResponse, confirm: boolean): Promise<void> {
    const session = this.session(req); if (!session?.userId) { oauthError(res, 401, 'invalid_request'); return; }
    const form = await formBody(req).catch(() => undefined), grantId = form ? one(form, 'grant_id') : undefined;
    if (!form || one(form, 'csrf_token') !== session.csrf || !grantId) { oauthError(res, 400, 'invalid_request'); return; }
    const grant = this.tokenService.listGrants(session.userId).find(g => g.grantId === grantId);
    if (!grant) { html(res, 200, renderRevokeResult(false)); return; }
    if (!confirm) { html(res, 200, renderRevokeConfirmation({ csrfToken: session.csrf, clientName: this.clients.get(grant.clientId)?.clientName ?? 'OAuth client', grantId })); return; }
    if (one(form, 'decision') === 'cancel') { html(res, 200, renderRevokeResult(false)); return; }
    html(res, 200, renderRevokeResult(this.tokenService.revokeGrant(session.userId, grantId)));
  }

  private session(req: IncomingMessage): BrowserSession | undefined {
    this.pruneSessions(); const id = cookieValue(req.headers.cookie); if (!id) return undefined;
    const session = this.sessions.get(id); return session && session.expiresAt > this.now() ? session : undefined;
  }
  private pruneSessions(): void { for (const [id, value] of this.sessions) if (value.expiresAt <= this.now()) this.sessions.delete(id); }
}

function secret(): string { return randomBytes(32).toString('base64url'); }
function cookie(id: string): string { return `${COOKIE}=${id}; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; HttpOnly; Secure; SameSite=Lax`; }
function cookieValue(header: string | undefined): string | undefined {
  if (!header) return undefined; const values = header.split(';').map(x => x.trim()).filter(x => x.startsWith(`${COOKIE}=`));
  if (values.length !== 1) return undefined; const value = values[0]!.slice(COOKIE.length + 1); return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}
async function body(req: IncomingMessage): Promise<string> {
  const declared = Number(req.headers['content-length']); if (Number.isFinite(declared) && declared > BODY_LIMIT) throw new Error('body');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += value.length; if (size > BODY_LIMIT) throw new Error('body'); chunks.push(value); }
  return Buffer.concat(chunks).toString('utf8');
}
async function formBody(req: IncomingMessage): Promise<URLSearchParams> { if (!contentType(req, 'application/x-www-form-urlencoded')) throw new Error('type'); return new URLSearchParams(await body(req)); }
function contentType(req: IncomingMessage, expected: string): boolean { return req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() === expected; }
function one(form: URLSearchParams, name: string): string | undefined { const values = form.getAll(name); return values.length === 1 ? values[0] : undefined; }
function baseHeaders(): Record<string, string> { return { 'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' }; }
function json(res: ServerResponse, status: number, value: unknown): void { res.writeHead(status, { ...baseHeaders(), 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
function oauthError(res: ServerResponse, status: number, error: string): void { json(res, status, { error }); }
function html(res: ServerResponse, status: number, value: string, setCookie?: string): void {
  res.writeHead(status, { ...baseHeaders(), ...oauthUiHeaders, 'Content-Security-Policy': "default-src 'none'; style-src 'self'; script-src 'self'; form-action 'self' https://chatgpt.com; base-uri 'none'; frame-ancestors 'none'",
    ...(setCookie ? { 'Set-Cookie': setCookie } : {}) }); res.end(value);
}
function redirect(res: ServerResponse, location: string): void { res.writeHead(302, { ...baseHeaders(), Location: location }); res.end(); }
