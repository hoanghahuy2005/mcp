import { createServer } from 'node:http';
import { once } from 'node:events';
import { loadConfig } from '../../dist/config.js';
import { createReadClient } from '../../dist/clients/index.js';

// Backend unit helper, independent of QA helpers and product fixtures.
export const secret = 'unit-only-upstream-secret';
export const username = 'unit-reader';
export const envelope = items => JSON.stringify({ identifier: 'id', items });
export const data = {
  Project: [{ id: '9', name: 'Unit project', idStatus: '1', password: secret, apiKey: secret }, { id: '10', name: 'Other unit project' }],
  Activity: [
    { id: '41', name: 'Unit activity', idProject: '9', idStatus: '0', idResource: '11',
      initialStartDate: '2026-11-02', initialEndDate: '2026-11-06',
      plannedWork: '2.75', realWork: '0', leftWork: '', _internal: secret },
    { id: '42', name: 'Outside unit scope', idProject: '10', plannedWork: 'invalid', realWork: null }
  ],
  Resource: [{ id: '11', name: 'Unit person', unexpectedSecret: secret }, { id: '12' }],
  Assignment: [{ id: '71', idProject: '9', refType: 'Activity', refId: '41', idResource: '11', plannedWork: '1.25', realWork: '0', leftWork: '' }],
  ActivityType: [{ id: '2', name: 'Unit activity type' }],
  Status: [{ id: '1', name: 'Unit status' }]
};

export async function fake(t, handler, overrides = {}) {
  const observations = [];
  const server = createServer((req, res) => {
    observations.push({ method: req.method, path: req.url,
      basicMatches: req.headers.authorization === `Basic ${Buffer.from(`${username}:${secret}`).toString('base64')}`,
      hasSession: req.headers['mcp-session-id'] !== undefined });
    if (handler) return handler(req, res);
    const [, prefix, className, selector, criterion] = req.url.split('/');
    if (req.method !== 'GET' || prefix !== 'api' || !Object.hasOwn(data, className)) { res.writeHead(405); res.end(); return; }
    let rows = data[className];
    if (selector === 'search') rows = rows.filter(row => String(row.idProject) === criterion.split('=')[1]);
    else if (selector !== 'all') rows = rows.filter(row => String(row.id) === selector);
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(envelope(rows));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => {
    if (!server.listening) return;
    const closing = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections(); await closing;
  });
  const config = loadConfig({ MCP_TRANSPORT: 'stdio', PROJEQTOR_MODE: 'real',
    PROJEQTOR_BASE_URL: `http://127.0.0.1:${server.address().port}/api/`,
    PROJEQTOR_USERNAME: username, PROJEQTOR_PASSWORD: secret, ...overrides });
  return { client: createReadClient(config), config, observations, server };
}
