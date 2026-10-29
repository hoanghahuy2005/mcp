import { createHash, randomBytes } from 'node:crypto';
import { InMemoryTokenRepository, type AccessRecord, type TokenGrant, type TokenRepository } from './token-store.js';

export type OAuthFailure = 'invalid_request' | 'invalid_grant' | 'invalid_token' | 'insufficient_scope';
export class OAuthTokenError extends Error {
  readonly code: OAuthFailure;
  constructor(code: OAuthFailure) { super(code); this.name = 'OAuthTokenError'; this.code = code; }
  toJSON(): { name: string; code: OAuthFailure } { return { name: this.name, code: this.code }; }
}
export interface TokenOptions {
  userId: string; issuer: string; audience: string; clientId: string; scopes: readonly string[];
  accessTtlSeconds?: number; refreshTtlSeconds?: number; refreshIdleTtlSeconds?: number;
}
export interface TokenResponse { access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token: string; scope: string; }
export interface OAuthTokenServiceOptions { repository?: TokenRepository; now?: () => number; accessTtlSeconds?: number; refreshTtlSeconds?: number; refreshIdleTtlSeconds?: number; }
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const validText = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 2048 && !/[\x00-\x1f\x7f]/.test(x);
const cleanScopes = (scopes: readonly string[]): string[] => {
  if (!Array.isArray(scopes) || scopes.length > 128 || scopes.some(s => !/^[\x21-\x7e]{1,128}$/.test(s))) throw new OAuthTokenError('invalid_request');
  return [...new Set(scopes)].sort();
};
const mint = (): string => randomBytes(32).toString('base64url');
const digest = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

/** Opaque OAuth token lifecycle. Raw credentials are returned only to the caller once. */
export class OAuthTokenService {
  readonly repository: TokenRepository;
  private readonly now: () => number;
  private readonly defaults: Required<Pick<TokenOptions, 'accessTtlSeconds' | 'refreshTtlSeconds' | 'refreshIdleTtlSeconds'>>;
  constructor(options: OAuthTokenServiceOptions = {}) {
    this.repository = options.repository ?? new InMemoryTokenRepository(); this.now = options.now ?? Date.now;
    this.defaults = { accessTtlSeconds: options.accessTtlSeconds ?? 600, refreshTtlSeconds: options.refreshTtlSeconds ?? 30 * 86400, refreshIdleTtlSeconds: options.refreshIdleTtlSeconds ?? 7 * 86400 };
  }
  issue(input: TokenOptions): TokenResponse {
    this.validateOptions(input);
    const now = this.now(), accessTtl = input.accessTtlSeconds ?? this.defaults.accessTtlSeconds;
    const refreshTtl = input.refreshTtlSeconds ?? this.defaults.refreshTtlSeconds, idleTtl = input.refreshIdleTtlSeconds ?? this.defaults.refreshIdleTtlSeconds;
    this.validateTtls(accessTtl, refreshTtl, idleTtl);
    const familyId = randomBytes(16).toString('hex'), access = mint(), refresh = mint(), scopes = cleanScopes(input.scopes);
    this.repository.prepareIssue();
    this.repository.addFamily(familyId);
    this.repository.putAccess(digest(access), { familyId, userId: input.userId, issuer: input.issuer, audience: input.audience, clientId: input.clientId, scopes, expiresAt: now + accessTtl * 1000, revoked: false });
    this.repository.putRefresh(digest(refresh), { familyId, userId: input.userId, issuer: input.issuer, audience: input.audience, clientId: input.clientId, scopes, expiresAt: now + refreshTtl * 1000, idleExpiresAt: now + idleTtl * 1000, revoked: false, used: false });
    return { access_token: access, token_type: 'Bearer', expires_in: accessTtl, refresh_token: refresh, scope: scopes.join(' ') };
  }
  refresh(input: { refreshToken: string; clientId: string; audience: string; issuer?: string; scopes?: readonly string[] }): TokenResponse {
    if (!validText(input.clientId) || !validText(input.audience) || (input.issuer !== undefined && !validText(input.issuer))) throw new OAuthTokenError('invalid_request');
    if (!tokenPattern.test(input.refreshToken)) throw new OAuthTokenError('invalid_grant');
    const hash = digest(input.refreshToken), now = this.now(), record = this.repository.getRefresh(hash);
    if (!record) throw new OAuthTokenError('invalid_grant');
    // No awaits occur between lookup and consume: single-process concurrent calls serialize here.
    if (record.used || record.revoked) { this.repository.revokeFamily(record.familyId); throw new OAuthTokenError('invalid_grant'); }
    if (record.expiresAt <= now || record.idleExpiresAt <= now || record.clientId !== input.clientId || record.audience !== input.audience || (input.issuer !== undefined && record.issuer !== input.issuer)) throw new OAuthTokenError('invalid_grant');
    const asked = input.scopes === undefined ? record.scopes : cleanScopes(input.scopes);
    if (asked.some(s => !record.scopes.includes(s))) throw new OAuthTokenError('invalid_grant');
    this.repository.prepareIssue();
    this.repository.markRefreshUsed(hash);
    const access = mint(), refresh = mint(), accessTtl = this.defaults.accessTtlSeconds;
    this.repository.putAccess(digest(access), { ...record, scopes: asked, expiresAt: now + accessTtl * 1000, revoked: false });
    this.repository.putRefresh(digest(refresh), { ...record, scopes: asked, idleExpiresAt: Math.min(record.expiresAt, now + this.defaults.refreshIdleTtlSeconds * 1000), revoked: false, used: false });
    return { access_token: access, token_type: 'Bearer', expires_in: accessTtl, refresh_token: refresh, scope: asked.join(' ') };
  }
  validateAccess(token: string, expected: { issuer: string; audience: string; clientId?: string; scopes?: readonly string[] }): Readonly<AccessRecord> {
    if (!tokenPattern.test(token ?? '')) throw new OAuthTokenError('invalid_token');
    const record = this.repository.getAccess(digest(token));
    if (!record || record.revoked || record.expiresAt <= this.now() || !this.repository.isFamilyActive(record.familyId) || record.issuer !== expected.issuer || record.audience !== expected.audience || (expected.clientId !== undefined && record.clientId !== expected.clientId)) throw new OAuthTokenError('invalid_token');
    if (expected.scopes && expected.scopes.some(s => !record.scopes.includes(s))) throw new OAuthTokenError('insufficient_scope');
    return Object.freeze({ ...record, scopes: Object.freeze([...record.scopes]) });
  }
  revoke(input: { token: string; tokenTypeHint?: string; clientId?: string }): void {
    if (!validText(input.token) || input.token.length > 4096) throw new OAuthTokenError('invalid_request');
    // RFC 7009: unknown, malformed, or already revoked tokens are indistinguishable.
    if (!tokenPattern.test(input.token)) return;
    const hash = digest(input.token);
    const a = this.repository.getAccess(hash), r = this.repository.getRefresh(hash);
    if (a && (input.clientId === undefined || a.clientId === input.clientId)) this.repository.revokeFamily(a.familyId);
    else if (r && (input.clientId === undefined || r.clientId === input.clientId)) this.repository.revokeFamily(r.familyId);
    void input.tokenTypeHint; // Hint never changes lookup behavior.
  }
  listGrants(userId: string): readonly TokenGrant[] {
    if (!validText(userId)) throw new OAuthTokenError('invalid_request');
    return this.repository.listActiveGrants(userId);
  }
  revokeGrant(userId: string, grantId: string): boolean {
    if (!validText(userId) || !/^[A-Za-z0-9_-]{22}$/.test(grantId)) throw new OAuthTokenError('invalid_request');
    return this.repository.revokeGrant(userId, grantId);
  }
  prune(): number { return this.repository.prune(this.now()); }
  private validateOptions(x: TokenOptions): void {
    if (!validText(x.userId) || !validText(x.issuer) || !validText(x.audience) || !validText(x.clientId)) throw new OAuthTokenError('invalid_request');
    cleanScopes(x.scopes);
  }
  private validateTtls(a: number, r: number, i: number): void {
    if (![a, r, i].every(x => Number.isSafeInteger(x) && x > 0 && x <= 365 * 86400) || i > r) throw new OAuthTokenError('invalid_request');
  }
}
