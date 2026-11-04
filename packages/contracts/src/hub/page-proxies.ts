// The proxies of the caller's Fansly pages, with their logins (hub `clientFanslyProxies`, capability
// `fansly-proxies-v1`; 2026-11-04, the owner: «очень важно чтобы все шло через прокси»). Firefox Multi-Account Containers
// puts a container's proxy only on requests that have a tab, and shows another add-on's proxy without its password, so
// the extension takes it from the hub and routes the rest itself. Credentials: the background keeps them to itself, they
// never reach a tab, a page, a log or diagnostics.
//
// The answer is open like every hub answer.

import * as z from 'zod/mini';

export const FanslyProxyRowSchema = z.object({
  pageLabel: z.string(),
  /** The Fansly account the proxy belongs to; null — the hub does not know it yet. */
  platformAccountId: z.nullable(z.string()),
  /** Open token; `socks5` is the one the extension routes through. */
  scheme: z.string(),
  host: z.string(),
  port: z.number(),
  username: z.nullable(z.string()),
  password: z.nullable(z.string()),
});
export type FanslyProxyRow = z.infer<typeof FanslyProxyRowSchema>;

export const FanslyProxiesSchema = z.object({ proxies: z.array(FanslyProxyRowSchema) });
export type FanslyProxies = z.infer<typeof FanslyProxiesSchema>;
