import { createHash, timingSafeEqual } from 'node:crypto';
import { OAuthTokenError, OAuthTokenService } from './tokens.js';

export type ResourceAuthMode = 'legacy' | 'oauth' | 'both';
export interface ResourceAuthOptions {
  readonly mode: ResourceAuthMode;
  readonly bearerToken?: string;
  readonly oauth?: { readonly issuer: string; readonly resource: string; readonly resourceMetadataUrl: string; readonly scopes: readonly string[] };
}
export interface ValidatedAuthContext { readonly subject: string; readonly clientId: string; readonly scopes: readonly string[]; readonly method: 'legacy' | 'oauth'; readonly expiresAt?: number; }
export interface ResourceAuthorizationError extends Error { readonly status: 401 | 403; readonly headers: Readonly<Record<string, string>>; }

export class ResourceAuthError extends Error {
  constructor(readonly status: 401 | 403, readonly code: 'invalid_token' | 'insufficient_scope', readonly headers: Readonly<Record<string, string>>) {
    super(code); this.name = 'ResourceAuthError';
  }
}

function digest(value: string): Buffer { return createHash('sha256').update(value, 'utf8').digest(); }
function staticMatch(value: string, expected: string): boolean { return timingSafeEqual(digest(value), digest(`Bearer ${expected}`)); }
function parseBearer(values: readonly string[] | undefined): string | undefined {
  if (!values || values.length !== 1 || typeof values[0] !== 'string') return undefined;
  const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i.exec(values[0]);
  return match?.[1];
}

/** Build RFC 9728 Bearer challenge parameters with stable, escaped values. */
export function bearerChallenge(options: Pick<ResourceAuthOptions, 'oauth'>, input: { scope?: string; error?: string } = {}): string {
  const params: string[] = [];
  if (options.oauth?.resourceMetadataUrl) params.push(`resource_metadata="${options.oauth.resourceMetadataUrl.replace(/["\\]/g, '\\$&')}"`);
  if (input.scope) params.push(`scope="${input.scope.replace(/["\\]/g, '\\$&')}"`);
  if (input.error) params.push(`error="${input.error}"`);
  return `Bearer${params.length ? ` ${params.join(', ')}` : ''}`;
}

export function resourceAuthFailure(options: Pick<ResourceAuthOptions, 'oauth'>, status: 401 | 403, input: { scope?: string; error?: string } = {}): ResourceAuthError {
  const code = status === 403 ? 'insufficient_scope' : 'invalid_token';
  const error = input.error ?? (status === 403 ? code : undefined);
  return new ResourceAuthError(status, code, Object.freeze({ 'WWW-Authenticate': bearerChallenge(options, { ...(input.scope ? { scope: input.scope } : {}), ...(error ? { error } : {}) }) }));
}

/** Validate one Authorization header. OAuth failures never fall through to the static credential. */
export function verifyResourceAuthorization(
  authorizationValues: readonly string[] | undefined,
  options: ResourceAuthOptions,
  tokenService?: OAuthTokenService,
  requiredScope?: string
): ValidatedAuthContext {
  const token = parseBearer(authorizationValues);
  if (!token) throw resourceAuthFailure(options, 401);
  if (options.mode !== 'oauth' && options.bearerToken && staticMatch(`Bearer ${token}`, options.bearerToken))
    return Object.freeze({ subject: 'legacy', clientId: 'legacy-static-client', scopes: Object.freeze(['mcp:read', 'mcp:write']), method: 'legacy' });
  if (options.mode === 'legacy' || !tokenService || !options.oauth) throw resourceAuthFailure(options, 401);
  let record;
  try { record = tokenService.validateAccess(token, { issuer: options.oauth.issuer, audience: options.oauth.resource }); }
  catch (error) {
    if (error instanceof OAuthTokenError && error.code === 'insufficient_scope') throw resourceAuthFailure(options, 403, requiredScope ? { scope: requiredScope } : {});
    throw resourceAuthFailure(options, 401, { error: 'invalid_token' });
  }
  if (requiredScope && !record.scopes.includes(requiredScope)) throw resourceAuthFailure(options, 403, { scope: requiredScope });
  return Object.freeze({ subject: record.userId, clientId: record.clientId, scopes: Object.freeze([...record.scopes]), method: 'oauth', expiresAt: Math.floor(record.expiresAt / 1000) });
}
