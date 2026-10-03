// Writes docs/parity/parity-manifest.json from docs/parity/parity-map.md and
// the exceptions registry. Usage: node tools/parity/generate.ts

import { readFileSync, writeFileSync } from 'node:fs';

import { PARITY_EXCEPTIONS } from '../../packages/contracts/src/parity/exceptions.ts';
import { REPO_ROOT } from '../lib/paths.ts';
import { deriveManifest, MANIFEST_PATH, serializeManifest } from './derive.ts';
import { parseParityMap } from './map.ts';

const manifest = deriveManifest(parseParityMap(readFileSync(`${REPO_ROOT}docs/parity/parity-map.md`, 'utf8')), PARITY_EXCEPTIONS);
writeFileSync(`${REPO_ROOT}${MANIFEST_PATH}`, serializeManifest(manifest));
console.log(`parity: wrote ${MANIFEST_PATH} (${manifest.rows.length} rows).`);
