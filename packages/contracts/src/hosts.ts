// Sites of the extension (R20, docs/project-unite/architecture.md §1.2, §12):
// which hosts exist and which platform each one serves. Light: constants and
// types only, no zod — any world may import it. The one table the identity
// checks read (`TargetSchema`, `RouteStateSchema`); the host registry of the
// app (`apps/extension/src/hosts`) adds addresses, scripts and build fields,
// which never come here (a ChatSpace bundle carries no Fansly addresses).

export const HOST_KINDS = ['chatspace', 'fansly-web'] as const;
export type HostKind = (typeof HOST_KINDS)[number];

/**
 * The platform a host serves (1.15.0): ChatSpace — OnlyFans, fansly.com — Fansly. A chat of a host binds only to a
 * hub page of this platform. `ids.ts` types the values as `Platform`.
 */
export const HOST_PLATFORM = { chatspace: 'onlyfans', 'fansly-web': 'fansly' } as const satisfies Readonly<Record<HostKind, string>>;
