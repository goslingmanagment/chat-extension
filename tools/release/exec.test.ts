import { describe, expect, it } from 'vitest';

import { commandStep, mustRun, realExec, renderCommand, runSteps, shellQuote, type CommandSpec, type Exec } from './exec.ts';

describe('running and showing commands', () => {
  it('shows a command as a person would type it; a secret variable by name, never by value', () => {
    expect(shellQuote('plain-1.2_3/a:b@c')).toBe('plain-1.2_3/a:b@c');
    expect(shellQuote("it's a path")).toBe("'it'\\''s a path'");
    const spec: CommandSpec = { program: 'web-ext', args: ['sign', '--source-dir', '/tmp/my build'], env: { NO_UPDATE_NOTIFIER: '1' }, secretEnv: ['WEB_EXT_API_SECRET'] };
    expect(renderCommand(spec)).toEqual(["$ NO_UPDATE_NOTIFIER=1 WEB_EXT_API_SECRET=<from the environment> web-ext sign --source-dir '/tmp/my build'"]);
    expect(renderCommand({ program: 'ssh', args: ['host', 'sh', '-s'], stdin: 'set -eu\nmv a b\n' })).toEqual(["$ ssh host sh -s <<'SCRIPT'", '    set -eu', '    mv a b', '  SCRIPT']);
  });

  it('a dry run prints every step and runs none; a real run stops at the first failure', async () => {
    const ran: string[] = [];
    const printed: string[] = [];
    const step = (title: string, fails = false) => ({
      title,
      show: [`do ${title}`],
      run: () => {
        ran.push(title);
        return fails ? Promise.reject(new Error(`${title} failed`)) : Promise.resolve();
      },
    });
    await runSteps([step('one'), step('two')], { dryRun: true, print: (line) => printed.push(line) });
    expect(ran).toEqual([]);
    expect(printed).toEqual(['[dry-run] 1/2 one', '    do one', '[dry-run] 2/2 two', '    do two']);

    await expect(runSteps([step('one'), step('two', true), step('three')], { dryRun: false, print: () => undefined })).rejects.toThrow('two failed');
    expect(ran).toEqual(['one', 'two']);
  });

  it('runs a real child: stdin in, output and exit code back; a failure carries what the child said', async () => {
    const result = await realExec({ program: 'sh', args: ['-s'], stdin: 'echo "from the script"\necho oops >&2\nexit 3\n' });
    expect(result).toEqual({ code: 3, stdout: 'from the script\n', stderr: 'oops\n' });
    expect(await realExec({ program: 'sh', args: ['-c', 'echo "$CG_TEST_VALUE"'], env: { CG_TEST_VALUE: 'from env' } })).toMatchObject({ code: 0, stdout: 'from env\n' });
    await expect(mustRun(realExec, { program: 'sh', args: ['-c', 'echo why >&2; exit 2'] })).rejects.toThrow(/sh -c exited 2:\nwhy/);
    await expect(realExec({ program: 'cg-no-such-program', args: [] })).rejects.toThrow(/cg-no-such-program/);
  });

  it('a command step shows its command and runs it through the given Exec', async () => {
    const seen: CommandSpec[] = [];
    const exec: Exec = (spec) => {
      seen.push(spec);
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    };
    const step = commandStep('Push the tag', exec, { program: 'git', args: ['push', 'origin', 'v0.1.0'] });
    expect(step.show).toEqual(['$ git push origin v0.1.0']);
    expect(seen).toEqual([]);
    await step.run();
    expect(seen.map((spec) => spec.args)).toEqual([['push', 'origin', 'v0.1.0']]);
  });
});
