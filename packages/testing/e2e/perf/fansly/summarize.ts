// Reads the reports of perf runs (fansly-baseline.e2e.ts, one report.json per
// configuration and run) and prints the §4 metrics per configuration — the
// mean and the spread (min…max) over the runs — with the subject's numbers
// against the base (`none`) of the same neighbour setting, as
// docs/project-unite/baseline.md shows them (R20 P3d; P16a compares the new
// extension with them the same way).
//
//   pnpm --filter @cg/testing exec tsx e2e/perf/fansly/summarize.ts <evidence dir>… [--json <out>]
//
// An evidence dir is .cache/e2e/perf-fansly/<run>/ (or its parent: every run below it).

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { summarizeProfileFile, type ThreadSummary } from '../../../src/perf/gecko-profile';
import type { MemoryReading } from './memory';
import type { ScenarioReport } from './scenario';

type Report = ScenarioReport & { readonly run: string; readonly label: string };

const MB = 1024 * 1024;

function reportsUnder(dir: string): string[] {
  if (existsSync(join(dir, 'report.json'))) return [join(dir, 'report.json')];
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isDirectory())
    .flatMap(reportsUnder);
}

const explicitMB = (reading: MemoryReading | undefined): number => (reading?.tab?.explicit ?? Number.NaN) / MB;
const oursMB = (reading: MemoryReading | undefined): number => (reading?.tab?.ours ?? Number.NaN) / MB;
const eventPageMB = (reading: MemoryReading | undefined): number =>
  Object.entries(reading?.extension?.documents ?? {})
    .filter(([page]) => page.includes('background'))
    .reduce((sum, [, bytes]) => sum + bytes, 0) / MB;
const extensionDocsMB = (reading: MemoryReading | undefined): number => Object.values(reading?.extension?.documents ?? {}).reduce((sum, bytes) => sum + bytes, 0) / MB;
/** about:memory's extension process (by its name), with or without an add-on of the subject's in it. */
const extensionProcessMB = (reading: MemoryReading | undefined): number => (reading?.processes.find((process) => process.name.startsWith('extension'))?.explicit ?? Number.NaN) / MB;

/** Per-configuration values of a metric over the runs. */
interface Spread {
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  readonly n: number;
}

function spread(values: readonly number[]): Spread {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return { mean: Number.NaN, min: Number.NaN, max: Number.NaN, n: 0 };
  return { mean: finite.reduce((sum, value) => sum + value, 0) / finite.length, min: Math.min(...finite), max: Math.max(...finite), n: finite.length };
}

const fmt = (value: Spread, digits = 1): string =>
  value.n === 0 ? '—' : value.n === 1 || value.min === value.max ? value.mean.toFixed(digits) : `${value.mean.toFixed(digits)} (${value.min.toFixed(digits)}…${value.max.toFixed(digits)})`;

/** The add-on's timers that fired over a profiled phase; NaN — no profile of that thread. */
const timersOf = (thread: ThreadSummary | null | undefined): number => (thread === null || thread === undefined ? Number.NaN : Object.values(thread.addonTimers).reduce((sum, count) => sum + count, 0));

/** What one report says, as plain numbers. */
function metrics(report: Report): Record<string, number> {
  const rounds = report.roundReadings;
  const growth = rounds.slice(1).map((after, index) => explicitMB(after) - explicitMB(rounds[index]));
  const growthOurs = rounds.slice(1).map((after, index) => oursMB(after) - oursMB(rounds[index]));
  return {
    tabOpened: explicitMB(report.readings['opened']),
    tabWorked: explicitMB(report.readings['worked']),
    tabWindow: explicitMB(report.readings['window']),
    tabLastRound: explicitMB(rounds.at(-1)),
    oursWindow: oursMB(report.readings['window']),
    oursLastRound: oursMB(rounds.at(-1)),
    firstRoundGrowth: explicitMB(rounds[0]) - explicitMB(report.readings['window']),
    growthPerRoundMax: growth.length === 0 ? Number.NaN : Math.max(...growth),
    oursGrowthPerRoundMax: growthOurs.length === 0 ? Number.NaN : Math.max(...growthOurs),
    eventPageWindow: eventPageMB(report.readings['window']),
    eventPageLastRound: eventPageMB(rounds.at(-1)),
    extensionDocsLastRound: extensionDocsMB(rounds.at(-1)),
    extensionProcessWindow: extensionProcessMB(report.readings['window']),
    idleTabCpu: report.idle.tabCpuMs,
    idleExtensionCpu: report.idle.extensionCpuMs,
    idleAllCpu: report.idle.allCpuMs,
    idleTabAddonCpu: report.idle.profile?.tab?.addonCpuMs ?? Number.NaN,
    idleTabAddonWakeups: report.idle.profile?.tab?.addonWakeups ?? Number.NaN,
    idleExtAddonCpu: report.idle.profile?.extension?.addonCpuMs ?? Number.NaN,
    idleExtAddonWakeups: report.idle.profile?.extension?.addonWakeups ?? Number.NaN,
    idleTabNeighborCpu: report.idle.profile?.tab?.neighborCpuMs ?? Number.NaN,
    idleTabAwake: report.idle.profile?.tab?.markers['Awake'] ?? Number.NaN,
    idleExtAwake: report.idle.profile?.extension?.markers['Awake'] ?? Number.NaN,
    idleTabAddonTimers: timersOf(report.idle.profile?.tab),
    idleExtAddonTimers: timersOf(report.idle.profile?.extension),
    typingHandledP50: report.typing.plain.handled.p50,
    typingHandledP95: report.typing.plain.handled.p95,
    typingFrameP50: report.typing.plain.frame.p50,
    typingFrameP95: report.typing.plain.frame.p95,
    typingTabAddonCpu: report.typingProfile?.tab?.addonCpuMs ?? Number.NaN,
    switchP50: report.switchMs.p50,
    switchP95: report.switchMs.p95,
    egress: report.egress.length,
    idleSentMessages: report.idle.traffic.messages,
  };
}

const { values, positionals } = parseArgs({ allowPositionals: true, options: { json: { type: 'string' } } });
/** A report with its profile summaries read again from the profiles beside it (they are the evidence; the summary is derived). */
function load(file: string): Report {
  const report = JSON.parse(readFileSync(file, 'utf8')) as Report;
  const dir = file.slice(0, -'report.json'.length);
  const again = (name: string, reading: MemoryReading | undefined, durationMs: number) =>
    existsSync(`${dir}${name}`) && reading !== undefined ? summarizeProfileFile(`${dir}${name}`, { tab: reading.tab?.pid ?? null, extension: reading.extension?.pid ?? null }, report.addonHost, durationMs) : null;
  const idle = again('idle.json.gz', report.readings['window'], report.idle.ms);
  const typing = again('typing.json.gz', report.readings['worked'], 0);
  return { ...report, idle: { ...report.idle, profile: idle ?? report.idle.profile }, typingProfile: typing ?? report.typingProfile };
}
const reports = positionals.flatMap(reportsUnder).map(load);
if (reports.length === 0) {
  process.stderr.write('summarize: no report.json under the given directories\n');
  process.exit(1);
}

const byLabel = new Map<string, Report[]>();
for (const report of reports) byLabel.set(report.label, [...(byLabel.get(report.label) ?? []), report]);
const labels = [...byLabel.keys()].sort();
const table: Record<string, Record<string, Spread>> = {};
for (const label of labels) {
  const each = (byLabel.get(label) ?? []).map(metrics);
  const keys = Object.keys(each[0] ?? {});
  table[label] = Object.fromEntries(keys.map((key) => [key, spread(each.map((row) => row[key] ?? Number.NaN))]));
}

// Against the base of the same neighbour setting: each run's value less the base's mean.
const baseOf = (label: string): string => `none-${label.split('-').at(-1) ?? 'off'}`;
const deltas: Record<string, Record<string, Spread>> = {};
for (const label of labels.filter((each) => !each.startsWith('none-'))) {
  const base = table[baseOf(label)];
  if (base === undefined) continue;
  const each = (byLabel.get(label) ?? []).map(metrics);
  const delta = (key: string): Spread => spread(each.map((row) => (row[key] ?? Number.NaN) - (base[key]?.mean ?? Number.NaN)));
  deltas[label] = {
    tabOpened: delta('tabOpened'),
    tabWorked: delta('tabWorked'),
    tabWindow: delta('tabWindow'),
    tabLastRound: delta('tabLastRound'),
    growthPerRoundMax: delta('growthPerRoundMax'),
    idleTabCpu: delta('idleTabCpu'),
    idleAllCpu: delta('idleAllCpu'),
    typingHandledP95: delta('typingHandledP95'),
    typingFrameP95: delta('typingFrameP95'),
  };
}

const rows: Array<[string, string, (label: string) => string]> = [
  ['runs', '', (label) => String(byLabel.get(label)?.length ?? 0)],
  ['вкладка, МБ: открыта / после работы / окно 10 мин', 'explicit процесса вкладки после GC', (label) => [table[label]?.['tabOpened'], table[label]?.['tabWorked'], table[label]?.['tabWindow']].map((value) => (value === undefined ? '—' : fmt(value))).join(' / ')],
  ['вкладка, прирост к базе, МБ: открыта / после работы / окно', 'минус среднее базы с тем же соседом', (label) => (deltas[label] === undefined ? '—' : [deltas[label]['tabOpened'], deltas[label]['tabWorked'], deltas[label]['tabWindow']].map((value) => (value === undefined ? '—' : fmt(value))).join(' / '))],
  ['вкладка после 3 кругов, прирост к базе, МБ', '', (label) => (deltas[label]?.['tabLastRound'] === undefined ? '—' : fmt(deltas[label]['tabLastRound']))],
  ['реалмы расширения во вкладке, МБ: окно / после кругов', 'песочницы контент-скриптов', (label) => `${fmt(table[label]?.['oursWindow'] ?? spread([]))} / ${fmt(table[label]?.['oursLastRound'] ?? spread([]))}`],
  ['рост за круг (100 переключений + 20 оверлеев), МБ: макс. из кругов 2–3', 'explicit вкладки / реалмы расширения', (label) => `${fmt(table[label]?.['growthPerRoundMax'] ?? spread([]), 2)} / ${fmt(table[label]?.['oursGrowthPerRoundMax'] ?? spread([]), 2)}`],
  ['рост за круг к базе, МБ', 'минус рост базы с тем же соседом', (label) => (deltas[label]?.['growthPerRoundMax'] === undefined ? '—' : fmt(deltas[label]['growthPerRoundMax'], 2))],
  ['фон: страница фона, МБ: окно / после кругов', 'документ event page', (label) => `${fmt(table[label]?.['eventPageWindow'] ?? spread([]))} / ${fmt(table[label]?.['eventPageLastRound'] ?? spread([]))}`],
  ['процесс расширений, МБ (окно)', 'explicit всего процесса', (label) => fmt(table[label]?.['extensionProcessWindow'] ?? spread([]))],
  ['простой: CPU за 60 с, мс: вкладка / расширения / весь браузер', 'без профайлера', (label) => ['idleTabCpu', 'idleExtensionCpu', 'idleAllCpu'].map((key) => fmt(table[label]?.[key] ?? spread([]), 0)).join(' / ')],
  ['простой: код расширения за 60 с — CPU, мс / пробуждения: вкладка; фон', 'Firefox Profiler', (label) => `${fmt(table[label]?.['idleTabAddonCpu'] ?? spread([]), 0)} / ${fmt(table[label]?.['idleTabAddonWakeups'] ?? spread([]), 0)}; ${fmt(table[label]?.['idleExtAddonCpu'] ?? spread([]), 0)} / ${fmt(table[label]?.['idleExtAddonWakeups'] ?? spread([]), 0)}`],
  ['простой: пробуждения главного потока за 60 с: вкладка / процесс расширений', 'маркеры `Awake` профиля', (label) => `${fmt(table[label]?.['idleTabAwake'] ?? spread([]), 0)} / ${fmt(table[label]?.['idleExtAwake'] ?? spread([]), 0)}`],
  ['простой: сработало таймеров расширения за 60 с: вкладка / фон', 'маркеры `setTimeout callback` профиля', (label) => `${fmt(table[label]?.['idleTabAddonTimers'] ?? spread([]), 0)} / ${fmt(table[label]?.['idleExtAddonTimers'] ?? spread([]), 0)}`],
  ['ввод: обработка p50 / p95, мс', 'keydown → конец задачи', (label) => `${fmt(table[label]?.['typingHandledP50'] ?? spread([]), 2)} / ${fmt(table[label]?.['typingHandledP95'] ?? spread([]), 2)}`],
  ['ввод: до кадра p50 / p95, мс', 'keydown → следующий кадр', (label) => `${fmt(table[label]?.['typingFrameP50'] ?? spread([]), 2)} / ${fmt(table[label]?.['typingFrameP95'] ?? spread([]), 2)}`],
  ['ввод p95 к базе, мс: обработка / кадр', '', (label) => (deltas[label] === undefined ? '—' : `${fmt(deltas[label]['typingHandledP95'] ?? spread([]), 2)} / ${fmt(deltas[label]['typingFrameP95'] ?? spread([]), 2)}`)],
  ['переключение чата p50 / p95, мс', 'клик → чат открыт и у субъекта всё на месте', (label) => `${fmt(table[label]?.['switchP50'] ?? spread([]), 0)} / ${fmt(table[label]?.['switchP95'] ?? spread([]), 0)}`],
  ['запросы мимо стенда', 'приёмник egress', (label) => fmt(table[label]?.['egress'] ?? spread([]), 0)],
];

const header = `| Метрика | Как | ${labels.join(' | ')} |\n|---|---|${labels.map(() => '---').join('|')}|`;
const body = rows.map(([name, how, cell]) => `| ${name} | ${how} | ${labels.map(cell).join(' | ')} |`).join('\n');
process.stdout.write(`${header}\n${body}\n`);

// The add-on's timers of the idle minute, by handler (the first run of each configuration).
for (const label of labels) {
  const profile = byLabel.get(label)?.[0]?.idle.profile;
  for (const [where, thread] of [['вкладка', profile?.tab], ['фон', profile?.extension]] as const) {
    const timers = Object.entries(thread?.addonTimers ?? {});
    if (timers.length > 0) process.stdout.write(`\n${label}, ${where} — таймеры расширения за ${String(Math.round((profile?.durationMs ?? 0) / 1000))} с:\n${timers.map(([handler, count]) => `  ${String(count)} × ${handler}`).join('\n')}\n`);
  }
}
if (values.json !== undefined) writeFileSync(values.json, `${JSON.stringify({ table, deltas }, null, 2)}\n`);
