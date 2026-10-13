// Copies a spike extension into a temp folder with placeholders filled (__SINK__, __VERSION__, …), so one
// source serves several installs (a version bump is an «update» of a temporary add-on).

import { cpSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXT_ROOT = fileURLToPath(new URL('../ext/', import.meta.url));

export const UUIDS = {
  'perm@cg-spike.test': 'c0000000-0000-4000-8000-000000000001',
  'lazy@cg-spike.test': 'c0000000-0000-4000-8000-000000000002',
  'main@cg-spike.test': 'c0000000-0000-4000-8000-000000000003',
  'nb2@cg-spike.test': 'c0000000-0000-4000-8000-000000000004',
  'nb3@cg-spike.test': 'c0000000-0000-4000-8000-000000000005',
};

export function prepare(name, vars = {}, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), `cg-spike-${name}-`));
  cpSync(join(EXT_ROOT, name), dir, { recursive: true });
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (['.js', '.mjs', '.json', '.html'].includes(extname(p))) {
        let text = readFileSync(p, 'utf8');
        for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`__${k}__`, v);
        writeFileSync(p, text);
      }
    }
  };
  walk(dir);
  for (const [rel, content] of Object.entries(extra)) writeFileSync(join(dir, rel), content);
  return dir;
}
