import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import type { Config } from '../config.js';
import { log } from '../logging.js';
import { createMcpServer } from '../server.js';
import { createReadClient } from '../clients/index.js';
import { ActivityWorkflow } from '../services/activity-workflow.js';
import { OAuthHttpService } from '../oauth/http.js';
import { ResourceAuthError, verifyResourceAuthorization, type ValidatedAuthContext } from '../oauth/resource-auth.js';

export const MAX_REQUEST_BODY_BYTES = 65_536;

function reply(res: ServerResponse, status: number, error: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error }));
}

function singleHeader(req: IncomingMessage, name: string): string | undefined {
  const values = req.headersDistinct[name];
  return values?.length === 1 ? values[0] : undefined;
}

export function createHttpServer(config: Config): { server: Server; close: () => Promise<void> } {
  if (config.authMode !== 'oauth' && !config.bearerToken) throw new Error('Legacy HTTP auth requires MCP_BEARER_TOKEN.');
  if (config.authMode !== 'legacy' && !config.oauth) throw new Error('OAuth HTTP auth requires OAuth configuration.');
  const client = createReadClient(config);
  const workflow = new ActivityWorkflow(client, config);
  const oauth = config.oauth ? new OAuthHttpService(config.oauth) : undefined;
  const oauthConfig = oauth?.config;
  const handler = createMcpHandler(ctx => {
    const extra = ctx.authInfo?.extra;
    const auth = extra && typeof extra.subject === 'string' && (extra.method === 'legacy' || extra.method === 'oauth')
      ? { subject: extra.subject, clientId: ctx.authInfo!.clientId, scopes: Object.freeze([...ctx.authInfo!.scopes]), method: extra.method,
          ...(ctx.authInfo!.expiresAt === undefined ? {} : { expiresAt: ctx.authInfo!.expiresAt }) } satisfies ValidatedAuthContext
      : undefined;
    return createMcpServer(client, workflow, auth);
  }, {
    legacy: 'stateless', maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    onerror: () => log('protocol_error')
  });
  const handleMcp = toNodeHandler(handler, { maxRequestBodySize: MAX_REQUEST_BODY_BYTES, onerror: () => log('protocol_error') });
  const server = createServer({ maxHeaderSize: 16_384, requestTimeout: 15_000, headersTimeout: 10_000 }, (req, res) => {
    void (async () => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    const host = singleHeader(req, 'host');
    const origin = singleHeader(req, 'origin');
    let boundaryReason: string | undefined;
    if (!host) boundaryReason = req.headersDistinct.host === undefined ? 'missing_host' : 'duplicate_host';
    else if (!config.allowedHosts.includes(host)) boundaryReason = 'host_not_allowed';
    else if (req.headersDistinct.origin !== undefined && !origin) boundaryReason = 'duplicate_origin';
    else if (origin !== undefined && !config.allowedOrigins.includes(origin)) boundaryReason = 'origin_not_allowed';
    if (boundaryReason !== undefined) {
      log('http_rejected', { status: 403, reason: boundaryReason, ...(req.method === undefined ? {} : { method: req.method }) });
      reply(res, 403, 'Forbidden'); return;
    }
    if (oauth && await oauth.handle(req, res)) return;
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', mode: config.mode })); return;
    }
    if (req.url !== '/mcp') { reply(res, 404, 'Not found'); return; }
    let auth: ValidatedAuthContext;
    try {
      auth = verifyResourceAuthorization(req.headersDistinct.authorization, { mode: config.authMode,
        ...(config.bearerToken === undefined ? {} : { bearerToken: config.bearerToken }),
        ...(oauthConfig === undefined ? {} : { oauth: { issuer: oauthConfig.issuer, resource: oauthConfig.resource,
          resourceMetadataUrl: oauthConfig.resourceMetadataUrl, scopes: oauthConfig.scopes } }) }, oauth?.tokenService);
    } catch (error) {
      if (error instanceof ResourceAuthError) {
        for (const [name, value] of Object.entries(error.headers)) res.setHeader(name, value);
        reply(res, error.status, error.status === 401 ? 'Unauthorized' : 'Forbidden'); return;
      }
      reply(res, 401, 'Unauthorized'); return;
    }
    if (!['POST', 'GET', 'DELETE'].includes(req.method ?? '')) {
      res.setHeader('Allow', 'POST, GET, DELETE'); reply(res, 405, 'Method not allowed'); return;
    }
    const length = req.headers['content-length'];
    if (length !== undefined && Number(length) > MAX_REQUEST_BODY_BYTES) {
      reply(res, 413, 'Request body too large'); return;
    }
    // The SDK's structural request type declares optional strings without
    // explicit undefined; Node's type includes it under exact optional types.
    const request = {
      method: req.method ?? 'POST', url: req.url ?? '/mcp', headers: req.headers,
      auth: { token: singleHeader(req, 'authorization')?.slice(7) ?? '', clientId: auth.clientId, scopes: [...auth.scopes],
        ...(auth.expiresAt === undefined ? {} : { expiresAt: auth.expiresAt }),
        ...(oauthConfig === undefined ? {} : { resource: new URL(oauthConfig.resource), resourceMetadataUrl: oauthConfig.resourceMetadataUrl }),
        extra: { subject: auth.subject, method: auth.method } },
      [Symbol.asyncIterator]: () => req[Symbol.asyncIterator]()
    };
    void handleMcp(request, res).catch(() => {
      log('request_failed');
      if (!res.headersSent) reply(res, 500, 'Internal server error');
      else res.destroy();
    });
    })().catch(() => {
      log('request_failed');
      if (!res.headersSent) reply(res, 500, 'Internal server error');
      else res.destroy();
    });
  });
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => closing ??= (async () => {
    await handler.close();
    if (!server.listening) return;
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  })();
  return { server, close };
}

export async function startHttpServer(config: Config): Promise<{ server: Server; close: () => Promise<void> }> {
  const handle = createHttpServer(config);
  await new Promise<void>((resolve, reject) => {
    handle.server.once('error', reject);
    handle.server.listen(config.port, config.host, () => {
      handle.server.off('error', reject); resolve();
    });
  });
  log('http_started', { port: config.port, transport: 'http' });
  return handle;
}
