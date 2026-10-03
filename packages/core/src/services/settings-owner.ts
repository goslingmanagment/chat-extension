// The settings owner (architecture.md §9.4, D-23; RB-011, RB-012, ST-013…ST-018).
//
// - The background is the single writer: changes run one at a time and each
//   is ONE storage.local.set of the whole `settings` value.
// - Migrations run forward only, at start, before the first answer (the
//   readiness barrier waits for `start`); a migrated value is written back once.
// - A store newer than this build is read-only (CG-STORAGE-VERSION): read
//   what is readable, write nothing.
// - A broken optional value falls back to its default and is logged by path.
// - A failed read never erases: nothing is written until a read succeeds;
//   until then `settings.get` and every write answer CG-STORAGE-READ (ST-017
//   «Settings Unavailable», distinct from ST-016's read-only CG-STORAGE-VERSION),
//   nothing is broadcast, and the next request reads again.
// - «Сохранено» only on a confirmed write: every confirmed change bumps the
//   revision (kept in storage.session, so it survives the event page
//   unloading) and is broadcast (`settings.changed`) to every tab and page.
//   A write whose confirmation was lost is read back: landed — confirmed;
//   not landed — «не сохранено»; unknown — the next request reads first, so a
//   later patch never writes over a value that may have landed.
// - A change from outside (another build, «Очистить локальные данные») is
//   never taken from the event's value: the owner reads the key again in its
//   chain and adopts it only when it differs from what the owner wrote — a
//   late echo of the owner's own earlier write is not an outside change.
// - Sign-in and identity are not here (separate `auth.*` keys); the persona
//   scope is set only by the background (`setPersonaScope`), never guessed.

import type { CgCode, CgErrorWire } from '@cg/contracts/errors';
import {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  STORAGE_KEYS,
  type SettingsLoadOutcome,
  type SettingsMigrations,
  type SettingsPatch,
  type SettingsState,
  type SettingsV1,
} from '@cg/contracts/settings';

import { SETTINGS_MIGRATIONS, applySettingsPatch, loadStoredSettings, withPersonaScope } from '../domain/settings';
import { SESSION_KEYS, stableJson } from '../domain/storage';
import { NO_LOG, createWriteChain, type KeyValuePort, type ServiceLog } from './storage/ports';

export interface SettingsOwnerDeps {
  readonly local: KeyValuePort;
  readonly session: KeyValuePort;
  readonly migrations?: SettingsMigrations;
  /** The build's schema version (tests of a future chain); default SETTINGS_SCHEMA_VERSION. */
  readonly schemaVersion?: number;
  readonly log?: ServiceLog;
  /** A confirmed change: the composition root emits `settings.changed`. */
  readonly onChange?: (state: SettingsState) => void;
}

export type SettingsResult =
  | { readonly ok: true; readonly state: SettingsState }
  | { readonly ok: false; readonly error: CgErrorWire; readonly state: SettingsState };

/** A write's answer; the same shape as a read's. */
export type SettingsWriteResult = SettingsResult;

export type SettingsMode = 'loading' | 'ok' | 'newer' | 'unreadable';

export interface SettingsOwner {
  /** Load and migrate; the readiness barrier runs it. Idempotent. */
  start(): Promise<SettingsLoadOutcome>;
  /**
   * `settings.get`: the settings, read-only when a newer build stored them
   * (CG-STORAGE-VERSION); CG-STORAGE-READ while they cannot be read (never
   * defaults posing as the person's values).
   */
  state(): Promise<SettingsResult>;
  /** The settings in memory now (defaults before `start` and while unreadable). */
  current(): SettingsV1;
  mode(): SettingsMode;
  /** `settings.patch` (restricted: false) and `settings.patchRestricted` (true, options page only). */
  patch(patch: SettingsPatch, options: { readonly baseRevision: number | null; readonly restricted: boolean }): Promise<SettingsWriteResult>;
  /** Sign-in of a hub user: another scope clears the persona choices (§5.6 `personas.scope`). */
  setPersonaScope(scope: SettingsV1['personas']['scope']): Promise<SettingsWriteResult>;
  /** Every confirmed change and every change read from outside (besides `deps.onChange`). */
  onChange(listener: (state: SettingsState) => void): () => void;
  dispose(): void;
}

const SCOPE = 'bg.settings';
const KEY = STORAGE_KEYS.settings;

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function createSettingsOwner(deps: SettingsOwnerDeps): SettingsOwner {
  const log = deps.log ?? NO_LOG;
  const migrations = deps.migrations ?? SETTINGS_MIGRATIONS;
  const schemaVersion = deps.schemaVersion ?? SETTINGS_SCHEMA_VERSION;
  const chain = createWriteChain();
  let mode: SettingsMode = 'loading';
  let settings: SettingsV1 = copy(DEFAULT_SETTINGS);
  let revision = 0;
  /** What storage holds as far as we know (stable JSON); an onChanged with it is our own echo. */
  let known: string | null = null;
  let writing: string | null = null;
  /** A write's outcome or an outside change could not be read back: read before the next answer. */
  let stale = false;
  let started: Promise<SettingsLoadOutcome> | null = null;
  const listeners = new Set<(state: SettingsState) => void>();

  /** `settings.changed` to every tab and page (the composition root's emit), then in-process listeners. */
  const broadcast = (state: SettingsState): void => {
    // Unreadable settings are never broadcast: defaults would pose as the person's values.
    if (mode === 'unreadable') return;
    for (const listener of [deps.onChange, ...listeners]) {
      if (!listener) continue;
      try {
        listener(state);
      } catch {
        log({ level: 'warn', scope: SCOPE, msg: 'settings listener failed' });
      }
    }
  };

  /** `readOnly` is true in 'newer' and 'unreadable'; only 'newer' is ever sent (unreadable answers CG-STORAGE-READ). */
  const snapshot = (): SettingsState => ({ settings: copy(settings), revision, readOnly: mode !== 'ok' });
  const fail = (code: CgCode, detail?: string): SettingsWriteResult => ({ ok: false, error: detail === undefined ? { code } : { code, detail }, state: snapshot() });

  async function bumpRevision(): Promise<number> {
    const next = revision + 1;
    // First the revision, then the value: a failure in between leaves a gap, never a reused number.
    const saved = await deps.session.set({ [SESSION_KEYS.settingsRevision]: next });
    if (!saved.ok) log({ level: 'warn', scope: SCOPE, msg: 'revision not kept', code: saved.code });
    return next;
  }

  function adopt(outcome: SettingsLoadOutcome, raw: unknown): void {
    switch (outcome.kind) {
      case 'fresh':
        mode = 'ok';
        settings = outcome.settings;
        known = stableJson(raw);
        break;
      case 'current':
      case 'migrated':
        mode = 'ok';
        settings = outcome.settings;
        known = stableJson(raw);
        if (outcome.repaired.length > 0) {
          log({ level: 'warn', scope: SCOPE, msg: 'broken settings reset to defaults', fields: { paths: outcome.repaired.join(',').slice(0, 400), count: outcome.repaired.length } });
        }
        break;
      case 'newer':
        mode = 'newer';
        settings = outcome.settings;
        known = stableJson(raw);
        log({ level: 'warn', scope: SCOPE, msg: 'settings stored by a newer build: read-only', code: 'CG-STORAGE-VERSION', fields: { storedVersion: outcome.storedVersion } });
        break;
      case 'unreadable':
        mode = 'unreadable';
        log({ level: 'error', scope: SCOPE, msg: 'settings not interpretable: left untouched', code: outcome.code });
        break;
    }
  }

  async function load(): Promise<SettingsLoadOutcome> {
    const read = await deps.local.get([KEY]);
    if (!read.ok) {
      mode = 'unreadable';
      log({ level: 'error', scope: SCOPE, msg: 'settings read failed', code: 'CG-STORAGE-READ' });
      return { kind: 'unreadable', code: 'CG-STORAGE-READ' };
    }
    const raw = read.value[KEY];
    const outcome = loadStoredSettings(raw, migrations, schemaVersion);
    adopt(outcome, raw);
    if (outcome.kind === 'migrated') {
      // Forward once, before the first answer; a failure only means the next start migrates again.
      writing = stableJson(outcome.settings);
      const saved = await deps.local.set({ [KEY]: outcome.settings });
      writing = null;
      if (saved.ok) known = stableJson(outcome.settings);
      log({ level: saved.ok ? 'info' : 'warn', scope: SCOPE, msg: 'settings migrated', ...(saved.ok ? {} : { code: saved.code }), fields: { from: outcome.from, saved: saved.ok } });
    }
    return outcome;
  }

  const ensureStarted = (): Promise<SettingsLoadOutcome> => (started ??= owner.start());

  /**
   * Reads the key and adopts it when it is not what the owner knows it wrote
   * (an outside change, a value that landed after all, a store readable
   * again). Runs inside the chain, so no write of ours is in flight. False —
   * the read failed.
   */
  async function reconcile(): Promise<boolean> {
    const read = await deps.local.get([KEY]);
    if (!read.ok) {
      stale = true;
      log({ level: 'error', scope: SCOPE, msg: 'settings read failed', code: 'CG-STORAGE-READ' });
      return false;
    }
    stale = false;
    const raw = read.value[KEY];
    if ((mode === 'ok' || mode === 'newer') && stableJson(raw) === known) return true;
    const before = mode;
    adopt(loadStoredSettings(raw, migrations, schemaVersion), raw);
    // Not interpretable: logged by adopt; no revision, no broadcast (`settings.get` answers CG-STORAGE-READ).
    if (mode === 'unreadable') return true;
    revision = await bumpRevision();
    log({ level: 'info', scope: SCOPE, msg: 'settings read again', fields: { from: before, mode } });
    broadcast(snapshot());
    return true;
  }

  /** Before an answer: a read failed earlier, or a write's outcome is unknown — read first (never write on top of an unread value). */
  async function refresh(): Promise<void> {
    if (mode === 'unreadable' || stale) await reconcile();
  }

  /** Writes stop here: unreadable (CG-STORAGE-READ), newer (CG-STORAGE-VERSION) or still unread (CG-STORAGE-READ). */
  function writeBlocked(): SettingsWriteResult | null {
    if (mode === 'unreadable' || stale) return fail('CG-STORAGE-READ');
    if (mode === 'newer') return fail('CG-STORAGE-VERSION');
    return null;
  }

  async function write(next: SettingsV1, reason: string): Promise<SettingsWriteResult> {
    const nextRevision = await bumpRevision();
    const target = stableJson(next);
    writing = target;
    const saved = await deps.local.set({ [KEY]: next });
    writing = null;
    if (!saved.ok) {
      // The confirmation may be lost while the value landed: read it back once.
      const check = await deps.local.get([KEY]);
      const landed = check.ok && stableJson(check.value[KEY]) === target;
      if (!landed) {
        if (!check.ok) stale = true;
        log({ level: 'error', scope: SCOPE, msg: 'settings not saved', code: saved.code, fields: { reason, readBack: check.ok } });
        return fail(saved.code);
      }
      log({ level: 'warn', scope: SCOPE, msg: 'settings write confirmed by reading it back', code: saved.code, fields: { reason } });
    }
    settings = next;
    revision = nextRevision;
    known = target;
    const state = snapshot();
    broadcast(state);
    return { ok: true, state };
  }

  const unsubscribe = deps.local.onChanged((changes) => {
    const change = changes[KEY];
    if (change === undefined) return;
    // Before `start` there is nothing to reconcile: its load reads the key as it is then.
    if (started === null) return;
    // Cheap filter only: what the owner knows or is writing now. The decision is a fresh read in the chain.
    const seen = stableJson(change.newValue);
    if ((seen === known && mode !== 'unreadable') || seen === writing) return;
    void chain(reconcile);
  });

  const owner: SettingsOwner = {
    start() {
      started ??= chain(async () => {
        const stored = await deps.session.get([SESSION_KEYS.settingsRevision]);
        const value = stored.ok ? stored.value[SESSION_KEYS.settingsRevision] : undefined;
        if (typeof value === 'number' && Number.isInteger(value) && value >= 0) revision = value;
        return load();
      });
      return started;
    },
    async state() {
      await ensureStarted();
      return chain(async (): Promise<SettingsResult> => {
        await refresh();
        // A store that cannot be read is ST-017 «Settings Unavailable», never defaults read-only.
        if (mode === 'unreadable') return fail('CG-STORAGE-READ');
        return { ok: true, state: snapshot() };
      });
    },
    current: () => copy(settings),
    mode: () => mode,
    async patch(patch, options) {
      await ensureStarted();
      return chain(async () => {
        await refresh();
        const blocked = writeBlocked();
        if (blocked) return blocked;
        const outcome = applySettingsPatch(settings, patch, { restricted: options.restricted });
        // Defensive: the RPC schema refuses both before the handler. Not a storage failure — a retry cannot help.
        if (!outcome.ok) return fail('CG-UNKNOWN', outcome.reason === 'restricted' ? 'restricted section' : 'invalid settings');
        if (options.baseRevision !== null && options.baseRevision !== revision) {
          log({ level: 'info', scope: SCOPE, msg: 'patch on an older revision merged field by field', fields: { base: options.baseRevision, revision } });
        }
        // Nothing changes (a resent patch after a lost confirmation): confirm without a write.
        if (!outcome.changed) return { ok: true, state: snapshot() };
        return write(outcome.settings, outcome.hubChanged ? 'hub' : 'patch');
      });
    },
    async setPersonaScope(scope) {
      await ensureStarted();
      return chain(async () => {
        await refresh();
        const blocked = writeBlocked();
        if (blocked) return blocked;
        const next = withPersonaScope(settings, scope);
        if (next === settings) return { ok: true, state: snapshot() };
        return write(next, 'persona-scope');
      });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      unsubscribe();
      listeners.clear();
    },
  };
  return owner;
}

/** The answer shape of the background RPC (platform `RpcResult`). */
export type ServiceAnswer<T> = { readonly ok: true; readonly payload: T } | { readonly ok: false; readonly error: CgErrorWire };

export interface SettingsPatchRequest {
  readonly patch: SettingsPatch;
  readonly baseRevision: number | null;
}

/**
 * Handlers of `settings.get`, `settings.patch` and `settings.patchRestricted`
 * for the composition root (`rpc.handle(type, handlers[type])`); the RPC has
 * already checked the sender, the page allowlist and the payload schema.
 */
export function settingsRequestHandlers(owner: SettingsOwner): {
  readonly 'settings.get': () => Promise<ServiceAnswer<SettingsState>>;
  readonly 'settings.patch': (request: SettingsPatchRequest) => Promise<ServiceAnswer<SettingsState>>;
  readonly 'settings.patchRestricted': (request: SettingsPatchRequest) => Promise<ServiceAnswer<SettingsState>>;
} {
  const answer = (result: SettingsResult): ServiceAnswer<SettingsState> => (result.ok ? { ok: true, payload: result.state } : { ok: false, error: result.error });
  return {
    'settings.get': async () => answer(await owner.state()),
    'settings.patch': async (request) => answer(await owner.patch(request.patch, { baseRevision: request.baseRevision, restricted: false })),
    'settings.patchRestricted': async (request) => answer(await owner.patch(request.patch, { baseRevision: request.baseRevision, restricted: true })),
  };
}
