// The neighbour's switches (R20 P6d, S5 §6.1): how a test names a mode and its
// flags, and how the stand server puts the boot script into a page.

import { describe, expect, it } from 'vitest';

import { DEFAULT_GUARD_WORDS, DEFAULT_NEIGHBOR, NEIGHBOR_PARAM, neighborConfig, neighborSpec, parseNeighborSpec } from './protocol';
import { bootTag, neighborFor, withNeighbor } from './serve';

describe('the neighbour spec', () => {
  it('names the mode first; `after` is the default, with the field defaults', () => {
    expect(parseNeighborSpec('')).toEqual(DEFAULT_NEIGHBOR);
    expect(DEFAULT_NEIGHBOR).toMatchObject({ mode: 'after', timing: 'load', guard: [], panel: 'off', generic: null, pollMs: 10_000, translateMs: 300 });
    for (const mode of ['off', 'after', 'before', 'reinject', 'legacy'] as const) expect(parseNeighborSpec(mode).mode).toBe(mode);
  });

  it('reads the flags: +guard (with its words), panel, generic, timing and the periods', () => {
    expect(parseNeighborSpec('after,guard').guard).toEqual(DEFAULT_GUARD_WORDS);
    expect(parseNeighborSpec('after,guard=nope|stop').guard).toEqual(['nope', 'stop']);
    expect(parseNeighborSpec('before,panel=mobile').panel).toBe('mobile');
    expect(parseNeighborSpec('off,generic').generic).toBe('proxy');
    expect(parseNeighborSpec('off,generic=subclass').generic).toBe('subclass');
    expect(parseNeighborSpec('after,timing=first-xhr').timing).toBe('first-xhr');
    expect(parseNeighborSpec('reinject,reinject=1500,poll=250,translate=10,noisy=100,flood=2000,mod=ctrl')).toMatchObject({
      mode: 'reinject',
      reinjectMs: 1500,
      pollMs: 250,
      translateMs: 10,
      noisyMs: 100,
      floodMs: 2000,
      mod: 'ctrl',
    });
  });

  it('takes a space as a separator: `after+guard` typed into an address decodes to one', () => {
    const decoded = new URL('http://localhost/messages?stand-neighbor=after+guard').searchParams.get(NEIGHBOR_PARAM) ?? '';
    expect(parseNeighborSpec(decoded)).toMatchObject({ mode: 'after', guard: DEFAULT_GUARD_WORDS });
  });

  it('refuses a typo: a mode, a flag or a value it does not know', () => {
    expect(() => parseNeighborSpec('aftre')).toThrow(/mode/);
    expect(() => parseNeighborSpec('after,gaurd')).toThrow(/unknown token/);
    expect(() => parseNeighborSpec('after,panel=wide')).toThrow(/panel/);
    expect(() => parseNeighborSpec('after,poll=soon')).toThrow(/milliseconds/);
  });

  it('round-trips through the spec an e2e test puts into the address', () => {
    const config = neighborConfig({ mode: 'reinject', guard: ['a', 'b'], panel: 'desktop', generic: 'subclass', timing: 'first-xhr', reinjectMs: 900, pollMs: 300, mod: 'meta', floodMs: 50 });
    expect(parseNeighborSpec(neighborSpec(config))).toEqual(config);
    expect(neighborSpec({ mode: 'after' })).toBe('after');
  });
});

describe('the stand server and the neighbour', () => {
  const page = '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <title>Fansly stand</title>\n    <script type="module" src="/src/main.ts"></script>\n  </head>\n</html>';

  it('a page gets its own spec first, else the stand default; `off` without `generic` is none', () => {
    const standing = neighborConfig({ mode: 'after' });
    expect(neighborFor(new URL('http://localhost/messages'), null)).toBeNull();
    expect(neighborFor(new URL('http://localhost/messages'), standing)).toEqual(standing);
    expect(neighborFor(new URL('http://localhost/messages?stand-neighbor=before'), standing)?.mode).toBe('before');
    expect(neighborFor(new URL('http://localhost/messages?stand-neighbor=off'), standing)).toBeNull();
    expect(neighborFor(new URL('http://localhost/messages?stand-neighbor=off,generic'), null)?.generic).toBe('proxy');
    expect(() => neighborFor(new URL('http://localhost/messages?stand-neighbor=nope'), null)).toThrow();
  });

  it('puts the boot script right after <meta charset>, before every script of the page, its facts as JSON', () => {
    const facts = { config: neighborConfig({ guard: ['a"b<c'] }), apiOrigin: 'http://localhost:4100' };
    const served = withNeighbor(page, facts);
    const boot = served.indexOf(bootTag(facts));
    expect(boot).toBeGreaterThan(served.indexOf('<meta charset="utf-8" />'));
    expect(boot).toBeLessThan(served.indexOf('<title>'));
    expect(boot).toBeLessThan(served.indexOf('/src/main.ts'));
    const attribute = /data-fbuddy-stand="([^"]*)"/.exec(served)?.[1] ?? '';
    const decoded = attribute.replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    expect(JSON.parse(decoded)).toEqual(facts);
    expect(served).toContain('data-fbuddy-stand-part="boot"');
    expect(served).toContain('src="/neighbor/neighbor.js"');
  });
});
