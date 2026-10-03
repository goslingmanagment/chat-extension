// Persona catalog (AU-026…AU-028): metadata only (`aiPersonaCatalog`), never
// prompt text — full personas are a forbidden route. Cached for the sign-in
// it was read under, in memory and in `cache.catalog`; refreshed at start,
// every 5 min, at sign-in, on «Проверить связь», and whenever the hub says
// a persona changed (409 or a foreign `meta`). An assignment keeps a
// reference (`key` + `definitionId`), never a body.

import {
  CountSchema,
  HubIntIdSchema,
  HubOriginSchema,
  PersonaCatalogSchema,
  STORAGE_KEYS,
  type HubClientCheck,
  type PersonaCatalog,
} from '@cg/contracts';
import * as z from 'zod/mini';

import { type Connection, type HubContext } from './context';
import { toError } from './errors';
import { elapsedSince, stampNow, type HubKeyValueStore } from './ports';

/** AU-027: «раз в 5 мин». */
export const CATALOG_TTL_MS = 5 * 60_000;

interface CatalogEntry {
  readonly catalog: PersonaCatalog;
  /** Wall (stored) and monotonic (this background only, HB-008) stamps of the fetch. */
  readonly fetchedAt: number;
  readonly fetchedMono?: number;
  readonly epoch: number;
  readonly hubOrigin: string;
  readonly userId: number;
}

const CatalogCacheSchema = z.strictObject({
  v: z.literal(1),
  catalog: PersonaCatalogSchema,
  fetchedAt: CountSchema,
  epoch: CountSchema,
  hubOrigin: HubOriginSchema,
  userId: HubIntIdSchema,
});

/** AU-028: what a cached catalog says about a persona reference, before a stream or a write. */
export type PersonaVerdict = { readonly ok: true } | { readonly ok: false; readonly check: Extract<HubClientCheck, 'catalogEmpty' | 'personaUnavailable' | 'personaChangedInMeta'> };

export class CatalogService {
  private entry: CatalogEntry | null = null;
  private inFlight: { readonly epoch: number; readonly promise: Promise<PersonaCatalog> } | null = null;
  private timer: unknown = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly ctx: HubContext,
    private readonly local: HubKeyValueStore,
  ) {}

  cached(): PersonaCatalog | null {
    const entry = this.entry;
    const session = this.ctx.custody.session();
    if (entry === null || session === null || entry.epoch !== session.epoch || entry.hubOrigin !== session.hubOrigin || entry.userId !== session.userId) return null;
    return entry.catalog;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async get(force = false): Promise<PersonaCatalog> {
    const cached = this.cached();
    if (!force && cached !== null && this.entry !== null && elapsedSince(this.ctx.clock, { at: this.entry.fetchedAt, mono: this.entry.fetchedMono }) < CATALOG_TTL_MS) return cached;
    return this.refresh();
  }

  refresh(): Promise<PersonaCatalog> {
    let connection: Connection;
    try {
      connection = this.ctx.connection('aiPersonaCatalog');
    } catch (error) {
      return Promise.reject(toError(error));
    }
    if (this.inFlight !== null && this.inFlight.epoch === connection.epoch) return this.inFlight.promise;
    const promise = (this.ctx.sdk('aiPersonaCatalog', {}, {}, connection) as Promise<PersonaCatalog>)
      .then((catalog) => {
        if (this.ctx.isCurrent(connection)) this.adopt(catalog, connection);
        return catalog;
      })
      .finally(() => {
        if (this.inFlight?.promise === promise) this.inFlight = null;
        // AU-027: «раз в 5 мин» while this sign-in lasts, after a success or a failure alike.
        if (this.ctx.isCurrent(connection)) this.schedule();
      });
    this.inFlight = { epoch: connection.epoch, promise };
    return promise;
  }

  private schedule(): void {
    this.cancelTimer();
    this.timer = this.ctx.clock.setTimeout(() => {
      this.timer = null;
      this.refresh().catch(() => undefined);
    }, CATALOG_TTL_MS);
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.ctx.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.cancelTimer();
  }

  /** A persona changed on the hub: read the catalog again in the background (AI-140). */
  invalidate(): void {
    this.entry = this.entry === null ? null : { ...this.entry, fetchedAt: Number.NEGATIVE_INFINITY };
    this.refresh().catch(() => undefined);
  }

  /**
   * AU-028 against the cached catalog only (no read on the hot path): the key
   * must be an active persona of the catalog with the same definition. With
   * no cached catalog the hub's own 409 is the check.
   */
  verify(personaKey: string, definitionId: string | undefined): PersonaVerdict {
    const catalog = this.cached();
    if (catalog === null) return { ok: true };
    if (catalog.personas.length === 0) return { ok: false, check: 'catalogEmpty' };
    const persona = catalog.personas.find((candidate) => candidate.key === personaKey && candidate.status === 'active');
    if (persona === undefined) return { ok: false, check: 'personaUnavailable' };
    if (definitionId !== undefined && persona.definitionId !== definitionId) return { ok: false, check: 'personaChangedInMeta' };
    return { ok: true };
  }

  reset(): void {
    this.cancelTimer();
    this.entry = null;
    this.inFlight = null;
  }

  async clearStored(): Promise<void> {
    const removed = await this.local.remove([STORAGE_KEYS.cacheCatalog]);
    if (!removed.ok) this.ctx.log('warn', 'hub: catalog cache erase failed', { code: removed.code });
  }

  async loadStored(): Promise<void> {
    const read = await this.local.get([STORAGE_KEYS.cacheCatalog]);
    if (!read.ok) {
      this.ctx.log('warn', 'hub: catalog cache read failed', { code: read.code });
      return;
    }
    const parsed = CatalogCacheSchema.safeParse(read.value[STORAGE_KEYS.cacheCatalog]);
    if (!parsed.success) return;
    const { v: _v, ...entry } = parsed.data;
    this.entry = entry;
    if (this.cached() === null) this.entry = null;
  }

  private adopt(catalog: PersonaCatalog, connection: Connection): void {
    const previous = this.entry?.catalog ?? null;
    const { at, mono } = stampNow(this.ctx.clock);
    this.entry = { catalog, fetchedAt: at, fetchedMono: mono, epoch: connection.epoch, hubOrigin: connection.hubOrigin, userId: connection.userId };
    const { fetchedMono: _mono, ...stored } = this.entry;
    void this.local.set({ [STORAGE_KEYS.cacheCatalog]: { v: 1, ...stored } }).then((written) => {
      if (!written.ok) this.ctx.log('warn', 'hub: catalog cache write failed', { code: written.code });
    });
    if (previous === null || JSON.stringify(previous) !== JSON.stringify(catalog)) {
      for (const listener of [...this.listeners]) listener();
    }
  }
}
