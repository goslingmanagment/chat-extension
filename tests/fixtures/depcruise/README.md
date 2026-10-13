Deliberate package-graph violations for tests/lint-boundaries.test.ts. The
imports here break the rules of architecture.md §4 and of the two sites'
graph (docs/project-unite/architecture.md §1.8) — but for the few a comment
calls allowed, which prove a rule lets its own site through. ESLint, tsc and
the real dependency-cruiser run ignore this folder.
