Deliberate package-graph violations for tests/lint-boundaries.test.ts. Every
import here breaks a rule of architecture.md §4; ESLint, tsc and the real
dependency-cruiser run ignore this folder.
