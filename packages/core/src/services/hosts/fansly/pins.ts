// Temporary chat pins on Fansly, as the background keeps them (2026-11-12; contracts fansly-pins.ts): the one owner of
// `fansly.pins` in storage.local, for `fansly.pins.read` and `fansly.pins.change` of Fansly's background chunk.
//
// - One key, one person: `{v: 1, owner: '<hubOrigin>|<userId>', accounts: {[creator]: pins}}`. Nobody signed in: an
//   empty answer, nothing written or deleted. Another owner than the stored one: the stored value is dropped and the
//   key starts empty for the new one. The owner is read at each operation — an idle module hears no session event, so
//   no cleanup by event could lose pins mid-shift or miss another person.
// - Every read and write is one step of one queue: a tab never reads, decides and writes by itself.
// - Each operation prunes what expired (domain/hosts/fansly/pins.ts), applies itself (a touch before the prune) and
//   writes only what changed; every creator's expired pins go with it, and a creator with none is dropped.
// - Ids, names and moments only; the log hears counts.

import { FANSLY_PIN_LIMITS, type FanslyPin, type FanslyPinOp } from '@cg/contracts/fansly-pins';

import { applyPinOp, pinStoreOf, prunePins, readPinStore, samePinChips } from '../../../domain/hosts/fansly/pins';
import { LOCAL_KEYS, STORAGE_KEY_BUDGETS } from '../../../domain/storage';
import { createWriteChain, type KeyValuePort, type ServiceLog } from '../../storage/ports';

export const FANSLY_PINS_KEY = LOCAL_KEYS.fanslyPins;

export interface FanslyPinsDeps {
  readonly local: KeyValuePort;
  readonly now: () => number;
  /** Who is signed in now (`<hubOrigin>|<userId>`); null — nobody. */
  readonly owner: () => string | null;
  readonly log?: ServiceLog;
}

/** A creator's pins after an operation; `changed` — the chips differ from before (a pin, an unpin, an expiry): the tabs are told. */
export interface FanslyPinsAnswer {
  readonly pins: readonly FanslyPin[];
  readonly changed: boolean;
}

export interface FanslyPinsService {
  read(creator: string): Promise<FanslyPinsAnswer>;
  change(creator: string, op: FanslyPinOp): Promise<FanslyPinsAnswer>;
}

/** The store could not be read or written: the tab keeps what it shows. */
export class FanslyPinsStorageError extends Error {
  constructor(readonly code: 'CG-STORAGE-READ' | 'CG-STORAGE-WRITE' | 'CG-STORAGE-FULL') {
    super(code);
  }
}

const SCOPE = 'bg.fansly.pins';
const NONE: FanslyPinsAnswer = { pins: [], changed: false };

export function createFanslyPins(deps: FanslyPinsDeps): FanslyPinsService {
  const log = deps.log ?? (() => undefined);
  const chain = createWriteChain();
  const budget = STORAGE_KEY_BUDGETS[FANSLY_PINS_KEY] ?? 8 * 1024;

  const run = (creator: string, op: FanslyPinOp | null): Promise<FanslyPinsAnswer> =>
    chain(async () => {
      const owner = deps.owner();
      if (owner === null) return NONE;
      const got = await deps.local.get([FANSLY_PINS_KEY]);
      if (!got.ok) {
        log({ level: 'warn', scope: SCOPE, msg: 'pins not read', code: got.code });
        throw new FanslyPinsStorageError('CG-STORAGE-READ');
      }
      const raw = got.value[FANSLY_PINS_KEY];
      const stored = readPinStore(raw, owner);
      if (stored.foreign) log({ level: 'info', scope: SCOPE, msg: 'pins of another owner dropped' });
      const now = deps.now();
      const before = stored.accounts[creator] ?? [];
      const after = op === null ? prunePins(before, now) : applyPinOp(before, op, now);
      const next = pinStoreOf(owner, { ...stored.accounts, [creator]: after }, now, creator, budget);
      // Written only when something changed: a read of nothing new costs no write.
      if (raw === undefined ? Object.keys(next.accounts).length > 0 : JSON.stringify(next) !== JSON.stringify(raw)) {
        const written = Object.keys(next.accounts).length === 0 ? await deps.local.remove([FANSLY_PINS_KEY]) : await deps.local.set({ [FANSLY_PINS_KEY]: next });
        if (!written.ok) {
          log({ level: 'warn', scope: SCOPE, msg: 'pins not written', code: written.code, fields: { op: op?.op ?? 'read' } });
          throw new FanslyPinsStorageError(written.code === 'CG-STORAGE-FULL' ? 'CG-STORAGE-FULL' : 'CG-STORAGE-WRITE');
        }
      }
      const pins = next.accounts[creator] ?? [];
      return { pins: pins.slice(0, FANSLY_PIN_LIMITS.max), changed: !samePinChips(before, pins) };
    });

  return {
    read: (creator) => run(creator, null),
    change: (creator, op) => run(creator, op),
  };
}
