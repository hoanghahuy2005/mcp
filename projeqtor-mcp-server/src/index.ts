import { loadConfig } from './config.js';
import { createMcpServer } from './server.js';
import { startHttpServer } from './transports/http.js';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { log } from './logging.js';
import { createReadClient } from './clients/index.js';
import { ActivityWorkflow } from './services/activity-workflow.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--stdio') || args.length > 1) throw new Error('Usage: node dist/index.js [--stdio]');
  const config = loadConfig(args.includes('--stdio') ? { ...process.env, MCP_TRANSPORT: 'stdio' } : process.env);
  const client = createReadClient(config);
  const workflow = new ActivityWorkflow(client, config);
  const handle = config.transport === 'stdio'
    ? serveStdio(() => createMcpServer(client, workflow), { onerror: () => log('protocol_error') })
    : await startHttpServer(config);
  if (config.transport === 'stdio') log('stdio_started', { transport: 'stdio' });
  let stopping = false;
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    log('shutdown', { transport: config.transport });
    void handle.close().catch(() => { process.exitCode = 1; });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch(() => {
  log('startup_failed');
  process.exitCode = 1;
});
