import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { AesKeyLength } from './clients/projeqtor-crypto.js';

const envSchema = z.object({
  PROJEQTOR_MODE: z.enum(['mock', 'real']).default('mock'),
  MCP_TRANSPORT: z.enum(['http', 'stdio']).default('http'),
  MCP_HOST: z.literal('127.0.0.1').default('127.0.0.1'),
  MCP_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  MCP_BEARER_TOKEN: z.string().optional(),
  MCP_AUTH_MODE: z.enum(['legacy', 'oauth', 'both']).default('legacy'),
  MCP_ALLOWED_ORIGINS: z.string().optional(),
  OAUTH_ISSUER: z.string().optional(),
  OAUTH_RESOURCE: z.string().optional(),
  OAUTH_SCOPES: z.string().default('mcp:read,mcp:write'),
  OAUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  OAUTH_REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(31536000).default(2592000),
  OAUTH_REFRESH_IDLE_TTL_SECONDS: z.coerce.number().int().min(300).max(31536000).default(604800),
  OAUTH_STATE_DIR: z.string().trim().min(1).optional(),
  OAUTH_CHATGPT_CLIENT_ID: z.string().default('https://chatgpt.com/oauth/client.json'),
  OAUTH_CHATGPT_REDIRECT_URI: z.string().default('https://chatgpt.com/connector_platform_oauth_redirect'),
  OAUTH_PROJEQTOR_BASE_URL: z.string().optional(),
  ENABLE_WRITE: z.enum(['false', 'true']).default('false'),
  ENABLE_REAL_WRITE: z.enum(['false', 'true']).default('false'),
  MCP_STATE_DIR: z.string().trim().min(1).optional(),
  PROJEQTOR_BASE_URL: z.string().default('http://localhost:8080/projeqtor/api/'),
  PROJEQTOR_USERNAME: z.string().optional(),
  PROJEQTOR_PASSWORD: z.string().optional(),
  PROJEQTOR_API_KEY: z.string().optional(),
  PROJEQTOR_AES_KEY_LENGTH: z.enum(['128', '192', '256']).optional(),
  PROJEQTOR_TIMEOUT_MS: z.coerce.number().int().min(10).max(60000).default(5000),
  PROJEQTOR_MAX_RESPONSE_BYTES: z.coerce.number().int().min(256).max(16777216).default(1048576)
});

export interface UpstreamConfig {
  readonly baseUrl: string;
  readonly username: string;
  readonly password: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly apiKey: string | undefined;
  readonly aesKeyLength: AesKeyLength | undefined;
}

export interface Config {
  readonly mode: 'mock' | 'real';
  readonly upstream: UpstreamConfig | undefined;
  readonly transport: 'http' | 'stdio';
  readonly host: '127.0.0.1';
  readonly port: number;
  readonly bearerToken: string | undefined;
  readonly authMode: 'legacy' | 'oauth' | 'both';
  readonly oauth: OAuthConfig | undefined;
  readonly allowedHosts: readonly string[];
  readonly allowedOrigins: readonly string[];
  readonly enableWrite: boolean;
  readonly enableRealWrite: boolean;
  readonly stateDirectory: string;
}

export interface OAuthConfig {
  readonly issuer: string;
  readonly resource: string;
  readonly resourceMetadataUrl: string;
  readonly scopes: readonly string[];
  readonly accessTtlSeconds: number;
  readonly refreshTtlSeconds: number;
  readonly refreshIdleTtlSeconds: number;
  readonly stateDirectory: string;
  readonly chatgptClientId: string;
  readonly chatgptRedirectUri: string;
  readonly projeqtorBaseUrl: string;
  readonly projeqtorTimeoutMs?: number;
  readonly projeqtorMaxResponseBytes?: number;
  readonly allowedUserId?: string;
}

function publicHttps(value: string, label: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`Invalid ${label}.`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.localhost')) {
    throw new Error(`${label} must be a public HTTPS URL without credentials, query or fragment.`);
  }
  return url;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration: ${[...new Set(result.error.issues.map(i => i.path.join('.')))].join(', ')}`);
  }
  const e = result.data;
  let upstream: UpstreamConfig | undefined;
  if (e.PROJEQTOR_MODE === 'real') {
    if (!e.PROJEQTOR_USERNAME?.trim() || e.PROJEQTOR_USERNAME.length > 1024 || /[:\x00-\x1f\x7f]/.test(e.PROJEQTOR_USERNAME) ||
      !e.PROJEQTOR_PASSWORD?.trim() || e.PROJEQTOR_PASSWORD.length > 1024) {
      throw new Error('Real mode requires valid PROJEQTOR_USERNAME and PROJEQTOR_PASSWORD.');
    }
    let url: URL;
    try { url = new URL(e.PROJEQTOR_BASE_URL); } catch { throw new Error('Invalid PROJEQTOR_BASE_URL.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      !url.pathname.endsWith('/') ||
      (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
      throw new Error('PROJEQTOR_BASE_URL requires an HTTP(S) directory URL; HTTP is loopback-only, with no credentials, query or fragment.');
    }
    if (e.ENABLE_REAL_WRITE === 'true' && (e.ENABLE_WRITE !== 'true' ||
      !e.PROJEQTOR_API_KEY || !/^[a-fA-F0-9]{32}$/.test(e.PROJEQTOR_API_KEY) || !e.PROJEQTOR_AES_KEY_LENGTH)) {
      throw new Error('Real writes require ENABLE_WRITE, a valid PROJEQTOR_API_KEY and PROJEQTOR_AES_KEY_LENGTH.');
    }
    upstream = Object.freeze({ baseUrl: url.href, username: e.PROJEQTOR_USERNAME, password: e.PROJEQTOR_PASSWORD,
      timeoutMs: e.PROJEQTOR_TIMEOUT_MS, maxResponseBytes: e.PROJEQTOR_MAX_RESPONSE_BYTES,
      apiKey: e.PROJEQTOR_API_KEY, aesKeyLength: e.PROJEQTOR_AES_KEY_LENGTH === undefined ? undefined : Number(e.PROJEQTOR_AES_KEY_LENGTH) as AesKeyLength });
  }
  if (e.ENABLE_REAL_WRITE === 'true' && e.PROJEQTOR_MODE !== 'real') throw new Error('ENABLE_REAL_WRITE requires PROJEQTOR_MODE=real.');
  const token = e.MCP_BEARER_TOKEN;
  if (e.MCP_TRANSPORT === 'http' && e.MCP_AUTH_MODE !== 'oauth' && (!token || token.length < 32 || token.length > 256 || !/^[A-Za-z0-9._~-]+$/.test(token) || /replace|example|change|placeholder/i.test(token) || new Set(token).size < 8)) {
    throw new Error('MCP_BEARER_TOKEN must be a non-placeholder random token of 32–256 URL-safe characters.');
  }
  let oauth: OAuthConfig | undefined;
  if (e.MCP_TRANSPORT === 'http' && e.MCP_AUTH_MODE !== 'legacy') {
    if (!e.OAUTH_ISSUER || !e.OAUTH_RESOURCE) throw new Error('OAuth mode requires OAUTH_ISSUER and OAUTH_RESOURCE.');
    const issuer = publicHttps(e.OAUTH_ISSUER, 'OAUTH_ISSUER');
    const resource = publicHttps(e.OAUTH_RESOURCE, 'OAUTH_RESOURCE');
    if (issuer.pathname !== '/' || resource.origin !== issuer.origin || resource.pathname !== '/mcp') {
      throw new Error('OAUTH_ISSUER must be an HTTPS origin and OAUTH_RESOURCE must be the same origin ending in /mcp.');
    }
    const scopes = e.OAUTH_SCOPES.split(',').map(x => x.trim());
    if (!scopes.length || new Set(scopes).size !== scopes.length || scopes.some(x => !/^[\x21\x23-\x5B\x5D-\x7E]{1,128}$/.test(x)) ||
        !scopes.includes('mcp:read') || !scopes.includes('mcp:write')) throw new Error('OAUTH_SCOPES must include unique mcp:read and mcp:write scope tokens.');
    if (e.OAUTH_REFRESH_IDLE_TTL_SECONDS > e.OAUTH_REFRESH_TOKEN_TTL_SECONDS) throw new Error('OAuth refresh idle TTL cannot exceed its absolute TTL.');
    const clientId = publicHttps(e.OAUTH_CHATGPT_CLIENT_ID, 'OAUTH_CHATGPT_CLIENT_ID').href;
    const redirect = publicHttps(e.OAUTH_CHATGPT_REDIRECT_URI, 'OAUTH_CHATGPT_REDIRECT_URI').href;
    let authBase: URL;
    try { authBase = new URL(e.OAUTH_PROJEQTOR_BASE_URL ?? e.PROJEQTOR_BASE_URL); } catch { throw new Error('Invalid OAUTH_PROJEQTOR_BASE_URL.'); }
    if (!['http:', 'https:'].includes(authBase.protocol) || authBase.username || authBase.password || authBase.search || authBase.hash || !authBase.pathname.endsWith('/') ||
        (authBase.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(authBase.hostname))) throw new Error('OAUTH_PROJEQTOR_BASE_URL requires an HTTP(S) directory URL; HTTP is loopback-only.');
    oauth = Object.freeze({ issuer: issuer.href, resource: resource.href, resourceMetadataUrl: new URL('/.well-known/oauth-protected-resource', issuer).href,
      scopes: Object.freeze(scopes), accessTtlSeconds: e.OAUTH_ACCESS_TOKEN_TTL_SECONDS, refreshTtlSeconds: e.OAUTH_REFRESH_TOKEN_TTL_SECONDS,
      refreshIdleTtlSeconds: e.OAUTH_REFRESH_IDLE_TTL_SECONDS, stateDirectory: resolve(e.OAUTH_STATE_DIR ?? fileURLToPath(new URL('../.oauth-state', import.meta.url))),
      chatgptClientId: clientId, chatgptRedirectUri: redirect, projeqtorBaseUrl: authBase.href,
      projeqtorTimeoutMs: e.PROJEQTOR_TIMEOUT_MS, projeqtorMaxResponseBytes: e.PROJEQTOR_MAX_RESPONSE_BYTES,
      ...(upstream === undefined ? {} : { allowedUserId: upstream.username }) });
  }
  const defaults = [`http://127.0.0.1:${e.MCP_PORT}`, `http://localhost:${e.MCP_PORT}`, ...(oauth ? [new URL(oauth.issuer).origin] : [])];
  // The configured public OAuth origin must be accepted for browser form POSTs
  // coming back through ngrok/reverse proxies. It is derived from the trusted
  // issuer, never from an unvalidated request header, and is added even when
  // local origins were explicitly listed.
  const configuredOrigins = e.MCP_ALLOWED_ORIGINS?.split(',').map(x => x.trim()) ?? defaults;
  const origins = [...new Set([...configuredOrigins, ...(oauth ? [new URL(oauth.issuer).origin] : [])])];
  for (const value of origins) {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('Invalid MCP_ALLOWED_ORIGINS.'); }
    const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
    const publicOauth = oauth !== undefined && url.protocol === 'https:' && url.origin === new URL(oauth.issuer).origin;
    if (url.origin !== value || (!loopback && !publicOauth)) throw new Error('MCP_ALLOWED_ORIGINS must contain exact loopback or configured OAuth origins.');
  }
  return Object.freeze({ mode: e.PROJEQTOR_MODE, upstream, transport: e.MCP_TRANSPORT, host: e.MCP_HOST, port: e.MCP_PORT,
    bearerToken: token, authMode: e.MCP_AUTH_MODE, oauth,
    allowedHosts: Object.freeze([...new Set([`127.0.0.1:${e.MCP_PORT}`, `localhost:${e.MCP_PORT}`, ...(oauth ? [new URL(oauth.issuer).host] : [])])]),
    allowedOrigins: Object.freeze(origins), enableWrite: e.ENABLE_WRITE === 'true', enableRealWrite: e.ENABLE_REAL_WRITE === 'true',
    stateDirectory: resolve(e.MCP_STATE_DIR ?? fileURLToPath(new URL('../.mcp-state', import.meta.url))) });
}
