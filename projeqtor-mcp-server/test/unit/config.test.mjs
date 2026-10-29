import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../../dist/config.js';

const token = randomBytes(32).toString('hex');
const valid = { MCP_BEARER_TOKEN: token };
test('loopback mock defaults are immutable, writes disabled', () => {
  const config = loadConfig(valid);
  assert.equal(config.mode, 'mock'); assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 8787); assert.equal(config.enableWrite, false);
  assert.equal(config.enableRealWrite, false);
  assert.deepEqual(config.allowedHosts, ['127.0.0.1:8787', 'localhost:8787']);
  assert.ok(Object.isFrozen(config)); assert.ok(Object.isFrozen(config.allowedOrigins));
});
for (const [key, values] of Object.entries({
  MCP_HOST: ['0.0.0.0', 'localhost', '::1'],
  MCP_PORT: ['0', '-1', '65536', '1.1', 'not-a-port', ''],
  MCP_TRANSPORT: ['tcp', ''], PROJEQTOR_MODE: ['real', 'invalid'],
  ENABLE_WRITE: ['1', 'TRUE'], ENABLE_REAL_WRITE: ['1', 'TRUE'],
  PROJEQTOR_AES_KEY_LENGTH: ['64', '512', ''],
  MCP_BEARER_TOKEN: ['', 'short', 'a'.repeat(40), 'REPLACE_WITH_A_RANDOM_TOKEN_OF_AT_LEAST_32_CHARACTERS', token + '\n'],
  MCP_ALLOWED_ORIGINS: ['*', 'null', 'https://attacker.invalid', 'http://localhost:8787/path', 'http://localhost:8787/', 'http://127.0.0.1:8787.attacker.invalid', '']
})) {
  for (const value of values) test(`reject invalid ${key} case ${values.indexOf(value) + 1}`, () => {
    assert.throws(() => loadConfig({ ...valid, [key]: value }));
  });
}
test('stdio requires no HTTP secret', () => {
  assert.equal(loadConfig({ MCP_TRANSPORT: 'stdio' }).bearerToken, undefined);
});
test('missing HTTP secret fails without leaking input', () => {
  assert.throws(() => loadConfig({}), /MCP_BEARER_TOKEN/);
  try { loadConfig({ MCP_PORT: token }); assert.fail(); }
  catch (error) { assert.ok(!error.message.includes(token)); }
});
test('custom loopback origin is exact and supports Inspector UI when configured', () => {
  const config = loadConfig({ ...valid, MCP_ALLOWED_ORIGINS: 'http://localhost:6274' });
  assert.deepEqual(config.allowedOrigins, ['http://localhost:6274']);
});
test('oauth mode requires canonical public issuer/resource and does not require legacy bearer', () => {
  const config = loadConfig({ MCP_AUTH_MODE: 'oauth', OAUTH_ISSUER: 'https://mcp.example.test', OAUTH_RESOURCE: 'https://mcp.example.test/mcp' });
  assert.equal(config.bearerToken, undefined);
  assert.equal(config.oauth.issuer, 'https://mcp.example.test/');
  assert.equal(config.oauth.resource, 'https://mcp.example.test/mcp');
  assert.deepEqual(config.oauth.scopes, ['mcp:read', 'mcp:write']);
  assert.ok(config.allowedHosts.includes('mcp.example.test'));
  assert.ok(config.allowedOrigins.includes('https://mcp.example.test'));
  const explicitLocal = loadConfig({ MCP_AUTH_MODE: 'oauth', OAUTH_ISSUER: 'https://mcp.example.test', OAUTH_RESOURCE: 'https://mcp.example.test/mcp',
    MCP_ALLOWED_ORIGINS: 'http://127.0.0.1:8787' });
  assert.deepEqual(explicitLocal.allowedOrigins, ['http://127.0.0.1:8787', 'https://mcp.example.test']);
  for (const overrides of [
    { OAUTH_ISSUER: 'http://mcp.example.test' },
    { OAUTH_ISSUER: 'https://localhost' },
    { OAUTH_RESOURCE: 'https://other.example.test/mcp' },
    { OAUTH_RESOURCE: 'https://mcp.example.test/other' },
    { OAUTH_SCOPES: 'mcp:read' },
    { OAUTH_REFRESH_IDLE_TTL_SECONDS: '601', OAUTH_REFRESH_TOKEN_TTL_SECONDS: '600' }
  ]) assert.throws(() => loadConfig({ MCP_AUTH_MODE: 'oauth', OAUTH_ISSUER: 'https://mcp.example.test', OAUTH_RESOURCE: 'https://mcp.example.test/mcp', ...overrides }));
});

test('real OAuth mode binds authenticated identity to the configured ProjeQtOr account', () => {
  const config = loadConfig({
    MCP_AUTH_MODE: 'oauth',
    OAUTH_ISSUER: 'https://mcp.example.test',
    OAUTH_RESOURCE: 'https://mcp.example.test/mcp',
    PROJEQTOR_MODE: 'real',
    PROJEQTOR_BASE_URL: 'http://127.0.0.1:8080/projeqtor/api/',
    PROJEQTOR_USERNAME: 'oauth-user',
    PROJEQTOR_PASSWORD: 'test-only-password',
  });
  assert.equal(config.oauth.allowedUserId, 'oauth-user');
});

test('real writes require an independent gate, mock writes, API key and explicit AES length', () => {
  const base = { MCP_TRANSPORT: 'stdio', PROJEQTOR_MODE: 'real',
    PROJEQTOR_BASE_URL: 'http://127.0.0.1:8080/projeqtor/api/',
    PROJEQTOR_USERNAME: 'writer', PROJEQTOR_PASSWORD: 'test-only-password' };
  for (const overrides of [
    { ENABLE_REAL_WRITE: 'true' },
    { ENABLE_REAL_WRITE: 'true', ENABLE_WRITE: 'true' },
    { ENABLE_REAL_WRITE: 'true', ENABLE_WRITE: 'true', PROJEQTOR_API_KEY: 'not-a-key', PROJEQTOR_AES_KEY_LENGTH: '256' }
  ]) assert.throws(() => loadConfig({ ...base, ...overrides }));
  const config = loadConfig({ ...base, ENABLE_REAL_WRITE: 'true', ENABLE_WRITE: 'true',
    PROJEQTOR_API_KEY: '0123456789abcdef0123456789abcdef', PROJEQTOR_AES_KEY_LENGTH: '256' });
  assert.equal(config.enableRealWrite, true);
  assert.equal(config.upstream.aesKeyLength, 256);
  assert.equal(config.upstream.apiKey, '0123456789abcdef0123456789abcdef');
  assert.throws(() => loadConfig({ MCP_TRANSPORT: 'stdio', ENABLE_WRITE: 'true', ENABLE_REAL_WRITE: 'true' }));
});
