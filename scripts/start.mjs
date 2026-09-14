import { loadEnvFile } from 'node:process';
try { loadEnvFile('.env.local'); } catch (e) { if(e.code !== 'ENOENT') throw e; }
const { resolve } = await import('node:path');
process.env.DATA_DIR = resolve(process.env.DATA_DIR || './data');
if (process.env.DATABASE_PATH) process.env.DATABASE_PATH = resolve(process.env.DATABASE_PATH);
if (process.env.FILES_PATH) process.env.FILES_PATH = resolve(process.env.FILES_PATH);
const { migrate } = await import('./migrate.mjs');
migrate();
const { spawn } = await import('node:child_process');
const dev = process.argv.includes('--dev');
const child = spawn(process.execPath, dev ? ['node_modules/next/dist/bin/next', 'dev', '-H', process.env.HOSTNAME || '0.0.0.0', '-p', process.env.PORT || '3000'] : ['.next/standalone/server.js'], { stdio: 'inherit', env: process.env });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
