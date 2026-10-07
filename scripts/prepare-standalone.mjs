import { cp, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
await mkdir('.next/standalone/.next', { recursive:true });
await cp('public', '.next/standalone/public', { recursive:true });
await cp('vendor', '.next/standalone/vendor', { recursive:true });
await cp('.next/static', '.next/standalone/.next/static', { recursive:true });
// Sources of built-in apps, readable by agents that rebuild them as page apps.
const nativeSources = JSON.parse(await readFile('app/page-programs/native-sources.json', 'utf8'));
for (const path of Object.values(nativeSources).flat()) { await mkdir(dirname('.next/standalone/native-sources/' + path), { recursive:true }); await cp(path, '.next/standalone/native-sources/' + path); }
