export interface UserAuthenticator {
  authenticate(username: string, password: string): Promise<{ readonly subject: string } | undefined>;
}
export interface ProjeqtorAuthenticatorOptions {
  readonly baseUrl: string;
  /** One fixed, read-only API path beneath baseUrl, e.g. "Project/all". */
  readonly verificationPath?: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Verifies a user's Basic credentials against one configured ProjeQtOr API read.
 * This does not establish PHP session, LDAP/OTP, or account-state semantics; those
 * deployments must provide another UserAuthenticator. Fail closed on every ambiguity.
 */
export class ProjeqtorApiUserAuthenticator implements UserAuthenticator {
  readonly #endpoint: URL;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #fetch: typeof fetch;

  constructor(options: ProjeqtorAuthenticatorOptions) {
    const base = new URL(options.baseUrl);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
      throw new TypeError('Invalid ProjeQtOr API base URL.');
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    const path = options.verificationPath ?? 'Project/all';
    if (!path || path.startsWith('/') || path.includes('\\') || path.includes('?') || path.includes('#') || path.split('/').some(part => !/^[A-Za-z0-9_-]+$/.test(part)))
      throw new TypeError('Invalid fixed verification API path.');
    const endpoint = new URL(path, base);
    if (endpoint.origin !== base.origin || !endpoint.pathname.startsWith(base.pathname) || endpoint.search || endpoint.hash)
      throw new TypeError('Verification API path must stay beneath the configured API base.');
    this.#endpoint = endpoint;
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    this.#maxResponseBytes = options.maxResponseBytes ?? 64 * 1024;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 1 || !Number.isInteger(this.#maxResponseBytes) || this.#maxResponseBytes < 1)
      throw new TypeError('Invalid authenticator bounds.');
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async authenticate(username: string, password: string): Promise<{ readonly subject: string } | undefined> {
    if (typeof username !== 'string' || !username.trim() || username.length > 200 || /[\r\n]/.test(username) ||
        typeof password !== 'string' || !password || password.length > 4096 || /[\r\n]/.test(password)) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response: Response | undefined;
    try {
      response = await this.#fetch(this.#endpoint, { method: 'GET', redirect: 'manual', signal: controller.signal,
        headers: { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}` } });
      if (response.status >= 300 && response.status < 400) return undefined;
      if (!response.ok || response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return undefined;
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > this.#maxResponseBytes) return undefined;
      if (!response.body) return undefined;
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body.getReader();
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > this.#maxResponseBytes) return undefined;
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      let data: unknown;
      try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { return undefined; }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
      const envelope = data as Record<string, unknown>;
      if (envelope.identifier !== 'id' || !Array.isArray(envelope.items) || Object.keys(envelope).some(k => k !== 'identifier' && k !== 'items')) return undefined;
      return Object.freeze({ subject: username });
    } catch { return undefined; }
    finally {
      clearTimeout(timer);
      controller.abort();
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
    }
  }
}
