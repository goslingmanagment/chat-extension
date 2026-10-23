// Sign-in custody (architecture.md §8.2, §14; AU-006…AU-016). The token,
// the hub origin it was issued by and the user live in ONE record
// (`auth.token`), written by one storage call; its metadata and the epoch
// counter live in `auth.meta`. Every transition — sign-in, sign-out, the
// wipe after a 401 token_revoked/token_expired — runs strictly one at a
// time (FIFO, AU-009) and bumps the epoch, which aborts every operation of
// the previous sign-in. The token never leaves this module except as the
// bearer of a request; it is never logged.

import {
  CgCodeSchema,
  CountSchema,
  HubIntIdSchema,
  HubOriginSchema,
  IsoTimestampSchema,
  RoleSchema,
  STORAGE_KEYS,
  boundedText,
  type CgCode,
  type SessionIdentity,
} from '@cg/contracts';
import * as z from 'zod/mini';

import { type HubClock, type HubKeyValueStore, type HubLog } from './ports';

export const StoredAuthSchema = z.strictObject({
  v: z.literal(1),
  token: z.string().check(z.minLength(1), z.maxLength(4096)),
  hubOrigin: HubOriginSchema,
  user: z.strictObject({ userId: HubIntIdSchema, login: boundedText(128), role: RoleSchema }),
  /** The epoch this sign-in started; every transition after it bumps the counter. */
  epoch: CountSchema,
  /** The hub echoed `client: 'chat-extension'` (H-3). false = a full token kept only in the dev/compat mode. */
  narrow: z.boolean(),
});
export type StoredAuth = z.infer<typeof StoredAuthSchema>;

export const END_REASONS = ['sign-out', 'revoked', 'expired', 'outdated', 'hub-changed'] as const;
export type EndReason = (typeof END_REASONS)[number];

export const AuthMetaSchema = z.strictObject({
  v: z.literal(1),
  /** Monotonic across sign-outs and background restarts. */
  epoch: CountSchema,
  /** AU-008: prefix, issuedAt, expiresAt, the device label, the extension version that signed in. */
  token: z.nullable(
    z.strictObject({
      keyPrefix: boundedText(64),
      issuedAt: IsoTimestampSchema,
      expiresAt: IsoTimestampSchema,
      label: boundedText(120),
      version: boundedText(32),
    }),
  ),
  /** AU-015: why the last sign-in ended, for the banner on the sign-in screen. */
  lastEnd: z.nullable(z.strictObject({ reason: z.enum(END_REASONS), at: IsoTimestampSchema, code: z.nullable(CgCodeSchema) })),
});
export type AuthMeta = z.infer<typeof AuthMetaSchema>;
export type TokenMeta = NonNullable<AuthMeta['token']>;
export type LastEnd = NonNullable<AuthMeta['lastEnd']>;

/** AU-016: none / bound / mismatch (another hub than the settings name) / unreadable. */
export type AuthState = 'none' | 'bound' | 'mismatch' | 'unreadable';

/** Reasons of the tab event `session.changed`. */
export type SessionChangeReason = 'sign-in' | 'sign-out' | 'revoked' | 'expired' | 'hub-changed';

export interface SessionChange {
  readonly session: SessionIdentity | null;
  readonly reason: SessionChangeReason;
  readonly epoch: number;
  /** The code of the banner (AU-015): CG-AUTH-REVOKED, CG-AUTH-EXPIRED, CG-HUB-OUTDATED; null for a plain sign-in/out. */
  readonly code: CgCode | null;
}

export type Unsubscribe = () => void;

/** The sign-in could not be written: nothing is kept (AU-006). */
export class AuthWriteError extends Error {
  override readonly name = 'AuthWriteError';
}

const UNAUTHORIZED_WIPE_REASONS = { token_revoked: 'revoked', token_expired: 'expired' } as const;

/** A sign-in whose read failed is read again on its next use, at most this long after the last failed read. */
export const AUTH_REREAD_MS = 5_000;

export class AuthCustody {
  private stored: StoredAuth | null = null;
  private meta: AuthMeta = { v: 1, epoch: 0, token: null, lastEnd: null };
  private readable = true;
  /** When the last read failed (monotonic ms) — the storage call, not a record that did not parse; null — none did. */
  private readFailedAt: number | null = null;
  private rereading = false;
  private tail: Promise<void> = Promise.resolve();
  private epochController = new AbortController();
  /** The settings' hub address as of the last sign-in, start or address change (hubOriginChanged). */
  private knownOrigin: string | null = null;
  /** The sign-in a 401 token_revoked/token_expired ended (memory only), so the call that carried it still reads its own code. */
  private endedByUnauthorized: { readonly epoch: number; readonly token: string } | null = null;
  private readonly listeners = new Set<(change: SessionChange) => void>();

  constructor(
    private readonly deps: {
      readonly local: HubKeyValueStore;
      readonly clock: HubClock;
      readonly log: HubLog;
      readonly configuredOrigin: () => string;
      /** A sign-in that could not be read at start was read again and is usable: what the start does after its read. */
      readonly onReadAgain?: () => Promise<void>;
    },
  ) {}

  /**
   * Reads the stored sign-in at background start. A failed read never erases anything and never guesses an
   * identity; it is read again on the next use (`state`).
   */
  async load(): Promise<void> {
    this.knownOrigin = this.deps.configuredOrigin();
    await this.read();
  }

  private async read(): Promise<void> {
    const read = await this.deps.local.get([STORAGE_KEYS.authToken, STORAGE_KEYS.authMeta]);
    if (!read.ok) {
      this.readable = false;
      this.readFailedAt = this.deps.clock.monotonic();
      this.deps.log('error', 'auth: storage read failed', { code: read.code });
      return;
    }
    this.readable = true;
    this.readFailedAt = null;
    const raw = read.value;
    const meta = AuthMetaSchema.safeParse(raw[STORAGE_KEYS.authMeta]);
    if (meta.success) this.meta = meta.data;
    const token = raw[STORAGE_KEYS.authToken];
    if (token === undefined || token === null) return;
    const stored = StoredAuthSchema.safeParse(token);
    if (!stored.success) {
      this.readable = false;
      this.deps.log('error', 'auth: stored sign-in is unreadable');
      return;
    }
    this.stored = stored.data;
    this.meta = { ...this.meta, epoch: Math.max(this.meta.epoch, stored.data.epoch) };
  }

  state(): AuthState {
    if (!this.readable) {
      this.readAgainSoon();
      return 'unreadable';
    }
    if (this.stored === null) return 'none';
    return this.stored.hubOrigin === this.deps.configuredOrigin() ? 'bound' : 'mismatch';
  }

  /**
   * AU-016 «unreadable» after a failed storage call lasts until the next use, not for the event page's life: the
   * use is answered by what is known now and starts one more read — one at a time, at most every AUTH_REREAD_MS
   * after the last failed one, queued with the transitions so it never reads over a newer sign-in. A usable
   * sign-in found is announced as `sign-in` with its own epoch (the tabs and pages heard nobody was signed in).
   * A record that read but did not parse is not read again: it would read the same.
   */
  private readAgainSoon(): void {
    const failedAt = this.readFailedAt;
    if (failedAt === null || this.rereading || this.deps.clock.monotonic() - failedAt < AUTH_REREAD_MS) return;
    this.rereading = true;
    void this.transition(async () => {
      // A sign-in or a sign-out that ran meanwhile made the custody readable: nothing to read.
      if (this.readable) return false;
      await this.read();
      if (!this.readable) return false;
      const session = this.session();
      this.deps.log('info', 'auth: sign-in read again', { state: this.state(), epoch: this.meta.epoch });
      if (session === null) return false;
      this.emit({ session, reason: 'sign-in', epoch: this.meta.epoch, code: null });
      return true;
    })
      .then((found) => (found ? this.deps.onReadAgain?.() : undefined))
      .catch(() => this.deps.log('error', 'auth: sign-in read again failed'))
      .finally(() => {
        this.rereading = false;
      });
  }

  /** The usable sign-in: present, readable, and issued by the hub the settings name. */
  current(): StoredAuth | null {
    return this.state() === 'bound' ? this.stored : null;
  }

  /** Any stored sign-in, the mismatched one included (sign-out revokes it at its own hub). */
  storedRecord(): StoredAuth | null {
    return this.stored;
  }

  epoch(): number {
    return this.meta.epoch;
  }

  session(): SessionIdentity | null {
    const stored = this.current();
    if (stored === null) return null;
    return { hubOrigin: stored.hubOrigin, userId: stored.user.userId, login: stored.user.login, role: stored.user.role, epoch: this.meta.epoch };
  }

  tokenMeta(): TokenMeta | null {
    return this.stored === null ? null : this.meta.token;
  }

  lastEnd(): LastEnd | null {
    return this.meta.lastEnd;
  }

  /** Aborted at the next transition: link every call of this sign-in to it. */
  epochSignal(): AbortSignal {
    return this.epochController.signal;
  }

  onChange(listener: (change: SessionChange) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** AU-009: sign-in, sign-out and wipes run one at a time, in order. */
  transition<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(work);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Inside a transition: writes token + origin + user + meta in ONE storage call (AU-006), then bumps the epoch. */
  async commitSignIn(input: { token: string; hubOrigin: string; user: StoredAuth['user']; narrow: boolean; tokenMeta: TokenMeta }): Promise<SessionIdentity> {
    const epoch = this.meta.epoch + 1;
    const stored: StoredAuth = { v: 1, token: input.token, hubOrigin: input.hubOrigin, user: input.user, epoch, narrow: input.narrow };
    const meta: AuthMeta = { v: 1, epoch, token: input.tokenMeta, lastEnd: null };
    const written = await this.deps.local.set({ [STORAGE_KEYS.authToken]: stored, [STORAGE_KEYS.authMeta]: meta });
    if (!written.ok) {
      // Nothing was kept (one atomic write): the caller revokes the issued token.
      this.deps.log('error', 'auth: sign-in write failed', { code: written.code });
      throw new AuthWriteError();
    }
    this.stored = stored;
    this.meta = meta;
    this.readable = true;
    this.endedByUnauthorized = null;
    this.knownOrigin = input.hubOrigin;
    this.bump();
    const session = this.session();
    this.emit({ session, reason: 'sign-in', epoch, code: null });
    this.deps.log('info', 'auth: signed in', { epoch, narrow: input.narrow });
    return { hubOrigin: stored.hubOrigin, userId: stored.user.userId, login: stored.user.login, role: stored.user.role, epoch };
  }

  /**
   * Inside a transition: erases the sign-in (memory first, then storage) and
   * bumps the epoch. A storage failure is logged; the sign-in is gone in
   * memory either way, and the next background start tries again.
   */
  async wipe(reason: EndReason, code: CgCode | null, endedBy: { readonly epoch: number; readonly token: string } | null = null): Promise<void> {
    const epoch = this.meta.epoch + 1;
    const hadSession = this.stored !== null || !this.readable;
    this.stored = null;
    this.endedByUnauthorized = endedBy;
    this.readable = true;
    this.meta = { v: 1, epoch, token: null, lastEnd: { reason, at: new Date(this.deps.clock.now()).toISOString(), code } };
    this.bump();
    const removed = await this.deps.local.remove([STORAGE_KEYS.authToken]);
    const metaWritten = await this.deps.local.set({ [STORAGE_KEYS.authMeta]: this.meta });
    if (!removed.ok || !metaWritten.ok) this.deps.log('error', 'auth: erase failed', { epoch });
    if (hadSession || reason === 'sign-out') {
      this.emit({ session: null, reason: reason === 'outdated' ? 'sign-out' : reason, epoch, code });
    }
    this.deps.log('info', 'auth: signed out', { epoch, reason });
  }

  /**
   * Inside a transition: the settings' hub address changed (§7: an automatic
   * cancel). When that turns the stored sign-in usable ↔ unusable (AU-016
   * bound ↔ mismatch), the epoch moves on — every operation under the old
   * address is cancelled — and `hub-changed` is announced with the session as
   * it now is. Nothing is erased: sign-out still revokes at the issuing hub,
   * and going back to that address makes the sign-in usable again. Returns
   * whether the epoch moved.
   */
  async hubOriginChanged(): Promise<boolean> {
    const origin = this.deps.configuredOrigin();
    const before = this.knownOrigin;
    this.knownOrigin = origin;
    if (before === origin || this.stored === null || !this.readable) return false;
    const wasBound = this.stored.hubOrigin === before;
    if (wasBound === (this.stored.hubOrigin === origin)) return false;
    const epoch = this.meta.epoch + 1;
    this.meta = { ...this.meta, epoch };
    this.bump();
    const written = await this.deps.local.set({ [STORAGE_KEYS.authMeta]: this.meta });
    if (!written.ok) this.deps.log('error', 'auth: epoch write failed', { code: written.code, epoch });
    this.emit({ session: this.session(), reason: 'hub-changed', epoch, code: null });
    this.deps.log('info', 'auth: hub address changed', { epoch, bound: !wasBound });
    return true;
  }

  /** Erases the storage key again, without a new epoch (sign-out step 3, AU-013). */
  async eraseAgain(): Promise<void> {
    const removed = await this.deps.local.remove([STORAGE_KEYS.authToken]);
    if (!removed.ok) this.deps.log('error', 'auth: second erase failed');
  }

  /**
   * A 401 reached a call of `epoch` with `token`. Only `token_revoked` /
   * `token_expired` of THIS token and THIS epoch wipe the sign-in (AU-010);
   * a 401 without a reason, a 403, or any answer to an older sign-in never
   * touch it (AU-011, AU-014). Returns whether a wipe was queued.
   */
  reportUnauthorized(epoch: number, token: string, reason: string | null): boolean {
    const end = reason !== null && Object.prototype.hasOwnProperty.call(UNAUTHORIZED_WIPE_REASONS, reason) ? UNAUTHORIZED_WIPE_REASONS[reason as keyof typeof UNAUTHORIZED_WIPE_REASONS] : null;
    if (end === null || !this.isCurrent(epoch, token)) return false;
    void this.transition(async () => {
      // Re-checked inside the queue: a sign-in may have run in between.
      if (!this.isCurrent(epoch, token)) return;
      await this.wipe(end, end === 'revoked' ? 'CG-AUTH-REVOKED' : 'CG-AUTH-EXPIRED', { epoch, token });
    });
    return true;
  }

  /**
   * The sign-in of `epoch`/`token` was the last one and a 401 with a reason
   * ended it, and nothing newer exists: its other calls still read their own
   * code instead of «an older sign-in» (AU-012: the stream's hook may wipe
   * before the stream's own failure is read).
   */
  endedByOwnUnauthorized(epoch: number, token: string): boolean {
    const ended = this.endedByUnauthorized;
    return ended !== null && ended.epoch === epoch && ended.token === token && this.stored === null && this.meta.epoch === epoch + 1;
  }

  isCurrent(epoch: number, token: string): boolean {
    return this.stored !== null && this.meta.epoch === epoch && this.stored.token === token;
  }

  private bump(): void {
    this.epochController.abort();
    this.epochController = new AbortController();
  }

  private emit(change: SessionChange): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch {
        this.deps.log('error', 'auth: a session listener threw');
      }
    }
  }
}
