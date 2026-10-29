export interface AccessRecord { familyId: string; userId: string; issuer: string; audience: string; clientId: string; scopes: readonly string[]; expiresAt: number; revoked: boolean; }
export interface RefreshRecord extends Omit<AccessRecord, 'expiresAt'> { expiresAt: number; idleExpiresAt: number; used: boolean; }
/** Repository contract. Implementations must make markRefreshUsed/revokeFamily atomic. */
export interface TokenRepository {
  prepareIssue(): void;
  addFamily(id: string): void; isFamilyActive(id: string): boolean;
  putAccess(hash: string, record: AccessRecord): void; getAccess(hash: string): AccessRecord | undefined;
  putRefresh(hash: string, record: RefreshRecord): void; getRefresh(hash: string): RefreshRecord | undefined;
  markRefreshUsed(hash: string): void; revokeFamily(id: string): void; prune(now: number): number;
  listActiveGrants(userId: string): readonly TokenGrant[]; revokeGrant(userId: string, grantId: string): boolean;
}
export interface TokenGrant { readonly grantId: string; readonly userId: string; readonly clientId: string; readonly audience: string; readonly scopes: readonly string[]; }

function grantId(familyId: string): string { return Buffer.from(familyId, 'hex').toString('base64url'); }

/** In-process store. It intentionally exposes no raw token values and has bounded growth. */
export class InMemoryTokenRepository implements TokenRepository {
  private readonly access = new Map<string, AccessRecord>();
  private readonly refresh = new Map<string, RefreshRecord>();
  private readonly families = new Map<string, boolean>();
  constructor(readonly maxRecords = 100_000) {
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 100 || maxRecords > 1_000_000) throw new RangeError('Invalid token store bound');
  }
  addFamily(id: string): void { this.ensureCapacity(); this.families.set(id, true); }
  prepareIssue(): void { if (this.access.size + this.refresh.size + 2 > this.maxRecords) throw new Error('OAuth token store capacity reached'); }
  isFamilyActive(id: string): boolean { return this.families.get(id) === true; }
  putAccess(hash: string, record: AccessRecord): void { this.ensureCapacity(); this.access.set(hash, cloneAccess(record)); }
  getAccess(hash: string): AccessRecord | undefined { const key = this.findDigest(this.access, hash); const r = key === undefined ? undefined : this.access.get(key); return r && cloneAccess(r); }
  putRefresh(hash: string, record: RefreshRecord): void { this.ensureCapacity(); this.refresh.set(hash, cloneRefresh(record)); }
  getRefresh(hash: string): RefreshRecord | undefined { const key = this.findDigest(this.refresh, hash); const r = key === undefined ? undefined : this.refresh.get(key); return r && cloneRefresh(r); }
  markRefreshUsed(hash: string): void { const r = this.refresh.get(hash); if (r) r.used = true; }
  revokeFamily(id: string): void {
    if (this.families.has(id)) this.families.set(id, false);
    for (const r of this.access.values()) if (r.familyId === id) r.revoked = true;
    for (const r of this.refresh.values()) if (r.familyId === id) r.revoked = true;
  }
  listActiveGrants(userId: string): readonly TokenGrant[] {
    const found = new Map<string, TokenGrant>();
    for (const r of this.refresh.values()) if (r.userId === userId && !r.revoked && this.isFamilyActive(r.familyId))
      found.set(r.familyId, { grantId: grantId(r.familyId), userId, clientId: r.clientId, audience: r.audience, scopes: [...r.scopes] });
    return [...found.values()];
  }
  revokeGrant(userId: string, id: string): boolean {
    const family = [...this.refresh.values()].find(r => r.userId === userId && grantId(r.familyId) === id)?.familyId;
    if (!family) return false;
    this.revokeFamily(family); return true;
  }
  prune(now: number): number {
    let removed = 0;
    for (const [k, r] of this.access) if (r.expiresAt <= now || !this.isFamilyActive(r.familyId)) { this.access.delete(k); removed++; }
    for (const [k, r] of this.refresh) if (r.expiresAt <= now || r.idleExpiresAt <= now || !this.isFamilyActive(r.familyId)) { this.refresh.delete(k); removed++; }
    const live = new Set([...this.access.values(), ...this.refresh.values()].map(r => r.familyId));
    for (const id of this.families.keys()) if (!live.has(id)) this.families.delete(id);
    return removed;
  }
  /** Safe diagnostic snapshot: hashes only, never access/refresh secrets. */
  toJSON(): object { return { access: [...this.access.keys()], refresh: [...this.refresh.keys()], families: this.families.size }; }
  private ensureCapacity(): void { if (this.access.size + this.refresh.size >= this.maxRecords) throw new Error('OAuth token store capacity reached'); }
  private findDigest<T>(map: Map<string, T>, hash: string): string | undefined {
    const target = Buffer.from(hash, 'hex');
    for (const key of map.keys()) { const candidate = Buffer.from(key, 'hex'); if (candidate.length === target.length && timingSafeEqual(candidate, target)) return key; }
    return undefined;
  }
}
function cloneAccess(r: AccessRecord): AccessRecord { return { ...r, scopes: [...r.scopes] }; }
function cloneRefresh(r: RefreshRecord): RefreshRecord { return { ...r, scopes: [...r.scopes] }; }

interface PersistedTokenState {
  version: 1;
  access: [string, AccessRecord][];
  refresh: [string, RefreshRecord][];
  families: [string, boolean][];
}

function validDigest(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function validRecord(value: unknown, refresh: boolean): value is AccessRecord | RefreshRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  const text = ['familyId', 'userId', 'issuer', 'audience', 'clientId'];
  if (text.some(k => typeof r[k] !== 'string' || (r[k] as string).length < 1 || (r[k] as string).length > 2048) ||
      !Array.isArray(r.scopes) || r.scopes.length > 128 || r.scopes.some(x => typeof x !== 'string') ||
      !Number.isSafeInteger(r.expiresAt) || typeof r.revoked !== 'boolean') return false;
  return !refresh || (Number.isSafeInteger(r.idleExpiresAt) && typeof r.used === 'boolean');
}

/** Atomic, single-process persistence containing only token digests and metadata. */
export class FileTokenRepository implements TokenRepository {
  private readonly access = new Map<string, AccessRecord>();
  private readonly refresh = new Map<string, RefreshRecord>();
  private readonly families = new Map<string, boolean>();
  private readonly file: string;
  constructor(directory: string, readonly maxRecords = 100_000) {
    if (!directory || !Number.isSafeInteger(maxRecords) || maxRecords < 100 || maxRecords > 1_000_000) throw new RangeError('Invalid token store configuration');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { chmodSync(directory, 0o700); } catch { /* Windows uses inherited ACLs. */ }
    this.file = join(directory, 'tokens.json');
    if (existsSync(this.file)) this.load();
  }
  prepareIssue(): void { if (this.access.size + this.refresh.size + 2 > this.maxRecords) throw new Error('OAuth token store capacity reached'); }
  addFamily(id: string): void { this.ensureCapacity(); this.families.set(id, true); this.persist(); }
  isFamilyActive(id: string): boolean { return this.families.get(id) === true; }
  putAccess(hash: string, record: AccessRecord): void { this.ensureCapacity(); this.access.set(hash, cloneAccess(record)); this.persist(); }
  getAccess(hash: string): AccessRecord | undefined { const key = this.findDigest(this.access, hash); const r = key === undefined ? undefined : this.access.get(key); return r && cloneAccess(r); }
  putRefresh(hash: string, record: RefreshRecord): void { this.ensureCapacity(); this.refresh.set(hash, cloneRefresh(record)); this.persist(); }
  getRefresh(hash: string): RefreshRecord | undefined { const key = this.findDigest(this.refresh, hash); const r = key === undefined ? undefined : this.refresh.get(key); return r && cloneRefresh(r); }
  markRefreshUsed(hash: string): void { const r = this.refresh.get(hash); if (r) { r.used = true; this.persist(); } }
  revokeFamily(id: string): void {
    if (this.families.has(id)) this.families.set(id, false);
    for (const r of this.access.values()) if (r.familyId === id) r.revoked = true;
    for (const r of this.refresh.values()) if (r.familyId === id) r.revoked = true;
    this.persist();
  }
  listActiveGrants(userId: string): readonly TokenGrant[] {
    const found = new Map<string, TokenGrant>();
    for (const r of this.refresh.values()) if (r.userId === userId && !r.revoked && this.isFamilyActive(r.familyId))
      found.set(r.familyId, { grantId: grantId(r.familyId), userId, clientId: r.clientId, audience: r.audience, scopes: [...r.scopes] });
    return [...found.values()];
  }
  revokeGrant(userId: string, id: string): boolean {
    const family = [...this.refresh.values()].find(r => r.userId === userId && grantId(r.familyId) === id)?.familyId;
    if (!family) return false;
    this.revokeFamily(family); return true;
  }
  prune(now: number): number {
    let removed = 0;
    for (const [k, r] of this.access) if (r.expiresAt <= now || !this.isFamilyActive(r.familyId)) { this.access.delete(k); removed++; }
    for (const [k, r] of this.refresh) if (r.expiresAt <= now || r.idleExpiresAt <= now || !this.isFamilyActive(r.familyId)) { this.refresh.delete(k); removed++; }
    const live = new Set([...this.access.values(), ...this.refresh.values()].map(r => r.familyId));
    for (const id of this.families.keys()) if (!live.has(id)) this.families.delete(id);
    if (removed) this.persist();
    return removed;
  }
  toJSON(): object { return { access: [...this.access.keys()], refresh: [...this.refresh.keys()], families: this.families.size }; }
  private ensureCapacity(): void { if (this.access.size + this.refresh.size >= this.maxRecords) throw new Error('OAuth token store capacity reached'); }
  private findDigest<T>(map: Map<string, T>, hash: string): string | undefined {
    const target = Buffer.from(hash, 'hex');
    for (const key of map.keys()) { const candidate = Buffer.from(key, 'hex'); if (candidate.length === target.length && timingSafeEqual(candidate, target)) return key; }
    return undefined;
  }
  private load(): void {
    let parsed: unknown;
    try { parsed = JSON.parse(readFileSync(this.file, 'utf8')); } catch { throw new Error('Invalid persisted OAuth token state'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid persisted OAuth token state');
    const state = parsed as Partial<PersistedTokenState>;
    if (state.version !== 1 || !Array.isArray(state.access) || !Array.isArray(state.refresh) || !Array.isArray(state.families) ||
        state.access.length + state.refresh.length > this.maxRecords) throw new Error('Invalid persisted OAuth token state');
    for (const entry of state.access) {
      if (!Array.isArray(entry) || entry.length !== 2 || !validDigest(entry[0]) || !validRecord(entry[1], false)) throw new Error('Invalid persisted OAuth token state');
      this.access.set(entry[0], cloneAccess(entry[1]));
    }
    for (const entry of state.refresh) {
      if (!Array.isArray(entry) || entry.length !== 2 || !validDigest(entry[0]) || !validRecord(entry[1], true)) throw new Error('Invalid persisted OAuth token state');
      this.refresh.set(entry[0], cloneRefresh(entry[1] as RefreshRecord));
    }
    for (const entry of state.families) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || typeof entry[1] !== 'boolean') throw new Error('Invalid persisted OAuth token state');
      this.families.set(entry[0], entry[1]);
    }
  }
  private persist(): void {
    const state: PersistedTokenState = { version: 1, access: [...this.access.entries()].map(([k, v]) => [k, cloneAccess(v)]),
      refresh: [...this.refresh.entries()].map(([k, v]) => [k, cloneRefresh(v)]), families: [...this.families.entries()] };
    const temp = `${this.file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      writeFileSync(temp, JSON.stringify(state), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      renameSync(temp, this.file);
      try { chmodSync(this.file, 0o600); } catch { /* Windows uses inherited ACLs. */ }
    } catch (error) {
      try { unlinkSync(temp); } catch { /* best effort */ }
      throw error;
    }
  }
}
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

