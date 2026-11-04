// The vault's album as the upload of a set reads and lays it out (2026-11-03; hub
// docs/plans/2026-10-23-wall-posts/fansly-publish-contract.md §13): the calls the background makes — the same as
// Fansly's own vault page — and how their answers are read. The calls go through the client like every other
// (FS-NET-1's `vault` row and the pacer): this module names them and reads one album to its end.
//
// - An album is its rows (`albumMedia[]`), the newest first: a row names its member (`mediaId`) and the member's name in
//   this album (`customFilename`); `media[]` names the members' own file names and what Fansly says of their content. A
//   page goes on from `before` = the last row's id, down to an empty page (the hub's walk of the same album,
//   sync/fansly/resources/catalog.ts).
// - What a medium's content is, as far as Fansly says it (`media[]`, seen on the hub's captures 2026-11-04): its `type`
//   (1 a photo, 2 a video), a photo's own `width`×`height` (kept as uploaded, up to 5712×7680 seen), a video's
//   `metadata.originalWidth`×`originalHeight` and `duration` in seconds (its `width`/`height` are of the transcoded
//   copy). No byte size and no hash: Fansly gives none.
// - A member added again (`POST /vault/albums/media`) loses its row and takes a new one on top, its name kept; the rows
//   of one request are made in its order. One request of the set in its upload order lays the album out exactly, with no
//   upload again, and asking it twice is harmless. A rename changes the member's name in this album only.
// - Every call goes through the model's tab (`via: 'tab'`), whatever «Fansly через вкладку» says: the page uploads the
//   files through its container's proxy, so the reads and writes of the same album leave from the same line.

import type { FanslyCall, FanslyClient } from './client';
import { FanslyApiError } from './errors';

/**
 * What Fansly says of a medium's content: `type` (1 a photo, 2 a video, another — something else); the original width
 * and height (a photo's own, a video's `originalWidth`/`originalHeight`); a video's duration in seconds. null — not said.
 */
export interface VaultMediaContent {
  readonly type: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly duration: number | null;
}

/** One row of an album, the newest first. */
export interface VaultAlbumRow {
  /** The row's own id: a member added again gets a new one. */
  readonly row: string;
  readonly mediaId: string;
  /** The name the album shows: the row's `customFilename`, else the medium's own file name; '' — none. */
  readonly name: string;
  /** What Fansly says of the member's content; null — the page named no medium for it. */
  readonly content: VaultMediaContent | null;
}

const FANSLY_ID = /^[1-9]\d{0,23}$/;
/** Pages one read of an album may take (the hub's walk of an album stops at 400). */
export const VAULT_ALBUM_MAX_PAGES = 400;
/** Members one request adds again: a set goes in requests of this many, in order — each later row lands on top. */
export const VAULT_ADD_CHUNK = 50;

export const vaultCalls = {
  /** One page of the album's rows, the newest first; `before` — the last row's id of the page before ('0' — the head). */
  page: (account: string, albumId: string, before: string): FanslyCall => ({
    purpose: 'vault',
    route: 'vault.albumMedia',
    account,
    query: { albumId, mediaType: '', search: '', before, after: '0' },
    via: 'tab',
  }),
  /** The members added (again) in this order: the last one ends on top. */
  add: (account: string, albumId: string, mediaIds: readonly string[]): FanslyCall => ({ purpose: 'vault', route: 'vault.addMedia', account, body: { albumId, mediaIds }, via: 'tab' }),
  rename: (account: string, albumId: string, mediaId: string, name: string): FanslyCall => ({
    purpose: 'vault',
    route: 'vault.renameMedia',
    account,
    body: { albumId, mediaId, customFilename: name },
    via: 'tab',
  }),
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const idOf = (value: unknown): string | null => (typeof value === 'string' && FANSLY_ID.test(value) ? value : typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : null);
const sideOf = (value: unknown): number | null => (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 100_000 ? value : null);
const secondsOf = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1e7 ? value : null);

/** A medium's `metadata`: a JSON string on Fansly's answers, an object on some. */
function metadataOf(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || value.length > 10_000) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** What a medium of `media[]` says of its content (the header of this file). */
export function vaultMediaContent(media: Record<string, unknown>): VaultMediaContent {
  const type = typeof media['type'] === 'number' && Number.isSafeInteger(media['type']) ? media['type'] : null;
  const meta = metadataOf(media['metadata']);
  // A video's own width and height are of the transcoded copy; the original's are in its metadata.
  if (type === 2) return { type, width: sideOf(meta['originalWidth']), height: sideOf(meta['originalHeight']), duration: secondsOf(meta['duration']) };
  return { type, width: sideOf(media['width']), height: sideOf(media['height']), duration: secondsOf(meta['duration']) };
}

/** One page of the album's rows, the newest first; null — not an answer of this album. */
export function vaultAlbumPage(response: unknown, albumId: string): VaultAlbumRow[] | null {
  if (!isRecord(response) || !Array.isArray(response['albumMedia'])) return null;
  const media = new Map<string, { readonly name: string; readonly content: VaultMediaContent }>();
  for (const item of Array.isArray(response['media']) ? response['media'] : []) {
    const id = isRecord(item) ? idOf(item['id']) : null;
    if (id !== null && isRecord(item)) media.set(id, { name: typeof item['filename'] === 'string' ? item['filename'] : '', content: vaultMediaContent(item) });
  }
  const rows: VaultAlbumRow[] = [];
  for (const item of response['albumMedia']) {
    if (!isRecord(item)) return null;
    const row = idOf(item['id']);
    const mediaId = idOf(item['mediaId']);
    if (row === null || mediaId === null) return null;
    // A row of another album is not this one's answer.
    if (item['albumId'] !== undefined && idOf(item['albumId']) !== albumId) return null;
    const own = typeof item['customFilename'] === 'string' ? item['customFilename'].trim() : '';
    const medium = media.get(mediaId);
    rows.push({ row, mediaId, name: own !== '' ? own : (medium?.name ?? '').trim(), content: medium?.content ?? null });
  }
  return rows;
}

/** The album's rows to its end, the newest first. A page of another form, a cursor that does not move, too many pages: malformed. */
export async function readVaultAlbum(client: Pick<FanslyClient, 'call'>, account: string, albumId: string, signal?: AbortSignal): Promise<VaultAlbumRow[]> {
  const rows: VaultAlbumRow[] = [];
  const seen = new Set<string>();
  let before = '0';
  for (let page = 0; page < VAULT_ALBUM_MAX_PAGES; page += 1) {
    const answer = await client.call({ ...vaultCalls.page(account, albumId, before), ...(signal === undefined ? {} : { signal }) });
    const got = vaultAlbumPage(answer.response, albumId);
    if (got === null) throw new FanslyApiError('malformed', { sent: true, httpStatus: answer.status });
    const last = got.at(-1);
    if (last === undefined) return rows;
    for (const row of got) {
      if (seen.has(row.row)) continue;
      seen.add(row.row);
      rows.push(row);
    }
    if (last.row === before) throw new FanslyApiError('malformed', { sent: true, httpStatus: answer.status });
    before = last.row;
  }
  throw new FanslyApiError('malformed', { sent: true });
}

/** Adds the members again in `mediaIds`' order, in requests of VAULT_ADD_CHUNK: the last one ends on top. */
export async function arrangeVaultAlbum(client: Pick<FanslyClient, 'call'>, account: string, albumId: string, mediaIds: readonly string[], signal?: AbortSignal): Promise<void> {
  for (let at = 0; at < mediaIds.length; at += VAULT_ADD_CHUNK) {
    await client.call({ ...vaultCalls.add(account, albumId, mediaIds.slice(at, at + VAULT_ADD_CHUNK)), ...(signal === undefined ? {} : { signal }) });
  }
}

/**
 * The member's name in this album: the name Fansly's answer says it kept (the album's row, `customFilename`); null — the
 * answer names none, so nothing says the name took.
 */
export async function renameVaultMember(client: Pick<FanslyClient, 'call'>, account: string, albumId: string, mediaId: string, name: string, signal?: AbortSignal): Promise<string | null> {
  const answer = await client.call({ ...vaultCalls.rename(account, albumId, mediaId, name), ...(signal === undefined ? {} : { signal }) });
  const kept = isRecord(answer.response) && typeof answer.response['customFilename'] === 'string' ? answer.response['customFilename'].trim() : '';
  return kept === '' ? null : kept;
}
