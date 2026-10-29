/** Pure OAuth discovery metadata builders and public HTTPS identifier validation. */

export interface DiscoveryEndpoints {
  readonly resource: string;
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly revocationEndpoint: string;
  readonly registrationEndpoint: string;
  readonly scopesSupported: readonly string[];
}

/** Validate a canonical public HTTPS URL used as an issuer or resource identifier. */
export function validatePublicHttpsIdentifier(value: string, label = 'identifier'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048 || value !== value.trim()) {
    throw new TypeError(`Invalid ${label}.`);
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError(`Invalid ${label}.`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.hostname === 'localhost' || url.hostname.endsWith('.localhost') ||
      /^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(url.hostname) ||
      url.hostname === '[::1]' || url.hostname === '[::]' || url.hostname.endsWith('.')) {
    throw new TypeError(`Invalid ${label}: use a public HTTPS URL without credentials, query, or fragment.`);
  }
  return url.href;
}

/** Validates a public HTTPS base URL used for OAuth endpoints; loopback HTTP is test-only. */
export function validateOAuthBaseUrl(value: string, options: { allowLoopbackHttp?: boolean } = {}): string {
  if (typeof value !== 'string' || value.length > 2048 || value !== value.trim()) throw new TypeError('Invalid OAuth base URL.');
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError('Invalid OAuth base URL.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(options.allowLoopbackHttp && loopback && url.protocol === 'http:')) ||
      (url.protocol === 'https:' && (loopback || url.hostname.endsWith('.localhost')))) {
    throw new TypeError('OAuth base URL must be public HTTPS (or test-only loopback HTTP).');
  }
  return url.href.replace(/\/$/, '');
}

function endpoint(base: string, path: string): string { return `${base}${path}`; }

export function createProtectedResourceMetadata(input: Pick<DiscoveryEndpoints, 'resource' | 'issuer' | 'scopesSupported'>): Readonly<Record<string, unknown>> {
  const resource = validatePublicHttpsIdentifier(input.resource, 'resource');
  const issuer = validatePublicHttpsIdentifier(input.issuer, 'issuer');
  const scopes = validateScopes(input.scopesSupported);
  return Object.freeze({ resource, authorization_servers: Object.freeze([issuer]), scopes_supported: Object.freeze(scopes) });
}

export function createAuthorizationServerMetadata(input: DiscoveryEndpoints): Readonly<Record<string, unknown>> {
  const issuer = validatePublicHttpsIdentifier(input.issuer, 'issuer');
  validatePublicHttpsIdentifier(input.resource, 'resource');
  const base = validateOAuthBaseUrl(issuer);
  const expected = {
    authorization: endpoint(base, '/authorize'), token: endpoint(base, '/token'),
    revocation: endpoint(base, '/revoke'), registration: endpoint(base, '/register')
  };
  for (const [name, value] of Object.entries({ authorization: input.authorizationEndpoint, token: input.tokenEndpoint,
    revocation: input.revocationEndpoint, registration: input.registrationEndpoint })) {
    const canonical = validatePublicHttpsIdentifier(value, `${name} endpoint`);
    if (canonical !== expected[name as keyof typeof expected]) throw new TypeError(`Invalid ${name} endpoint: expected ${expected[name as keyof typeof expected]}.`);
  }
  return Object.freeze({ issuer, authorization_endpoint: input.authorizationEndpoint, token_endpoint: input.tokenEndpoint,
    revocation_endpoint: input.revocationEndpoint, registration_endpoint: input.registrationEndpoint,
    response_types_supported: Object.freeze(['code']), grant_types_supported: Object.freeze(['authorization_code', 'refresh_token']),
    token_endpoint_auth_methods_supported: Object.freeze(['none']), code_challenge_methods_supported: Object.freeze(['S256']),
    authorization_response_iss_parameter_supported: true });
}

export function oauthEndpoints(baseUrl: string, resource: string, scopesSupported: readonly string[] = []): DiscoveryEndpoints {
  const base = validateOAuthBaseUrl(baseUrl);
  return Object.freeze({ resource: validatePublicHttpsIdentifier(resource, 'resource'), issuer: base,
    authorizationEndpoint: endpoint(base, '/authorize'), tokenEndpoint: endpoint(base, '/token'),
    revocationEndpoint: endpoint(base, '/revoke'), registrationEndpoint: endpoint(base, '/register'), scopesSupported: validateScopes(scopesSupported) });
}

export function validateScopes(scopes: readonly string[]): string[] {
  if (!Array.isArray(scopes) || scopes.length > 64 || scopes.some(s => typeof s !== 'string' || !/^[\x21\x23-\x5B\x5D-\x7E]{1,128}$/.test(s))) {
    throw new TypeError('Invalid OAuth scopes.');
  }
  return [...new Set(scopes)];
}
