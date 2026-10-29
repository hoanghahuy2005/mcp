// Explicit opt-in only after Main communicates M2 readiness. No build/install.
import { spawn } from 'node:child_process';
import { cleanEnvironment, projectRoot } from './support/m2-process.mjs';

if (process.env.QA_RUN_M2 !== '1') {
  console.error('Await Main M2 readiness: set QA_RUN_M2=1 before executing product integration.');
  process.exitCode = 1;
} else {
  const child = spawn(process.execPath, ['--test', 'tests/integration/api-read.test.mjs'], {
    cwd: projectRoot, env: { ...cleanEnvironment(), QA_RUN_M2: '1' },
    stdio: 'inherit', windowsHide: true,
  });
  const interrupt = () => child.kill('SIGTERM');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  child.once('error', () => { console.error('Could not start M2 QA test process.'); process.exitCode = 1; });
  child.once('close', (code, signal) => {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    process.exitCode = signal ? 1 : (code ?? 1);
  });
}
