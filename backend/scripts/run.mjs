import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] ?? 'start';
const args = mode === 'prod'
  ? ['dist/main.js']
  : mode === 'dev'
    ? ['--watch', '--import', 'tsx', 'src/main.ts']
    : ['--import', 'tsx', 'src/main.ts'];

const child = spawn(process.execPath, args, {
  cwd: backendRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS
      ?? resolve(backendRoot, 'certs/russian_trusted_root_ca.pem'),
  },
});

child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
