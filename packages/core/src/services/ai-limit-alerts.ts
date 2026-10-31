// `ai-limit-v1`: the alerts of the person's own daily AI limit (the owner's;
// Moscow day, all pages). A toast in every open tab when the spend reaches 80 %
// of it («low»), when it is spent and the AI takes from the team's shared pool
// («pool»), and when the pool is spent too («out»), once a Moscow day each —
// the day's marks live in storage.local, so a restarted browser does not say it
// again. The hub refuses by itself; this only warns ahead.

import { type AiLimitSnapshot } from '@cg/contracts';

import { aiLimitLevel } from '../domain/ai-limit';
import { NO_LOG, type IdSource, type KeyValueStore, type LogSink, type TabEventSink } from './ports';

export const AI_LIMIT_ALERTS_KEY = 'ai.limit.alerts';

export interface AiLimitAlertDeps {
  readonly ids: Pick<IdSource, 'uuid'>;
  readonly events: TabEventSink;
  readonly local?: KeyValueStore;
  readonly log?: LogSink;
  /** A tab is open to show the toast: with none, nothing is marked and the next snapshot says it. */
  readonly hasTabs?: () => boolean;
}

export interface AiLimitAlerts {
  /** Readiness step: the marks of today an earlier event page already left. */
  restore(): Promise<void>;
  /** A new snapshot of the limit (the hub's answer, a meta frame, a 429). */
  note(limit: AiLimitSnapshot): void;
  /** Sign-out, another person. */
  forget(): void;
}

interface Marks {
  /** The Moscow day the marks are of: its `resetsAt`. */
  readonly resetsAt: string;
  readonly low: boolean;
  /** Absent in the marks of 3.13.x (before the pool): false. */
  readonly pool: boolean;
  readonly out: boolean;
}

const RANK = { low: 1, pool: 2, out: 3 } as const;

function marksOf(value: unknown): Marks | null {
  if (typeof value !== 'object' || value === null) return null;
  const { resetsAt, low, pool, out } = value as Record<string, unknown>;
  return typeof resetsAt === 'string' && typeof low === 'boolean' && typeof out === 'boolean' ? { resetsAt, low, pool: pool === true, out } : null;
}

/** The highest level already said today (0 — none). */
function said(marks: Marks): number {
  return marks.out ? RANK.out : marks.pool ? RANK.pool : marks.low ? RANK.low : 0;
}

export function createAiLimitAlerts(deps: AiLimitAlertDeps): AiLimitAlerts {
  const log = deps.log ?? NO_LOG;
  let marks: Marks | null = null;

  const persist = (): void => {
    void deps.local?.set(AI_LIMIT_ALERTS_KEY, marks).catch(() => {
      log.write({ level: 'warn', scope: 'bg.aiLimit', msg: 'limit alert marks not saved', code: 'CG-STORAGE-WRITE' });
    });
  };

  return {
    async restore() {
      try {
        marks = marksOf(await deps.local?.get(AI_LIMIT_ALERTS_KEY));
      } catch {
        log.write({ level: 'warn', scope: 'bg.aiLimit', msg: 'limit alert marks unreadable, starting empty', code: 'CG-STORAGE-READ' });
      }
    },
    note(limit) {
      const level = aiLimitLevel(limit);
      if (level === null || level === 'ok' || limit.dailyLimitMicroUsd === null) return;
      const today: Marks = marks !== null && marks.resetsAt === limit.resetsAt ? marks : { resetsAt: limit.resetsAt, low: false, pool: false, out: false };
      // A higher level covers the lower ones: a spend that jumps past several says only the last.
      if (said(today) >= RANK[level]) return;
      // Read at the browser's start, before any tab is back: said when a tab asks for the limit.
      if (deps.hasTabs?.() === false) return;
      deps.events.emit(null, 'toast', {
        toast: {
          toastId: deps.ids.uuid(),
          kind: level === 'out' ? 'error' : 'warning',
          // A later toast takes the place of an earlier one still on screen.
          scope: 'ai.limit',
          fanLabel: null,
          aiLimit: {
            level,
            todayMicroUsd: limit.todayMicroUsd,
            dailyLimitMicroUsd: limit.dailyLimitMicroUsd,
            ...(limit.poolRemainingMicroUsd === null ? {} : { poolRemainingMicroUsd: limit.poolRemainingMicroUsd }),
          },
        },
      });
      marks = { resetsAt: today.resetsAt, low: true, pool: today.pool || RANK[level] >= RANK.pool, out: today.out || level === 'out' };
      persist();
      log.write({ level: 'info', scope: 'bg.aiLimit', msg: 'limit alert shown', fields: { level, todayMicroUsd: limit.todayMicroUsd, dailyLimitMicroUsd: limit.dailyLimitMicroUsd } });
    },
    forget() {
      marks = null;
      persist();
    },
  };
}
