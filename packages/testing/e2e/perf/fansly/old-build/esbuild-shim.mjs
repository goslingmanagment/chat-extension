// The esbuild the old Fansly extension's build script gets under build.ts
// (hooks.mjs): the checkout's own esbuild, with two changes to what its script
// asks for, both told by CG_OLD_FANSLY_BUILD (JSON):
// - `buildTime`: the value of `__CHATGOOSE_BUILD_TIME__` (the script stamps
//   `new Date()`); the served release's own stamp makes the release-equivalent
//   build byte-identical to the served XPI, and the test build differ from it
//   only by the rules;
// - `rules`: the stand rules (rules.ts), applied to the source text of their
//   files as esbuild loads them. Each load is counted; build.ts checks that
//   every rule met exactly its count.

import { appendFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, relative } from 'node:path';
import process from 'node:process';

const settings = JSON.parse(process.env.CG_OLD_FANSLY_BUILD ?? 'null');
if (settings === null) throw new Error('esbuild-shim: CG_OLD_FANSLY_BUILD is not set (run build.ts)');

// Resolved from the checkout (its package.json, not its build script: hooks.mjs redirects that one's import here).
const real = createRequire(`${settings.source}/package.json`)('esbuild');

const LOADERS = { '.ts': 'ts', '.tsx': 'tsx', '.js': 'js', '.mjs': 'js' };

const standRules = {
  name: 'cg-stand-addresses',
  setup(build) {
    build.onLoad({ filter: /\.(?:ts|tsx|js|mjs)$/ }, (args) => {
      if (args.namespace !== 'file') return undefined;
      const file = relative(settings.source, args.path).split('\\').join('/');
      const rules = settings.rules.filter((rule) => rule.file === file);
      if (rules.length === 0) return undefined;
      let text = readFileSync(args.path, 'utf8');
      for (const rule of rules) {
        const found = text.split(rule.from).length - 1;
        text = text.split(rule.from).join(rule.to);
        appendFileSync(settings.ledger, `${JSON.stringify({ file, from: rule.from, found })}\n`);
      }
      return { contents: text, loader: LOADERS[extname(args.path)] ?? 'ts', resolveDir: args.path.slice(0, args.path.lastIndexOf('/')) };
    });
  },
};

function adjust(options) {
  return {
    ...options,
    define: { ...options.define, __CHATGOOSE_BUILD_TIME__: JSON.stringify(settings.buildTime) },
    plugins: settings.rules.length === 0 ? options.plugins : [...(options.plugins ?? []), standRules],
  };
}

export const build = (options) => real.build(adjust(options));
export const context = () => {
  throw new Error('esbuild-shim: watch mode is not part of the baseline build');
};
export const version = real.version;
export default { ...real, build, context };
