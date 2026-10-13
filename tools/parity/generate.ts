// Writes docs/parity/parity-manifest.json from docs/parity/parity-map.md, the
// R20 parity matrix (docs/project-unite/parity-matrix.md) and the exceptions
// registry. Usage: node tools/parity/generate.ts

import { readFileSync, writeFileSync } from 'node:fs';

import { PARITY_EXCEPTIONS } from '../../packages/contracts/src/parity/exceptions.ts';
import { REPO_ROOT } from '../lib/paths.ts';
import { deriveManifest, MANIFEST_PATH, serializeManifest } from './derive.ts';
import { parseParityMap } from './map.ts';
import { MATRIX_PATH, parseParityMatrix } from './matrix.ts';

const read = (path: string): string => readFileSync(`${REPO_ROOT}${path}`, 'utf8');
const manifest = deriveManifest(parseParityMap(read('docs/parity/parity-map.md')), PARITY_EXCEPTIONS, parseParityMatrix(read(MATRIX_PATH)));
writeFileSync(`${REPO_ROOT}${MANIFEST_PATH}`, serializeManifest(manifest));
console.log(`parity: wrote ${MANIFEST_PATH} (${String(manifest.rows.length)} rows).`);
