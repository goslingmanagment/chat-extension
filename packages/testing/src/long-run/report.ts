// R20 P16b. Pure, fail-closed acceptance of the manual run; no browser imports.
export const DEFAULT_MINUTES = 60;
export const MAX_MINUTES = 120;
export const ACCELERATION_FACTOR = 8;
export const EVENT_TIMING = {
  trafficMs: 10_000 / ACCELERATION_FACTOR,
  wakeMs: 15 * 60_000 / ACCELERATION_FACTOR,
  workMs: 30 * 60_000 / ACCELERATION_FACTOR,
  navigationPauseMs: 15_000 / ACCELERATION_FACTOR,
} as const;
export const CHAT_COUNT = 320;
export const LIMITS = {
  tabOverheadMB: 15,
  backgroundMB: 30,
  growthMB: 5,
  idleCpuMsPerMinute: 500,
  idleTimersPerMinute: 0,
} as const;

/** P3d, docs/project-unite/baseline.md: neighbour on, notes by button (minimum of its two runs). */
export const OLD_BASELINE = {
  source: 'docs/project-unite/baseline.md',
  tabTimersPerMinute: 328,
  backgroundTimersPerMinute: 7,
  tabCpuMsPerMinute: 210,
  backgroundCpuMsPerMinute: 833,
  backgroundWakeupsPerMinute: 10_439,
} as const;

export function longRunMinutes(text: string | undefined): number {
  if (text === undefined || text === '') return DEFAULT_MINUTES;
  if (!/^[0-9]{1,3}$/.test(text) || Number(text) < 5 || Number(text) > MAX_MINUTES) {
    throw new Error('CG_LONG_RUN_MINUTES: целое число от 5 до 120 (по умолчанию 60, ускорение ×8)');
  }
  return Number(text);
}

export const REQUIRED_ACTIONS = ['reload', 'accountSwitch', 'backgroundWake', 'newcomers', 'greeting', 'vault', 'notes', 'admission'] as const;
export type Action = (typeof REQUIRED_ACTIONS)[number];
export interface MemorySample {
  readonly atMs: number;
  readonly epoch: number;
  /** Full tab process explicit, minus the simultaneous browser without the add-on, after GC. */
  readonly fanslyOverheadMB: number | null;
  readonly chatspaceOverheadMB: number | null;
  readonly backgroundMB: number | null;
}
export interface IdleSample {
  readonly atMs: number;
  readonly cpuWindowMs: number;
  readonly profileWindowMs: number;
  /** CPU delta WITHOUT the profiler; subtract the simultaneous baseline and clamp at zero. */
  readonly tabCpuMs: number | null;
  readonly baselineTabCpuMs: number | null;
  readonly backgroundCpuMs: number | null;
  readonly baselineBackgroundCpuMs: number | null;
  readonly tabTimers: number | null;
  readonly backgroundTimers: number | null;
  readonly backgroundWakeups: number | null;
}
export interface SendEvidence {
  readonly seq: number;
  readonly requestId: string | null;
  readonly groupId: string | null;
  readonly messageId: string | null;
}
export interface RunEvidence {
  readonly minutes: number;
  readonly elapsedMs: number;
  readonly finished: boolean;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly chatsWithEvents: number;
  readonly messages: number;
  readonly typing: number;
  readonly actions: Readonly<Partial<Record<Action, number>>>;
  readonly memory: readonly MemorySample[];
  readonly idle: readonly IdleSample[];
  readonly expectedSends: number;
  readonly sends: readonly SendEvidence[];
  readonly stuckOps: number;
  readonly leakedSlots: number;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

const round = (value: number): number => Math.round(value * 100) / 100;
const finite = (value: number | null): value is number => value !== null && Number.isFinite(value);

function growth(samples: readonly MemorySample[], key: 'fanslyOverheadMB' | 'chatspaceOverheadMB' | 'backgroundMB'): number | null {
  const first = new Map<number, number>();
  const counts = new Map<number, number>();
  let largest = 0;
  if (samples.some((sample) => !finite(sample[key]))) return null;
  for (const sample of samples) {
    const value = sample[key];
    if (!finite(value)) return null;
    const start = first.get(sample.epoch);
    counts.set(sample.epoch, (counts.get(sample.epoch) ?? 0) + 1);
    if (start === undefined) first.set(sample.epoch, value);
    else largest = Math.max(largest, value - start);
  }
  return [...counts.values()].some((count) => count < 2) ? null : round(largest);
}

export function buildLongRunReport(evidence: RunEvidence) {
  const checks: Array<{ name: string; passed: boolean; actual: unknown; limit: unknown }> = [];
  const check = (name: string, passed: boolean, actual: unknown, limit: unknown): void => { checks.push({ name, passed, actual, limit }); };
  check('duration', evidence.finished && evidence.elapsedMs >= evidence.minutes * 60_000, round(evidence.elapsedMs / 60_000), evidence.minutes);
  check('320 chats with events', evidence.chatsWithEvents >= CHAT_COUNT && evidence.messages >= CHAT_COUNT && evidence.typing >= CHAT_COUNT,
    { chats: evidence.chatsWithEvents, messages: evidence.messages, typing: evidence.typing }, CHAT_COUNT);
  const expectedEvents = CHAT_COUNT + Math.floor(evidence.minutes * 60_000 / EVENT_TIMING.trafficMs);
  check('shift-equivalent traffic', evidence.messages >= expectedEvents && evidence.typing >= expectedEvents,
    { messages: evidence.messages, typing: evidence.typing }, expectedEvents);
  for (const action of REQUIRED_ACTIONS) check(action, (evidence.actions[action] ?? 0) > 0, evidence.actions[action] ?? 0, '>= 1');

  // A crashed browser, missing reporter, NaN and an empty series must never turn into zero memory/CPU.
  check('memory coverage', evidence.memory.length >= 2 && evidence.memory[0]?.atMs === 0 &&
    (evidence.memory.at(-1)?.atMs ?? 0) >= evidence.minutes * 60_000 - 60_000 &&
    evidence.memory.every((sample, index) => index === 0 || sample.atMs - (evidence.memory[index - 1]?.atMs ?? 0) <= 360_000),
  evidence.memory.map((sample) => sample.atMs), 'start, end and gaps <= 6 min');
  for (const key of ['fanslyOverheadMB', 'chatspaceOverheadMB', 'backgroundMB'] as const) {
    const values = evidence.memory.map((sample) => sample[key]);
    const valid = values.length >= 2 && values.every(finite);
    const max = valid ? Math.max(...values) : null;
    const limit = key === 'backgroundMB' ? LIMITS.backgroundMB : LIMITS.tabOverheadMB;
    check(key, max !== null && max <= limit, max === null ? null : round(max), limit);
    const delta = growth(evidence.memory, key);
    check(`${key} growth after warm-up`, valid && delta !== null && delta <= LIMITS.growthMB, delta, LIMITS.growthMB);
  }
  check('idle coverage', evidence.idle.length >= 2 && (evidence.idle[0]?.atMs ?? Infinity) <= 180_000 &&
    (evidence.idle.at(-1)?.atMs ?? 0) >= evidence.minutes * 60_000 - 90_000 &&
    evidence.idle.every((sample) => sample.cpuWindowMs >= 30_000 && sample.profileWindowMs >= 30_000),
    evidence.idle.length, '>= 2 windows, >= 30 s CPU + >= 30 s profile each');
  const idle = evidence.idle.map((sample, index) => {
    const cpuRate = (value: number | null, base: number | null): number | null => finite(value) && finite(base) && value >= 0 && base >= 0
      ? round(Math.max(0, value - base) * 60_000 / sample.cpuWindowMs) : null;
    const rate = (value: number | null): number | null => finite(value) && value >= 0 ? round(value * 60_000 / sample.profileWindowMs) : null;
    const tabCpu = cpuRate(sample.tabCpuMs, sample.baselineTabCpuMs);
    const bgCpu = cpuRate(sample.backgroundCpuMs, sample.baselineBackgroundCpuMs);
    for (const [name, value, old] of [['tab CPU', tabCpu, OLD_BASELINE.tabCpuMsPerMinute], ['background CPU', bgCpu, OLD_BASELINE.backgroundCpuMsPerMinute]] as const) {
      // The stand's own CPU is already subtracted. Compare with the old total, and with our own idle budget.
      const limit = Math.min(LIMITS.idleCpuMsPerMinute, old);
      check(`idle ${index + 1}: ${name}`, value !== null && value <= limit, value, limit);
    }
    for (const [name, value] of [['tab timers', rate(sample.tabTimers)], ['background timers', rate(sample.backgroundTimers)]] as const) {
      check(`idle ${index + 1}: ${name}`, value === LIMITS.idleTimersPerMinute, value, LIMITS.idleTimersPerMinute);
    }
    const wakeups = rate(sample.backgroundWakeups);
    check(`idle ${index + 1}: background wakeups`, wakeups !== null && wakeups <= OLD_BASELINE.backgroundWakeupsPerMinute, wakeups, OLD_BASELINE.backgroundWakeupsPerMinute);
    return { ...sample, perMinute: { tabCpu, backgroundCpu: bgCpu, tabTimers: rate(sample.tabTimers), backgroundTimers: rate(sample.backgroundTimers), backgroundWakeups: wakeups } };
  });

  // Count server-side effects too: the same fetch can be resent by Firefox (X41).
  const duplicateRequests = evidence.sends.length - new Set(evidence.sends.map((send) => send.requestId)).size;
  const duplicateRecipients = evidence.sends.length - new Set(evidence.sends.map((send) => send.groupId)).size;
  check('duplicate sends = 0', evidence.sends.every((send) => send.requestId !== null && send.groupId !== null && send.messageId !== null) &&
    duplicateRequests === 0 && duplicateRecipients === 0 && evidence.sends.length === evidence.expectedSends && evidence.expectedSends > 0,
  { posts: evidence.sends.length, expected: evidence.expectedSends, duplicateRequests, duplicateRecipients }, 0);
  check('stuck ops = 0', evidence.stuckOps === 0, evidence.stuckOps, 0);
  check('leaked admission slots = 0', evidence.leakedSlots === 0, evidence.leakedSlots, 0);
  check('unexpected errors = 0', evidence.errors.length === 0, evidence.errors, 0);
  const passed = checks.every((entry) => entry.passed);
  return {
    schemaVersion: 1,
    status: !evidence.finished ? 'incomplete' : !passed ? 'failed' : evidence.minutes < DEFAULT_MINUTES ? 'smoke-passed' : 'passed',
    pilotGate: false,
    accelerationFactor: ACCELERATION_FACTOR,
    eventMinutes: evidence.minutes * ACCELERATION_FACTOR,
    limits: LIMITS,
    oldBaseline: OLD_BASELINE,
    ...evidence,
    idle,
    checks,
  };
}

export function longRunSummary(report: ReturnType<typeof buildLongRunReport>): string {
  const failed = report.checks.filter((check) => !check.passed).map((check) => check.name);
  return [
    `# R20 P16b: ${report.status}`,
    '',
    `Длительность: ${round(report.elapsedMs / 60_000)} / ${report.minutes} мин. Чатов с событиями: ${report.chatsWithEvents}.`,
    `Сообщений: ${report.messages}; typing: ${report.typing}; отправок: ${report.sends.length} / ${report.expectedSends}.`,
    `Ускорение: ×${report.accelerationFactor}; объём событий: ${report.eventMinutes} мин смены.`,
    'Прогон — операция, не ворота пилота; P16b закрывается слиянием harness и job. Находки исправляются в пилоте.',
    `Проверок: ${report.checks.filter((check) => check.passed).length}/${report.checks.length}.`,
    ...(failed.length === 0 ? [] : [`Не прошли: ${failed.join(', ')}.`]),
    ...(report.warnings.length === 0 ? [] : [`Предупреждения: ${report.warnings.length} (см. JSON и журналы).`]),
    '',
    'Числа, пороги, SHA, сырые замеры и ограничения метода — report.json; журналы и профили — рядом.',
    '',
  ].join('\n');
}
