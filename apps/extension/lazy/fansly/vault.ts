// The vault of a Fansly tab (docs/project-unite/architecture.md §3.1, §7.11, §7.21; FS-PERF-3; R20 P13b): its entry,
// panel and uploader, one chunk of Fansly's own build, loaded the first time the tab is on `/creator/vault`
// (composition/tab/hosts/fansly/app.ts) and never on a chat. A ChatSpace tab never loads it.

export { startFanslyVault } from '../../src/composition/tab/hosts/fansly/vault';
