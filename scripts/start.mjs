import { loadEnvFile } from 'node:process';
try { loadEnvFile('.env.local'); } catch (e) { if(e.code !== 'ENOENT') throw e; }
const { resolve } = await import('node:path');
process.env.DATA_DIR = resolve(process.env.DATA_DIR || './data');
if (process.env.DATABASE_PATH) process.env.DATABASE_PATH = resolve(process.env.DATABASE_PATH);
if (process.env.FILES_PATH) process.env.FILES_PATH = resolve(process.env.FILES_PATH);
const { migrate } = await import('./migrate.mjs');
migrate();
const { spawn } = await import('node:child_process');
// Live agents: the web server runs due page maintenance when this process pokes it once a minute
// with a secret generated per boot (the tick endpoint rejects every other caller).
process.env.LIVE_AGENT_TICK_TOKEN = (await import('node:crypto')).randomBytes(24).toString('hex');
const dev = process.argv.includes('--dev');
// A team worker runs from its own copy of the release: a deploy swaps .next/standalone while the worker drains
// (finishes its running agents' tasks on the old code), and the old code's files must stay where it loads them from.
let server = '.next/standalone/server.js';
if (!dev && process.env.RANKWIKI_ROLE === 'teams') {
  const { cpSync, rmSync } = await import('node:fs');
  const snap = resolve(process.env.DATA_DIR, 'teams-build-' + String(process.env.RANKWIKI_INSTANCE || '1').replace(/[^a-z0-9]+/gi, '_'));
  rmSync(snap, { recursive: true, force: true });
  cpSync(resolve('.next/standalone'), snap, { recursive: true, verbatimSymlinks: true });
  server = resolve(snap, 'server.js');
}
const child = spawn(process.execPath, dev ? ['node_modules/next/dist/bin/next', 'dev', '-H', process.env.HOSTNAME || '0.0.0.0', '-p', process.env.PORT || '3000'] : [server], { stdio: 'inherit', env: process.env });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
const tick = () => fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/live-agents/tick', { method: 'POST', headers: { 'x-live-agent-token': process.env.LIVE_AGENT_TICK_TOKEN }, signal: AbortSignal.timeout(20000) }).catch(() => {});
// RANKWIKI_ROLE=web serves pages only (no heartbeat); a separate worker process (RANKWIKI_ROLE=worker) runs the
// teams, crawler, translation and enrichment, so background work never slows readers' requests.
if (process.env.RANKWIKI_ROLE !== 'web') setTimeout(() => { void tick(); setInterval(() => void tick(), 60000); }, 60000);
// The web process warms its caches (the address map, the home page) before readers arrive.
// Then every ten minutes it renders the pages readers use (the top-level topics and every page opened in the last two
// weeks, in English and Chinese; /api/warm lists them), two at a time, so their caches are never cold or expired.
const local = p => 'http://127.0.0.1:' + (process.env.PORT || '3000') + p;
let warming = false;
const warm = async () => {
  if (warming) return; warming = true;
  try {
    const r = await fetch(local('/api/warm'), { headers: { 'x-live-agent-token': process.env.LIVE_AGENT_TICK_TOKEN }, signal: AbortSignal.timeout(30000) });
    const paths = r.ok ? (await r.json()).paths || [] : ['/', '/zh'];
    const queue = [...paths];
    await Promise.all([0, 1].map(async () => { for (let p; (p = queue.shift()) !== undefined;) await fetch(local(p), { signal: AbortSignal.timeout(90000) }).then(x => x.arrayBuffer()).catch(() => {}); }));
  } catch {} finally { warming = false; }
};
if (process.env.RANKWIKI_ROLE === 'web') { setTimeout(() => { void fetch(local('/'), { signal: AbortSignal.timeout(60000) }).catch(() => {}); }, 4000); setTimeout(() => { void warm(); setInterval(() => void warm(), 10 * 60000); }, 15000); }
