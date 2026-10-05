// Running other programs and showing what would be run. Every outward step of
// a release is a list of Steps: `--dry-run` prints each step's `show` lines —
// the exact command lines and scripts — and runs nothing; a real run prints
// the same lines and then runs them. Secrets travel only in the environment of
// the one child that needs them and are shown by name, never by value.

import { spawn } from 'node:child_process';

export interface CommandSpec {
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  /** Fed to the child's stdin (a script for `sh -s`). */
  readonly stdin?: string;
  /** Extra environment for this child only. */
  readonly env?: Readonly<Record<string, string>>;
  /** Names of environment variables whose values must not be shown (they are passed through from this process). */
  readonly secretEnv?: readonly string[];
  /** Print the child's output as it comes instead of capturing it. */
  readonly inherit?: boolean;
}

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type Exec = (spec: CommandSpec) => Promise<CommandResult>;

export const realExec: Exec = (spec) =>
  new Promise((resolve, reject) => {
    const child = spawn(spec.program, [...spec.args], {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      stdio: [spec.stdin === undefined ? 'ignore' : 'pipe', spec.inherit === true ? 'inherit' : 'pipe', spec.inherit === true ? 'inherit' : 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (error) => reject(new Error(`${spec.program}: ${error.message}`)));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }));
    if (spec.stdin !== undefined) child.stdin?.end(spec.stdin);
  });

/** One argument as a POSIX shell would need it written. */
export function shellQuote(text: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`;
}

/** The command line as a person would type it; secret variables by name only. */
export function renderCommand(spec: CommandSpec): string[] {
  const env = [...Object.entries(spec.env ?? {}).map(([name, value]) => `${name}=${shellQuote(value)}`), ...(spec.secretEnv ?? []).map((name) => `${name}=<from the environment>`)];
  const line = [...env, spec.program, ...spec.args].map((part, index) => (index < env.length ? part : shellQuote(part))).join(' ');
  if (spec.stdin === undefined) return [`$ ${line}`];
  return [`$ ${line} <<'SCRIPT'`, ...spec.stdin.replace(/\n$/, '').split('\n').map((text) => `    ${text}`), '  SCRIPT'];
}

/** Runs a command that must succeed; on failure throws with what it printed. */
export async function mustRun(exec: Exec, spec: CommandSpec): Promise<CommandResult> {
  const result = await exec(spec);
  if (result.code !== 0) {
    const said = `${result.stderr}${result.stdout}`.trim().split('\n').slice(-12).join('\n');
    throw new Error(`${spec.program} ${spec.args[0] ?? ''} exited ${result.code}${said === '' ? '' : `:\n${said}`}`);
  }
  return result;
}

export interface Step {
  readonly title: string;
  /** Exactly what the step does, for `--dry-run` and for the log of a real run. */
  readonly show: readonly string[];
  readonly run: () => Promise<void>;
}

export type Print = (line: string) => void;

/** Prints every step; runs them in order unless `dryRun`. Stops at the first failure. */
export async function runSteps(steps: readonly Step[], options: { readonly dryRun: boolean; readonly print: Print }): Promise<void> {
  for (const [index, step] of steps.entries()) {
    options.print(`${options.dryRun ? '[dry-run] ' : ''}${index + 1}/${steps.length} ${step.title}`);
    for (const line of step.show) options.print(`    ${line}`);
    if (!options.dryRun) await step.run();
  }
}

/** A step that runs one command. */
export function commandStep(title: string, exec: Exec, spec: CommandSpec): Step {
  return { title, show: renderCommand(spec), run: async () => void (await mustRun(exec, spec)) };
}
