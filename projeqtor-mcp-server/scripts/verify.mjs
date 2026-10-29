import { spawn } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const integrationOnly = process.argv[2] === '--integration-only';
if (process.argv.slice(2).some(arg => arg !== '--integration-only')) throw new Error('Usage: node scripts/verify.mjs [--integration-only]');
const env = {};
for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'TEMP', 'TMP']) {
  if (process.env[key] !== undefined) env[key] = process.env[key];
}
const steps = [];
if (!integrationOnly) {
  steps.push(['build', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json']]);
  const units = (await readdir(join(root, 'test/unit'))).filter(file => file.endsWith('.test.mjs')).sort();
  steps.push(['unit', ['--test', ...units.map(file => `test/unit/${file}`)]]);
}
steps.push(['harness', ['--test', 'tests/integration/harness.test.mjs']],
  ['foundation', ['tests/integration/run-foundation.mjs'], { QA_RUN_M1: '1' }],
  ['api-read', ['tests/integration/run-api-read.mjs'], { QA_RUN_M2: '1' }],
  ['workflow', ['--test', 'tests/integration/workflow.test.mjs']],
  ['oauth-flow', ['--test', 'tests/integration/oauth-flow.test.mjs']]);
if (!integrationOnly) steps.push(['smoke-inspector', ['scripts/smoke.mjs', '--inspector']]);

const directory = join(root, '.qa-artifacts');
await mkdir(directory, { recursive: true });
const results = [];
for (const [name, args, extra = {}] of steps) {
  console.log(`\nVerify: ${name}`);
  const started = Date.now();
  const child = spawn(process.execPath, args, { cwd: root, env: { ...env, ...extra }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const relay = (stream, chunk) => { output += chunk.toString(); stream.write(chunk); };
  child.stdout.on('data', chunk => relay(process.stdout, chunk));
  child.stderr.on('data', chunk => relay(process.stderr, chunk));
  const stop = () => child.kill('SIGTERM');
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const exitCode = await new Promise(resolve => {
    child.once('error', error => { output += error.message; resolve(1); });
    child.once('close', (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  const result = { name, command: ['node', ...args], exitCode, durationMs: Date.now() - started };
  results.push(result);
  await writeFile(join(directory, `${name}.log`), output);
  if (exitCode !== 0) { process.exitCode = 1; break; }
}
const summary = { executedAt: new Date().toISOString(), scope: 'mock and synthetic loopback upstream only',
  status: results.length === steps.length && results.every(step => step.exitCode === 0) ? 'PASS' : 'FAIL', steps: results };
await writeFile(join(directory, integrationOnly ? 'integration.json' : 'verification.json'), JSON.stringify(summary, null, 2));
console.log(`\nVerification ${summary.status}; evidence in .qa-artifacts/`);
