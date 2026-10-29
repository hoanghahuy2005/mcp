import http from 'node:http';
import { once } from 'node:events';
import { apiEnvelope, malformedApiError, sourceData, syntheticLeakCanary } from './source-contract.mjs';

// Deliberately fake identity. Never read process.env or any ProjeQtOr configuration.
export const fakeCredentials = Object.freeze({ username: 'qa-synthetic', password: 'not-a-real-password' });
const expectedBasic = `Basic ${Buffer.from(`${fakeCredentials.username}:${fakeCredentials.password}`).toString('base64')}`;
const allowedScenarios = new Set([
  'normal', 'empty', '401', '403', '500', 'api-error', 'source-error',
  'html', 'invalid-json', 'wrong-envelope', 'delay', 'large', 'secrets', 'redirect',
  'wrong-identifier', 'invalid-item', 'error-secrets', 'chunked-large', 'slow-body', 'disconnect',
]);

export async function startFakeUpstream({ data = sourceData(), delayMs = 250, largeBytes = 2_000_000 } = {}) {
  const observations = [];
  const scenarios = new Map();
  const timers = new Set();
  let redirectTarget;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let segments;
    try { segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); }
    catch { res.writeHead(400); res.end(); req.resume(); return; }
    const [prefix, className, selector, criterion] = segments;
    observations.push({ method: req.method, path: url.pathname, query: url.search,
      basicMatches: req.headers.authorization === expectedBasic,
      hasAuthorization: Boolean(req.headers.authorization) });
    req.resume();
    const send = (status, body, type = 'application/json') => {
      if (!res.destroyed) { res.writeHead(status, { 'Content-Type': type }); res.end(body); }
    };
    if (req.method !== 'GET') return send(405, JSON.stringify({ error: 'QA fake rejects every write' }));
    if (req.headers.authorization !== expectedBasic) {
      res.setHeader('WWW-Authenticate', 'Basic realm="QA synthetic"');
      return send(401, JSON.stringify({ error: 'unauthorized' }));
    }
    const validRoute = prefix === 'api' && Object.hasOwn(data, className) && (
      (segments.length === 3 && (selector === 'all' || /^[1-9]\d*$/.test(selector))) ||
      (segments.length === 4 && selector === 'search' && /^idProject=[1-9]\d*$/.test(criterion))
    );
    if (!validRoute) return send(404, JSON.stringify({ error: 'route not allowlisted by QA fake' }));
    const scenario = scenarios.get(className) ?? 'normal';
    if (/^(401|403|500)$/.test(scenario)) return send(Number(scenario), JSON.stringify({ error: `synthetic ${scenario}` }));
    if (scenario === 'api-error') return send(200, JSON.stringify({ error: 'invalid API query', message: 'synthetic failure' }));
    if (scenario === 'source-error') return send(200, malformedApiError);
    if (scenario === 'html') return send(200, '<html><body>Login required</body></html>', 'text/html');
    if (scenario === 'invalid-json') return send(200, '{not json');
    if (scenario === 'wrong-envelope') return send(200, JSON.stringify({ items: { id: '9' } }));
    if (scenario === 'wrong-identifier') return send(200, JSON.stringify({ identifier: 'password', items: [] }));
    if (scenario === 'invalid-item') return send(200, JSON.stringify(apiEnvelope([null, 'not-an-object'])));
    if (scenario === 'error-secrets') return send(200, JSON.stringify({ error: 'invalid API query',
      message: `${syntheticLeakCanary} ${fakeCredentials.password} at /private/stack.php:123` }));
    if (scenario === 'disconnect') return req.socket.destroy();
    if (scenario === 'redirect') {
      if (!redirectTarget) return send(500, JSON.stringify({ error: 'QA redirect target is unset' }));
      res.writeHead(302, { Location: redirectTarget });
      return res.end();
    }
    let items = data[className];
    if (selector === 'search') items = items.filter((item) => item.idProject === criterion.split('=')[1]);
    else if (selector !== 'all') items = items.filter((item) => item.id === selector);
    if (scenario === 'empty') items = [];
    if (scenario === 'secrets') items = items.map((item) => ({ ...item,
      password: syntheticLeakCanary, apiKey: syntheticLeakCanary,
      _internal: syntheticLeakCanary, unexpectedSecret: syntheticLeakCanary }));
    if (scenario === 'large' || scenario === 'chunked-large') {
      // Valid records plus oversized unknown data: a mapper that strips extra
      // fields must still enforce the byte limit before silently dropping it.
      items = items.map((item) => ({ ...item, qaPadding: 'x'.repeat(largeBytes) }));
    }
    const body = JSON.stringify(apiEnvelope(items));
    if (scenario === 'chunked-large') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' });
      for (let index = 0; index < body.length; index += 512) res.write(body.slice(index, index + 512));
      return res.end();
    }
    if (scenario === 'slow-body') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.flushHeaders();
      const timer = setTimeout(() => { timers.delete(timer); if (!res.destroyed) res.end(body); }, delayMs);
      timers.add(timer);
      return;
    }
    if (scenario === 'delay') {
      const timer = setTimeout(() => { timers.delete(timer); send(200, body); }, delayMs);
      timers.add(timer);
      return;
    }
    send(200, body);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/api/`, observations,
    setScenario(className, scenario) {
      if (!Object.hasOwn(data, className) || !allowedScenarios.has(scenario)) throw new Error('Unknown QA class/scenario');
      scenarios.set(className, scenario);
    },
    setRedirectTarget(target) {
      const url = new URL(target);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) throw new Error('QA redirect sink must be explicit loopback');
      redirectTarget = url.href;
    },
    async close() {
      for (const timer of timers) clearTimeout(timer);
      const closed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await closed;
    },
  };
}
