// The vault's album as the upload of a set reads and lays it out (2026-11-03; hub
// docs/plans/2026-10-23-wall-posts/fansly-publish-contract.md §13): the calls the background makes — the same as
// Fansly's own vault page — and how their answers are read. The calls go through the client like every other
// (FS-NET-1's `vault` row and the pacer): this module names them and reads one album to its end.
//
// - An album is its rows (`albumMedia[]`), the newest first: a row names its member (`mediaId`) and the member's name in
//   this album (`customFilename`); `media[]` names the members' own file names. A page goes on from `before` = the last
//   row's id, down to an empty page (the hub's walk of the same album, sync/fansly/resources/catalog.ts).
// - A member added again (`POST /vault/albums/media`) loses its row and takes a new one on top, its name kept; the rows
//   of one request are made in its order. One request of the set in its upload order lays the album out exactly, with no
//   upload again, and asking it twice is harmless. A rename changes the member's name in this album only.

import type { FanslyCall, FanslyClient } from './client';
import { FanslyApiError } from './errors';

/** One row of an album, the newest first. */
export interface VaultAlbumRow {
  /** The row's own id: a member added again gets a new one. */
  readonly row: string;
  readonly mediaId: string;
  /** The name the album shows: the row's `customFilename`, else the medium's own file name; '' — none. */
  readonly name: string;
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
  }),
  /** The members added (again) in this order: the last one ends on top. */
  add: (account: string, albumId: string, mediaIds: readonly string[]): FanslyCall => ({ purpose: 'vault', route: 'vault.addMedia', account, body: { albumId, mediaIds } }),
  rename: (account: string, albumId: string, mediaId: string, name: string): FanslyCall => ({
    purpose: 'vault',
    route: 'vault.renameMedia',
    account,
    body: { albumId, mediaId, customFilename: name },
  }),
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const idOf = (value: unknown): string | null => (typeof value === 'string' && FANSLY_ID.test(value) ? value : typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : null);

/** One page of the album's rows, the newest first; null — not an answer of this album. */
export function vaultAlbumPage(response: unknown, albumId: string): VaultAlbumRow[] | null {
  if (!isRecord(response) || !Array.isArray(response['albumMedia'])) return null;
  const names = new Map<string, string>();
  for (const media of Array.isArray(response['media']) ? response['media'] : []) {
    const id = isRecord(media) ? idOf(media['id']) : null;
    if (id !== null && isRecord(media) && typeof media['filename'] === 'string') names.set(id, media['filename']);
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
    rows.push({ row, mediaId, name: own !== '' ? own : (names.get(mediaId) ?? '').trim() });
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

/** The member's name in this album; Fansly's answer names the name it kept, else the one asked. */
export async function renameVaultMember(client: Pick<FanslyClient, 'call'>, account: string, albumId: string, mediaId: string, name: string, signal?: AbortSignal): Promise<string> {
  const answer = await client.call({ ...vaultCalls.rename(account, albumId, mediaId, name), ...(signal === undefined ? {} : { signal }) });
  const kept = isRecord(answer.response) && typeof answer.response['customFilename'] === 'string' ? answer.response['customFilename'] : name;
  return kept;
}
