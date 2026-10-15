// Fixed loopback ports of the Fansly perf stand (R20 P3d). The old Fansly
// extension's test build carries the stand's addresses as constants (its API
// base, its socket host and its tab checks are compiled in, old-build/rules.ts),
// so the stand that measures it must listen where that build looks: wdio.conf.ts
// starts the stand and the fake hub on these ports when CG_E2E_PORTS names them
// (docs/project-unite/baseline.md «Как повторить»). Everything else of the stand keeps free ports.
//
// The fake hub's address is a setting of the old extension (its «Agency Hub»
// field), seeded before its first tab; its compiled-in default is pointed here
// too, so nothing of the old build can reach the production hub even unseeded.

export interface FanslyPerfPorts {
  /** The Fansly stand page: `http://localhost:<fansly>`. */
  readonly fansly: number;
  /** The fake Fansly's API: `http://localhost:<fanslyApi>/api/v1`. */
  readonly fanslyApi: number;
  /** The fake Fansly's socket: `ws://localhost:<fanslySocket>?v=3`. */
  readonly fanslySocket: number;
  /** The fake hub: `http://127.0.0.1:<hub>`. */
  readonly hub: number;
}

export const FANSLY_PERF_PORTS: FanslyPerfPorts = { fansly: 47110, fanslyApi: 47111, fanslySocket: 47112, hub: 47114 };

/** The value of CG_E2E_PORTS that puts the stand on FANSLY_PERF_PORTS. */
export const FANSLY_PERF_PORTS_ENV = JSON.stringify(FANSLY_PERF_PORTS);
