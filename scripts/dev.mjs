import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const children = [
  spawn(process.execPath, ['--watch', 'src/server.js'], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, [viteBin, '--config', 'client/vite.config.ts'], { cwd: root, stdio: 'inherit' })
];

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) if (!child.killed) child.kill();
  setTimeout(() => process.exit(code), 100);
}

for (const child of children) child.once('exit', (code) => { if (!shuttingDown) shutdown(code || 0); });
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
