// Sites of the extension (R20, docs/project-unite/architecture.md §1.2, §12):
// which hosts exist and which platform each one serves. Light: constants and
// types only, no zod — any world may import it. The one table the identity
// checks read (`TargetSchema`, `RouteStateSchema`); the host registry of the
// app (`apps/extension/src/hosts`) adds addresses, scripts and build fields,
// which never come here (a ChatSpace bundle carries no Fansly addresses).

export const HOST_KINDS = ['chatspace', 'fansly-web', 'telegram-web'] as const;
export type HostKind = (typeof HOST_KINDS)[number];

/**
 * The platform a host serves (1.15.0): ChatSpace — OnlyFans, fansly.com — Fansly, Telegram Web A — Telegram (the
 * persona's own account). A chat of a host binds only to a hub page of this platform. `ids.ts` types the values as
 * `Platform`.
 */
export const HOST_PLATFORM = { chatspace: 'onlyfans', 'fansly-web': 'fansly', 'telegram-web': 'telegram' } as const satisfies Readonly<Record<HostKind, string>>;

/**
 * 1.21.0 (decision X48): how a host names itself as the observer of a send in the hub's record of who sent each
 * message (`clientSendAttributions` `source`). null — the host reports no sends. Chat Memory week 1: Fansly reports
 * as `fansly-extension`, each fact with its chat's group.
 */
export const HOST_SEND_ATTRIBUTION_SOURCE = { chatspace: 'chatspace-extension', 'fansly-web': 'fansly-extension', 'telegram-web': null } as const satisfies Readonly<Record<HostKind, string | null>>;

/**
 * How a host names itself in the hub's record of who wrote each note (`clientNoteAttributions` `source`). null — the
 * host has no notes of ours to report.
 */
export const HOST_NOTE_ATTRIBUTION_SOURCE = { chatspace: null, 'fansly-web': 'fansly-extension', 'telegram-web': null } as const satisfies Readonly<Record<HostKind, string | null>>;

/** Chat Memory week 2: how a person names a platform — «тот же ник на OnlyFans» of «Память». */
export const PLATFORM_TITLES: Readonly<Record<string, string>> = { onlyfans: 'OnlyFans', fansly: 'Fansly', telegram: 'Telegram' };

/** 2026-10-21 (the chatter's log file): how a person names the site — «ChatSpace чат 74001001». */
export const HOST_TITLES = { chatspace: 'ChatSpace', 'fansly-web': 'Fansly', 'telegram-web': 'Telegram' } as const satisfies Readonly<Record<HostKind, string>>;
