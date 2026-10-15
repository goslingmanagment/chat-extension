// Fansly's AI policy (docs/project-unite/architecture.md §1.6, §3.1, §9.1; R20 P8b1): the proof of a start from
// MAIN's generation snapshot (`freshness`), the start's shared `proof` and, with P8b2 and P8c, the verdict and Hi's
// start proof. One chunk of Fansly's own build, loaded by Fansly's application half with the dock
// (composition/tab/hosts/fansly/app.ts); a ChatSpace tab never loads it — its policy rides in its `tab-app`.

export { createFanslyAi } from '@cg/core/application/hosts/fansly/ai';
