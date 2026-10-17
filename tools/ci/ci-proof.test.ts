import { describe, expect, it } from 'vitest';

import { findProof, lookup, type Api } from './ci-proof.ts';

const TREE = 'a'.repeat(40);
const REPO = 'goslingmanagment/chat-extension';
const REPO_ID = '1000';
const ENV = { GITHUB_EVENT_NAME: 'pull_request', GITHUB_RUN_ATTEMPT: '1', GITHUB_REPOSITORY: REPO, GITHUB_REPOSITORY_ID: REPO_ID, GITHUB_RUN_ID: '9' };

type Answers = Readonly<Record<string, unknown>>;
function api(answers: Answers, asked: string[] = []): Api {
  return (endpoint) => {
    asked.push(endpoint);
    if (!(endpoint in answers)) return Promise.reject(new Error(`unexpected ${endpoint}`));
    return Promise.resolve(answers[endpoint]);
  };
}
const listing = (artifacts: unknown[]): Answers => ({ [`repos/${REPO}/actions/artifacts?name=ci-proof-${TREE}&per_page=100`]: { artifacts } });
const artifact = (id: number, extra: Record<string, unknown> = {}) => ({ name: `ci-proof-${TREE}`, expired: false, workflow_run: { id, head_repository_id: 1000 }, ...extra });
const run = (id: number, extra: Record<string, unknown> = {}): Answers => ({
  [`repos/${REPO}/actions/runs/${id}`]: { path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success', head_repository: { id: 1000 }, ...extra },
});
const query = (answers: Answers, runId = '9') => findProof({ repo: REPO, repoId: REPO_ID, tree: TREE, runId, api: api(answers) });

describe('the proof that CI already passed a tree', () => {
  it('is a completed, successful ci.yml run of this repository that left the tree’s artifact', async () => {
    expect(await query({ ...listing([artifact(7)]), ...run(7) })).toBe('7');
  });

  it('is not an expired artifact, a fork’s, another name’s, this run’s own, or one of a run that failed, is unfinished or is another workflow', async () => {
    expect(await query({ ...listing([artifact(7, { expired: true })]), ...run(7) })).toBe('');
    expect(await query({ ...listing([artifact(7, { workflow_run: { id: 7, head_repository_id: 2000 } })]), ...run(7) })).toBe('');
    expect(await query({ ...listing([artifact(7, { name: `ci-proof-${'b'.repeat(40)}` })]), ...run(7) })).toBe('');
    expect(await query({ ...listing([artifact(9)]), ...run(9) }, '9')).toBe('');
    for (const extra of [{ conclusion: 'failure' }, { conclusion: 'cancelled' }, { status: 'in_progress', conclusion: null }, { path: '.github/workflows/perf.yml' }, { head_repository: { id: 2000 } }]) {
      expect(await query({ ...listing([artifact(7)]), ...run(7, extra) }), JSON.stringify(extra)).toBe('');
    }
  });

  it('takes the first artifact that holds, past ones that do not', async () => {
    expect(await query({ ...listing([artifact(7), artifact(8)]), ...run(7, { conclusion: 'failure' }), ...run(8) })).toBe('8');
  });

  it('is a miss on any API error, never a skip', async () => {
    expect(await findProof({ repo: REPO, repoId: REPO_ID, tree: TREE, runId: '9', api: () => Promise.reject(new Error('503')) })).toBe('');
    expect(await query(listing([artifact(7)]))).toBe('');
  });
});

describe('the lookup of a job', () => {
  it('asks on a first attempt of a PR or a push, for the checked-out tree', async () => {
    const asked: string[] = [];
    expect(await lookup(ENV, TREE, api({ ...listing([artifact(7)]), ...run(7) }, asked))).toEqual({ tree: TREE, provenBy: '7', why: `run 7 already passed tree ${TREE}` });
    expect(asked[0]).toBe(`repos/${REPO}/actions/artifacts?name=ci-proof-${TREE}&per_page=100`);
    expect((await lookup({ ...ENV, GITHUB_EVENT_NAME: 'push' }, TREE, api({ ...listing([artifact(7)]), ...run(7) }))).provenBy).toBe('7');
  });

  it('runs in full, without asking, on a manual run, a re-run, an unnamed tree or repository', async () => {
    const asked: string[] = [];
    const never = api({}, asked);
    for (const [env, tree] of [
      [{ ...ENV, GITHUB_EVENT_NAME: 'workflow_dispatch' }, TREE],
      [{ ...ENV, GITHUB_EVENT_NAME: '' }, TREE],
      [{ ...ENV, GITHUB_RUN_ATTEMPT: '2' }, TREE],
      [ENV, ''],
      [ENV, 'not-a-tree'],
      [{ ...ENV, GITHUB_REPOSITORY_ID: '' }, TREE],
    ] as const) {
      expect((await lookup(env, tree, never)).provenBy, JSON.stringify(env) + tree).toBe('');
    }
    expect(asked).toEqual([]);
  });
});
