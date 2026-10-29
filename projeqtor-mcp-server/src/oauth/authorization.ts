import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { validatePublicHttpsIdentifier } from './discovery.js';

export interface OAuthClientRegistration {
  readonly clientId: string;
  readonly redirectUris: readonly string[];
  readonly allowedScopes: readonly string[];
  readonly allowedResources: readonly string[];
}

export interface OAuthAuthorizationRequest {
  readonly response_type?: unknown;
  readonly client_id?: unknown;
  readonly redirect_uri?: unknown;
  readonly scope?: unknown;
  readonly state?: unknown;
  readonly resource?: unknown;
  readonly code_challenge?: unknown;
  readonly code_challenge_method?: unknown;
}

export interface AuthorizationContext {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly resource: string;
  readonly userId: string;
  readonly scopes: readonly string[];
  readonly codeChallenge: string;
  readonly state?: string;
}

export interface StoredAuthorizationCode extends AuthorizationContext {
  readonly codeHash: string;
  readonly expiresAt: number;
}

/** Implementations must make consume atomic: exactly one concurrent caller may receive a live code. */
export interface AuthorizationCodeRepository {
  create(record: StoredAuthorizationCode): Promise<void>;
  consume(codeHash: string, now: number): Promise<StoredAuthorizationCode | undefined>;
}

export class InMemoryAuthorizationCodeRepository implements AuthorizationCodeRepository {
  readonly #records = new Map<string, StoredAuthorizationCode>();
  async create(record: StoredAuthorizationCode): Promise<void> {
    if (this.#records.has(record.codeHash)) throw new Error('Authorization code collision.');
    this.#records.set(record.codeHash, Object.freeze({ ...record, scopes: Object.freeze([...record.scopes]) }));
  }
  async consume(codeHash: string, now: number): Promise<StoredAuthorizationCode | undefined> {
    const record = this.#records.get(codeHash);
    if (!record) return undefined;
    this.#records.delete(codeHash);
    return record.expiresAt > now ? record : undefined;
  }
}

export type OAuthErrorCode = 'invalid_request' | 'unauthorized_client' | 'unsupported_response_type' |
  'invalid_scope' | 'invalid_target' | 'access_denied' | 'server_error';

export class AuthorizationRequestError extends Error {
  constructor(readonly oauthError: OAuthErrorCode, message = 'Invalid authorization request.', readonly redirectUri?: string, readonly state?: string) {
    super(message);
    this.name = 'AuthorizationRequestError';
  }
}

const MAX_CODE_AGE_MS = 5 * 60_000;
const STATE_RE = /^[\x21-\x7e]{1,1024}$/;
const CLIENT_ID_RE = /^[A-Za-z0-9._~-]{1,200}$/;
const SCOPE_RE = /^[\x21\x23-\x5B\x5D-\x7E]{1,128}$/;

function validRedirect(value: string): URL | undefined {
  if (value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.hash || url.href !== value) return undefined;
    return url;
  } catch { return undefined; }
}

export function validateRedirectUri(uri: string, registeredUris: readonly string[]): boolean {
  return validRedirect(uri) !== undefined && registeredUris.some(registered => registered === uri && validRedirect(registered) !== undefined);
}

function safeState(value: unknown): string | undefined {
  return typeof value === 'string' && STATE_RE.test(value) ? value : undefined;
}

/**
 * OAuth client_id is normally an opaque token, but CIMD deliberately uses an
 * HTTPS metadata-document URL. Accept only the two bounded forms here; the
 * registry lookup below remains the authority and no URL is fetched.
 */
function validClientIdSyntax(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048 || !/^[\x21-\x7e]+$/.test(value)) return false;
  if (CLIENT_ID_RE.test(value)) return true;
  try { return validatePublicHttpsIdentifier(value, 'client_id') === value; } catch { return false; }
}

export interface ValidatedAuthorizationRequest {
  readonly client: OAuthClientRegistration;
  readonly context: Omit<AuthorizationContext, 'userId'>;
}

/** Validate untrusted query parameters. A redirect is attached to errors only after exact client registration is established. */
export function validateAuthorizationRequest(
  request: OAuthAuthorizationRequest,
  clients: ReadonlyMap<string, OAuthClientRegistration>,
  expectedResource: string
): ValidatedAuthorizationRequest {
  if (request.response_type !== 'code') throw new AuthorizationRequestError('unsupported_response_type');
  if (!validClientIdSyntax(request.client_id)) throw new AuthorizationRequestError('invalid_request');
  const client = clients.get(request.client_id);
  if (!client) throw new AuthorizationRequestError('unauthorized_client');
  const state = request.state === undefined ? undefined : safeState(request.state);
  if (request.state !== undefined && state === undefined) throw new AuthorizationRequestError('invalid_request');
  if (typeof request.redirect_uri !== 'string' || !validateRedirectUri(request.redirect_uri, client.redirectUris))
    throw new AuthorizationRequestError('invalid_request', 'Invalid authorization request.');
  const redirectUri = request.redirect_uri;
  const resource = request.resource;
  if (typeof resource !== 'string' || resource !== expectedResource || !client.allowedResources.includes(resource))
    throw new AuthorizationRequestError('invalid_target', 'Invalid authorization request.', redirectUri, state);
  if (typeof request.scope !== 'string' || request.scope.length > 2048)
    throw new AuthorizationRequestError('invalid_scope', 'Invalid authorization request.', redirectUri, state);
  const scopes = request.scope.split(' ');
  if (!scopes.length || scopes.some(s => !SCOPE_RE.test(s)) || new Set(scopes).size !== scopes.length || scopes.some(s => !client.allowedScopes.includes(s)))
    throw new AuthorizationRequestError('invalid_scope', 'Invalid authorization request.', redirectUri, state);
  if (typeof request.code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(request.code_challenge) ||
      request.code_challenge_method !== 'S256')
    throw new AuthorizationRequestError('invalid_request', 'Invalid authorization request.', redirectUri, state);
  const context: Omit<AuthorizationContext, 'userId'> = { clientId: client.clientId, redirectUri, resource,
    scopes: Object.freeze(scopes), codeChallenge: request.code_challenge, ...(state === undefined ? {} : { state }) };
  return Object.freeze({ client, context: Object.freeze(context) });
}

export interface IssuedAuthorizationCode { readonly code: string; readonly expiresAt: number; }

export async function issueAuthorizationCode(
  repository: AuthorizationCodeRepository,
  context: AuthorizationContext,
  now = Date.now()
): Promise<IssuedAuthorizationCode> {
  const code = randomBytes(32).toString('base64url');
  const codeHash = createHash('sha256').update(code).digest('base64url');
  const expiresAt = now + MAX_CODE_AGE_MS;
  await repository.create(Object.freeze({ ...context, scopes: Object.freeze([...context.scopes]), codeHash, expiresAt }));
  return Object.freeze({ code, expiresAt });
}

export async function consumeAuthorizationCode(repository: AuthorizationCodeRepository, code: string, now = Date.now()): Promise<StoredAuthorizationCode | undefined> {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code)) return undefined;
  const codeHash = createHash('sha256').update(code).digest('base64url');
  return repository.consume(codeHash, now);
}

export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier) || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) return false;
  const actual = createHash('sha256').update(codeVerifier).digest();
  const expected = Buffer.from(codeChallenge, 'base64url');
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

export function authorizationSuccessRedirect(issuer: string, redirectUri: string, code: string, state?: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set('code', code);
  if (state !== undefined) url.searchParams.set('state', state);
  url.searchParams.set('iss', issuer);
  return url.href;
}

export function authorizationErrorRedirect(issuer: string, redirectUri: string, error: OAuthErrorCode, state?: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  if (state !== undefined) url.searchParams.set('state', state);
  url.searchParams.set('iss', issuer);
  return url.href;
}
