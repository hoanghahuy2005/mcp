import { randomUUID } from 'node:crypto';
import { validatePublicHttpsIdentifier, validateScopes } from './discovery.js';

export interface PublicClientRegistrationRequest {
  readonly client_name?: string;
  readonly redirect_uris: readonly string[];
  readonly grant_types?: readonly string[];
  readonly response_types?: readonly string[];
  readonly token_endpoint_auth_method?: string;
  readonly scope?: string;
  readonly [key: string]: unknown;
}

export interface PublicClientRegistration {
  readonly client_id: string;
  readonly client_name?: string;
  readonly redirect_uris: readonly string[];
  readonly grant_types: readonly string[];
  readonly response_types: readonly string[];
  readonly token_endpoint_auth_method: 'none';
  readonly scope?: string;
}

const GRANTS = ['authorization_code', 'refresh_token'] as const;
const RESPONSES = ['code'] as const;
const CLIENT_NAME = /^[\p{L}\p{N} ._()'’-]{1,128}$/u;

export function validateRedirectUri(value: string, options: { allowLoopbackHttp?: boolean } = {}): string {
  if (typeof value !== 'string' || value.length > 2048 || value !== value.trim()) throw new TypeError('Invalid redirect URI.');
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError('Invalid redirect URI.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const permitted = url.protocol === 'https:' || (options.allowLoopbackHttp === true && loopback && url.protocol === 'http:');
  if (!permitted || url.username || url.password || url.hash || !url.hostname ||
      (url.protocol === 'https:' && (loopback || url.hostname.endsWith('.localhost'))) ||
      (url.protocol === 'http:' && !loopback)) throw new TypeError('Redirect URI must be HTTPS (loopback HTTP is test-only).');
  return url.href;
}

/** RFC 7591 public-client registration validation. Returns public metadata only, with no secret. */
export function registerPublicClient(request: unknown, options: { allowLoopbackHttp?: boolean; clientId?: () => string } = {}): PublicClientRegistration {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new TypeError('Invalid client metadata.');
  const input = request as Record<string, unknown>;
  if (Object.keys(input).length > 16 || JSON.stringify(input).length > 8192) throw new TypeError('Client metadata exceeds size limits.');
  if (!Array.isArray(input.redirect_uris) || input.redirect_uris.length < 1 || input.redirect_uris.length > 16) throw new TypeError('Invalid redirect_uris.');
  const redirects = input.redirect_uris.map(uri => validateRedirectUri(uri as string, options));
  if (new Set(redirects).size !== redirects.length) throw new TypeError('Duplicate redirect URI.');
  const grants = stringArray(input.grant_types, GRANTS, ['authorization_code']);
  if (!grants.includes('authorization_code')) throw new TypeError('authorization_code grant is required.');
  const responses = stringArray(input.response_types, RESPONSES, ['code']);
  if (!responses.includes('code')) throw new TypeError('code response type is required.');
  if (input.token_endpoint_auth_method !== undefined && input.token_endpoint_auth_method !== 'none') throw new TypeError('Only public clients using token_endpoint_auth_method=none are supported.');
  if (input.client_name !== undefined && (typeof input.client_name !== 'string' || !CLIENT_NAME.test(input.client_name))) throw new TypeError('Invalid client_name.');
  if (input.scope !== undefined && (typeof input.scope !== 'string' || input.scope.length > 1024)) throw new TypeError('Invalid scope.');
  if (input.scope !== undefined) validateScopes(input.scope.split(/\s+/).filter(Boolean));
  for (const key of ['client_secret', 'jwks', 'jwks_uri', 'software_statement', 'redirect_uri']) if (key in input) throw new TypeError(`Unsupported client metadata: ${key}.`);
  const id = options.clientId?.() ?? randomUUID();
  if (!/^[A-Za-z0-9._~-]{16,128}$/.test(id)) throw new TypeError('Invalid generated client ID.');
  return Object.freeze({ client_id: id,
    ...(input.client_name === undefined ? {} : { client_name: input.client_name as string }),
    redirect_uris: Object.freeze(redirects), grant_types: Object.freeze(grants), response_types: Object.freeze(responses),
    token_endpoint_auth_method: 'none', ...(input.scope === undefined ? {} : { scope: input.scope as string }) });
}

function stringArray(value: unknown, allowed: readonly string[], fallback: readonly string[]): string[] {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.length < 1 || value.length > allowed.length || value.some(x => typeof x !== 'string' || !allowed.includes(x)) || new Set(value).size !== value.length) {
    throw new TypeError('Unsupported grant_types or response_types.');
  }
  return [...value] as string[];
}

export interface RegisteredClient { readonly client_id: string; readonly redirect_uris: readonly string[]; }

/** CIMD policy: exact registered IDs only. This validator never dereferences client_id URLs. */
export function validateClientId(clientId: unknown, registry: ReadonlyMap<string, RegisteredClient>): RegisteredClient {
  if (typeof clientId !== 'string' || clientId.length > 2048) throw new TypeError('Invalid client_id.');
  const client = registry.get(clientId);
  if (!client) throw new TypeError('Unregistered client_id; CIMD URLs must be explicitly pre-registered.');
  return client;
}

/** Register a stable client metadata URL explicitly; callers must provision its metadata out of band. */
export function registerCimdClient(clientIdUrl: string, redirectUris: readonly string[], registry: Map<string, RegisteredClient>, options: { allowLoopbackHttp?: boolean } = {}): RegisteredClient {
  const id = validatePublicHttpsIdentifier(clientIdUrl, 'client_id URL');
  if (registry.has(id) || redirectUris.length < 1 || redirectUris.length > 16) throw new TypeError('Invalid or duplicate CIMD registration.');
  const normalized = redirectUris.map(uri => validateRedirectUri(uri, options));
  if (new Set(normalized).size !== normalized.length) throw new TypeError('Duplicate redirect URI.');
  const value = Object.freeze({ client_id: id, redirect_uris: Object.freeze(normalized) });
  registry.set(id, value);
  return value;
}
