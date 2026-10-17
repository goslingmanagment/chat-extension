// Has CI already passed this very tree? (.github/workflows/ci.yml, docs/release.md §2.)
//
// A green run of ci.yml leaves an artifact `ci-proof-<tree>` (the job «pnpm e2e» uploads it once `pnpm check` and
// every part of the suite have passed). Before its work, each job of a later run asks for the tree it checked out —
// on a PR GitHub's merge commit, on a push the pushed commit: when such a proof exists, the tree is the same to the
// last byte, workflow files included, and the job ends green without running again. Since 18.10 a PR runs no e2e, so
// only a full run on main leaves a proof, and a later run meets the same tree rarely (a revert to it); before, a PR
// marked ready after a green Draft and the push of its merge were 98 of 336 full runs in 13–16.10.
//
// Only a proof that holds counts: the artifact is not expired, it belongs to a completed, successful ci.yml run of
// this repository (not a fork's), and that run is not this one. Anything else — no token, an API error, a manual
// run (workflow_dispatch), a re-run (attempt 2 and later) — is a miss: the job runs in full. A miss costs time, never
// a check.
//
// Prints two lines for $GITHUB_OUTPUT, `tree=<sha>` and `proven_by=<run id or empty>`, and says why on stderr.

import { execFileSync } from 'node:child_process';

export const PROOF_PREFIX = 'ci-proof-';
export const WORKFLOW_PATH = '.github/workflows/ci.yml';

export type Api = (endpoint: string) => Promise<unknown>;

interface Artifact {
  readonly name?: string;
  readonly expired?: boolean;
  readonly workflow_run?: { readonly id?: number; readonly head_repository_id?: number };
}
interface Run {
  readonly path?: string;
  readonly status?: string;
  readonly conclusion?: string | null;
  readonly head_repository?: { readonly id?: number };
}

export interface ProofQuery {
  readonly repo: string;
  readonly repoId: string;
  readonly tree: string;
  readonly runId: string;
  readonly api: Api;
}

/** The id of a completed, successful ci.yml run of this repository that proved `tree`, or '' — also on any error. */
export async function findProof({ repo, repoId, tree, runId, api }: ProofQuery): Promise<string> {
  const name = `${PROOF_PREFIX}${tree}`;
  try {
    const listing = (await api(`repos/${repo}/actions/artifacts?name=${name}&per_page=100`)) as { artifacts?: Artifact[] };
    for (const artifact of listing.artifacts ?? []) {
      const id = artifact.workflow_run?.id;
      if (artifact.name !== name || artifact.expired !== false || String(artifact.workflow_run?.head_repository_id) !== repoId) continue;
      if (id === undefined || !Number.isSafeInteger(id) || id <= 0 || String(id) === runId) continue;
      const run = (await api(`repos/${repo}/actions/runs/${id}`)) as Run;
      if (run.path === WORKFLOW_PATH && run.status === 'completed' && run.conclusion === 'success' && String(run.head_repository?.id) === repoId) return String(id);
    }
  } catch {
    // Availability costs time only. No API error or token is printed.
  }
  return '';
}

/** GitHub's REST API over Node's own fetch: the PC's runners have no GitHub CLI. */
export function githubApi(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch): Api {
  return async (endpoint) => {
    const token = env['GH_TOKEN'] ?? '';
    if (token === '') throw new Error('GH_TOKEN is not set');
    const base = (env['GITHUB_API_URL'] || 'https://api.github.com').replace(/\/+$/, '');
    const response = await fetchImpl(`${base}/${endpoint}`, {
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'user-agent': 'chat-extension-ci', 'x-github-api-version': '2022-11-28' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`GitHub API answered ${response.status} for ${endpoint}`);
    return (await response.json()) as unknown;
  };
}

/** `tree` and `proven_by` for this job, with the reason; `tree` is '' only when git could not name it. */
export async function lookup(env: NodeJS.ProcessEnv, tree: string, api: Api): Promise<{ tree: string; provenBy: string; why: string }> {
  const miss = (why: string) => ({ tree, provenBy: '', why });
  if (!/^[0-9a-f]{40}$/.test(tree)) return miss('the checked-out tree has no name');
  const event = env['GITHUB_EVENT_NAME'] ?? '';
  if (event !== 'pull_request' && event !== 'push') return miss(`a ${event || 'manual'} run always runs in full`);
  if ((env['GITHUB_RUN_ATTEMPT'] ?? '1') !== '1') return miss('a re-run always runs in full');
  const repo = env['GITHUB_REPOSITORY'] ?? '';
  const repoId = env['GITHUB_REPOSITORY_ID'] ?? '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^\d+$/.test(repoId)) return miss('the repository is not named');
  const provenBy = await findProof({ repo, repoId, tree, runId: env['GITHUB_RUN_ID'] ?? '', api });
  return provenBy === '' ? miss(`no green run has tree ${tree} yet`) : { tree, provenBy, why: `run ${provenBy} already passed tree ${tree}` };
}

if (import.meta.main) {
  let tree = '';
  try {
    tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
  } catch {
    // An unnamed tree is a miss.
  }
  const result = await lookup(process.env, tree, githubApi(process.env));
  console.error(`ci-proof: ${result.why}`);
  console.log(`tree=${result.tree}\nproven_by=${result.provenBy}`);
}
