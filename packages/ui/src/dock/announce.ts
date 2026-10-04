// What the root's one polite live region says of a generation (ui-design
// §6.2): the stage it entered («Reply: пишет ответ»), that it is ready
// («Ответ готов: 3 части»), and of a countdown to a retry only its start
// («Повторить можно через 24 секунды») and its end («Можно повторить»). The
// streamed text is never read out piece by piece and no countdown is read
// second by second; an error is an alert of its own card.
//
// The dock sheet says it. The «Развернуть ↗» window shows the same operation
// again and stays quiet, so nothing is heard twice.

import { useEffect, useRef } from 'preact/hooks';

import { type CgErrorView } from '@cg/contracts/errors';
import { type ActionButtonVM, type I18n, type PhaseVM, type ResultVM } from '@cg/contracts/vm';

import { useAnnounce, useCountdown, useI18n, useNowFn } from '../kit';

const ELLIPSIS = /\s*(…|\.\.\.)\s*$/;

/** A stage as it is said after the action's name: «Пишет ответ…» → «Reply: пишет ответ». */
export function spokenStage(i18n: I18n, action: string, text: string): string {
  const stage = text.replace(ELLIPSIS, '');
  return i18n.t('result.announce.stage', { action, stage: stage.charAt(0).toLocaleLowerCase(i18n.language) + stage.slice(1) });
}

/** «Ответ готов: 3 части»; Hi adds how many variants there are to choose from. */
export function spokenReady(i18n: I18n, result: Pick<ResultVM, 'parts' | 'variants'>): string {
  if (result.variants === null) return i18n.plural('result.announce.ready', result.parts?.length ?? 0);
  // Variants are alternatives: the answer is one of them, of so many parts.
  return `${i18n.plural('result.announce.ready', result.variants[0]?.parts.length ?? 0)}. ${i18n.plural('result.meta.variants', result.variants.length)}`;
}

/**
 * Says each stage a running generation enters. `id` names the generation
 * (null — nothing runs here, or this view stays quiet): the same stage of a
 * new generation is said again.
 */
export function useStageAnnouncements(action: string, id: string | null, phase: PhaseVM | null): void {
  const i18n = useI18n();
  const announce = useAnnounce();
  const current = id === null ? null : (phase?.stages.find((stage) => stage.state === 'current') ?? null);
  const key = current === null ? null : `${id}|${current.id}`;
  useEffect(() => {
    if (current !== null) announce(spokenStage(i18n, action, i18n.text(current.label)));
  }, [key]);
}

/**
 * Says once that a generation is ready — only one this view saw running: a
 * result that was already there when the view appeared (a chat reopened, a
 * cached answer) is no news. `said` may answer null: nothing fits to say.
 */
export function useReadyAnnouncement(id: string | null, running: boolean, done: boolean, said: () => string | null): void {
  const announce = useAnnounce();
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (id !== null && running) {
      seen.current = id;
      return;
    }
    const text = id !== null && done && seen.current === id ? said() : null;
    seen.current = null;
    if (text !== null) announce(text);
  }, [id, running, done]);
}

export interface RetryAnnouncerProps {
  readonly error: CgErrorView | null;
  /** The card's recovery buttons: a countdown is «to a retry» when one of them waits for it. */
  readonly actions: readonly ActionButtonVM[];
}

/**
 * The countdown of an error card next to «Повторить» (ui-design §4.8): its
 * start and its end, nothing in between. The quota's «До обновления 17 ч
 * 39 мин» is not a retry and is not said. Renders nothing; a component of its
 * own so that only it follows the clock.
 */
export function RetryAnnouncer({ error, actions }: RetryAnnouncerProps): null {
  const i18n = useI18n();
  const announce = useAnnounce();
  const now = useNowFn();
  const waits = error !== null && error.code !== 'CG-QUOTA-DAILY' && actions.some((vm) => vm.reason?.id === 'wait-until' || !vm.enabled);
  const until = waits ? (error.retryAt ?? null) : null;
  const left = useCountdown(until, now);
  const counting = until !== null && left > 0;
  const started = useRef<number | null>(null);
  useEffect(() => {
    if (until === null) {
      started.current = null;
    } else if (counting && started.current !== until) {
      started.current = until;
      announce(i18n.plural('result.announce.retryIn', Math.ceil(left / 1000)));
    } else if (!counting && started.current === until) {
      started.current = null;
      announce(i18n.t('result.announce.canRetry'));
    }
  }, [until, counting]);
  return null;
}
