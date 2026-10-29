import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OAuthClientRegistration } from './authorization.js';

export interface StoredOAuthClient extends OAuthClientRegistration { readonly clientName: string; }

export class FileOAuthClientStore {
  private readonly clients = new Map<string, StoredOAuthClient>();
  private readonly file: string;
  constructor(directory: string, initial: readonly StoredOAuthClient[] = []) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { chmodSync(directory, 0o700); } catch { /* Windows uses inherited ACLs. */ }
    this.file = join(directory, 'clients.json');
    if (existsSync(this.file)) this.load();
    let changed = false;
    for (const client of initial) {
      const frozen = freezeClient(client), existing = this.clients.get(client.clientId);
      if (!existing || JSON.stringify(existing) !== JSON.stringify(frozen)) { this.clients.set(client.clientId, frozen); changed = true; }
    }
    if (changed) this.persist();
  }
  get(clientId: string): StoredOAuthClient | undefined { return this.clients.get(clientId); }
  asMap(): ReadonlyMap<string, OAuthClientRegistration> { return this.clients; }
  add(client: StoredOAuthClient): void {
    if (this.clients.size >= 10_000 || this.clients.has(client.clientId)) throw new Error('OAuth client registration rejected');
    this.clients.set(client.clientId, freezeClient(client)); this.persist();
  }
  private load(): void {
    let parsed: unknown;
    try { parsed = JSON.parse(readFileSync(this.file, 'utf8')); } catch { throw new Error('Invalid persisted OAuth client state'); }
    if (!Array.isArray(parsed) || parsed.length > 10_000) throw new Error('Invalid persisted OAuth client state');
    for (const value of parsed) {
      if (!validClient(value)) throw new Error('Invalid persisted OAuth client state');
      this.clients.set(value.clientId, freezeClient(value));
    }
  }
  private persist(): void {
    const temp = `${this.file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      writeFileSync(temp, JSON.stringify([...this.clients.values()]), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      renameSync(temp, this.file);
      try { chmodSync(this.file, 0o600); } catch { /* Windows uses inherited ACLs. */ }
    } catch (error) {
      try { unlinkSync(temp); } catch { /* best effort */ }
      throw error;
    }
  }
}

function freezeClient(client: StoredOAuthClient): StoredOAuthClient {
  return Object.freeze({ ...client, redirectUris: Object.freeze([...client.redirectUris]), allowedScopes: Object.freeze([...client.allowedScopes]),
    allowedResources: Object.freeze([...client.allowedResources]) });
}
function validClient(value: unknown): value is StoredOAuthClient {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.clientId === 'string' && v.clientId.length > 0 && v.clientId.length <= 2048 &&
    typeof v.clientName === 'string' && v.clientName.length > 0 && v.clientName.length <= 128 &&
    validStrings(v.redirectUris, 16, 2048) && validStrings(v.allowedScopes, 128, 128) && validStrings(v.allowedResources, 16, 2048);
}
function validStrings(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= maxItems && value.every(x => typeof x === 'string' && x.length > 0 && x.length <= maxLength);
}
