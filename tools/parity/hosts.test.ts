import { describe, expect, it } from 'vitest';

import { atLevel, closes, levelOfTest, onHost, placeOfTest } from './hosts.ts';

const place = (path: string, marks: readonly string[] = []) => placeOfTest(path, marks);

describe('the host of a test (plan.md §0)', () => {
  it('comes from the path: the Fansly specs and packages, the ChatSpace host and its stand fixture', () => {
    for (const path of [
      'packages/testing/e2e/specs/suite-fansly-tail.e2e.ts',
      'packages/testing/e2e/perf/fansly-perf-probe.e2e.ts',
      'packages/host-fansly/src/main/tap.test.ts',
      'packages/fansly-api/src/envelope.test.ts',
      'packages/core/src/services/hosts/fansly/newcomers.test.ts',
      'packages/ui/src/hosts/fansly/voice.test.tsx',
      'apps/extension/bg/fansly/relay.test.ts',
    ]) {
      expect(place(path).place, path).toMatchObject({ hosts: ['fansly'], by: 'path' });
    }
  });

  it('the Fansly stand is Fansly’s, as the ChatSpace stand fixture is ChatSpace’s: its page, its DOM tests, the fake Fansly and its neighbour', () => {
    for (const path of [
      'packages/testing/fixture-fansly/src/composer.test.ts',
      'packages/testing/src/fixture-fansly/composer.dom.test.ts',
      'packages/testing/src/fixture-fansly/server.dom.test.ts',
      'packages/testing/src/fake-fansly/journal.test.ts',
      'packages/testing/src/fake-fansly/neighbor/modes.test.ts',
    ]) {
      expect(place(path).place, path).toEqual({ hosts: ['fansly'], level: 'unit', by: 'path' });
    }
    // A mark of ChatSpace there is a problem, as on any Fansly path.
    expect(place('packages/testing/src/fake-fansly/api.test.ts', ['chatspace']).problems).toEqual(['packages/testing/src/fake-fansly/api.test.ts: a test of fansly code cannot carry [host:chatspace]']);
    // Neighbours by name only stay as they were: the ChatSpace stand's own fixture, the shared stand server, the fake hub.
    expect(place('packages/testing/src/fixture/chat-list.dom.test.ts').place.hosts).toEqual(['chatspace']);
    expect(place('packages/testing/src/stand/fansly-stand.test.ts').place.hosts).toEqual([]);
    expect(place('packages/testing/src/fake-hub/ai.test.ts').place.hosts).toEqual([]);
    expect(place('packages/testing/src/fake-fanslyish/x.test.ts').place.hosts).toEqual([]);
    for (const path of [
      'packages/host-chatspace/src/isolated/bridge.test.ts',
      'apps/extension/src/composition/tab/hosts/chatspace/adapter.test.ts',
      'apps/extension/bg/chatspace/custody.test.ts',
      'packages/testing/src/fixture/chat-list.dom.test.ts',
    ]) {
      expect(place(path).place, path).toMatchObject({ hosts: ['chatspace'], by: 'path' });
    }
  });

  it('without a path of a site: an e2e spec runs on the ChatSpace stand, any other test is host-free', () => {
    expect(place('packages/testing/e2e/specs/suite-preview.e2e.ts').place).toEqual({ hosts: ['chatspace'], level: 'browser', by: 'default' });
    expect(place('packages/core/test/reply.test.ts').place).toEqual({ hosts: [], level: 'unit', by: 'default' });
    // Not a site path: a file that only mentions Fansly in its name.
    expect(place('packages/contracts/test/fansly.test.ts').place.hosts).toEqual([]);
  });

  it('an explicit mark puts a test of shared code on its site; both marks — on both (a mixed test)', () => {
    expect(place('packages/platform/src/sound.test.ts', ['fansly']).place).toEqual({ hosts: ['fansly'], level: 'unit', by: 'mark' });
    expect(place('packages/testing/e2e/specs/dock-gallery-overlays.e2e.ts', ['fansly', 'chatspace']).place).toEqual({ hosts: ['chatspace', 'fansly'], level: 'browser', by: 'mark' });
    expect(place('packages/testing/e2e/specs/dock-gallery-overlays.e2e.ts', ['fansly']).place.hosts).toEqual(['fansly']);
  });

  it('a mark of the other site on a site path, or of no site, is a problem', () => {
    expect(place('packages/host-fansly/src/x.test.ts', ['chatspace']).problems).toEqual(['packages/host-fansly/src/x.test.ts: a test of fansly code cannot carry [host:chatspace]']);
    expect(place('packages/host-fansly/src/x.test.ts', ['fansly']).problems).toEqual([]);
    expect(place('packages/core/test/x.test.ts', ['onlyfans']).problems).toEqual(['packages/core/test/x.test.ts: [host:onlyfans] is no site (chatspace, fansly)']);
  });

  it('the level: an .e2e.ts spec is a browser test, the rest unit', () => {
    expect(levelOfTest('packages/testing/e2e/specs/suite-fansly-insert.e2e.ts')).toBe('browser');
    expect(levelOfTest('packages/host-fansly/src/isolated/insert.dom.test.ts')).toBe('unit');
  });
});

describe('closing a check on a host and a level', () => {
  const chatspaceSpec = place('packages/testing/e2e/specs/suite-preview.e2e.ts').place;
  const fanslySpec = place('packages/testing/e2e/specs/suite-fansly-insert.e2e.ts').place;
  const fanslyUnit = place('packages/host-fansly/src/isolated/insert.test.ts').place;
  const shared = place('packages/core/test/reply.test.ts').place;

  it('a ChatSpace test never closes a Fansly check, whatever its kind', () => {
    for (const kind of ['unit', 'e2e', 'stand-visual', 'shared'] as const) expect(closes(chatspaceSpec, 'fansly', kind), kind).toBe(false);
    expect(closes(chatspaceSpec, 'chatspace', 'e2e')).toBe(true);
  });

  it('a host-free test closes any ChatSpace row and on Fansly only a shared one', () => {
    expect(onHost(shared, 'chatspace', 'unit')).toBe(true);
    expect(closes(shared, 'fansly', 'shared')).toBe(true);
    expect(closes(shared, 'fansly', 'unit')).toBe(false);
  });

  it('a unit test does not close a browser-level row; a browser test closes a unit-level one', () => {
    expect(closes(fanslyUnit, 'fansly', 'e2e')).toBe(false);
    expect(closes(fanslyUnit, 'fansly', 'stand-visual')).toBe(false);
    expect(closes(fanslyUnit, 'fansly', 'unit')).toBe(true);
    expect(closes(fanslySpec, 'fansly', 'e2e')).toBe(true);
    expect(closes(fanslySpec, 'fansly', 'unit')).toBe(true);
    expect(closes(fanslySpec, 'fansly', 'shared')).toBe(true);
  });

  it('hub, negative, after-pilot and n/a checks are never closed by a test of ours', () => {
    for (const kind of ['hub', 'negative', 'after-pilot', 'n/a'] as const) {
      expect(atLevel(fanslySpec, kind), kind).toBe(false);
      expect(closes(fanslySpec, 'fansly', kind), kind).toBe(false);
    }
  });
});
