// The other-pages mark on a list the hub does not make (2026-11-02: Fansly's «Новые», a pass over Fansly's own answers):
// the hub's `otherPages` of the fans the board shows, asked together when they come up. The hub's own lists carry it in
// their rows and need no store. A database read on the hub (16 ms for 200 fans): the window never waits for it, a mark
// comes a moment after its row.

import { type OtherPageVM } from '@cg/contracts/vm';

import { createFanRounds } from './fan-rounds';
import { type BoardsClock } from './ports';

/** The site's read: only the fans with another page; null: not read. */
export type OtherPagesRead = (pageId: number, hostAccountId: string, fanRefs: readonly string[]) => Promise<ReadonlyMap<string, readonly OtherPageVM[]> | null>;

/** A read the hub did not answer is asked again only after the whole freshness, as before the hold existed. */
export const OTHER_PAGES_ROUNDS = { batch: 100, round: 300, freshMs: 5 * 60_000, holdMs: 5 * 60_000, settleMs: 250 } as const;

export interface OtherPagesStore {
  /** The fan's other pages; undefined: none known. */
  get(fanRef: string): readonly OtherPageVM[] | undefined;
  want(pageId: number, hostAccountId: string, fanRefs: readonly string[]): void;
  reset(): void;
  dispose(): void;
}

export function createOtherPagesStore(deps: { readonly read: OtherPagesRead | null; readonly clock: BoardsClock; readonly onChange: () => void }): OtherPagesStore {
  let known = new Map<string, readonly OtherPageVM[]>();
  const rounds = createFanRounds<ReadonlyMap<string, readonly OtherPageVM[]>>({
    read: deps.read,
    clock: deps.clock,
    limits: OTHER_PAGES_ROUNDS,
    answered(answer, fanRefs) {
      const next = new Map(known);
      for (const fanRef of fanRefs) {
        const pages = answer.get(fanRef);
        if (pages === undefined) next.delete(fanRef);
        else next.set(fanRef, pages);
      }
      known = next;
      deps.onChange();
    },
    forgotten() {
      known = new Map();
    },
  });
  return { get: (fanRef) => known.get(fanRef), want: rounds.want, reset: rounds.reset, dispose: rounds.dispose };
}
