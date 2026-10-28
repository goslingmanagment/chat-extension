// What the Recap window, its cheat sheet and the old sheet say about a Recap besides its text: what it read
// («вся переписка (90 сообщений)»), who uses it, whether it reached the hub; and where the choice of the two takes the
// focus when it opens (AI-060).

import { type JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

import { type RecapPickerVM, type RecapViewVM } from '@cg/contracts/vm';

import { Button, Dot, Spinner, activeIn, focusQuietly, useDispatch, useI18n, useKit } from '../../kit';
import { Fact } from './shared';

type I18n = ReturnType<typeof useI18n>;

export function SavedFact({ saved }: { readonly saved: RecapViewVM['saved'] }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  switch (saved.s) {
    case 'not-applicable':
      return null;
    case 'saving':
      return (
        <Fact>
          <Spinner />
          {i18n.t('result.stage.saving')}
        </Fact>
      );
    case 'saved':
      // Nothing to say (2026-10-22: no toast either): the row stays for what needs a hand.
      return null;
    case 'failed':
      // The text stays shown and copyable; only the idempotent reference write repeats, never the AI — and the
      // row says so: «не сохранено в хаб», «Сохранить ещё раз», never a «Повторить» that reads as a new generation.
      return (
        <>
          <Fact>
            <Dot kind="danger" />
            <span>
              <span class="cg-fact__code">{`${i18n.t('common.errorSource', { code: saved.error.code })}:`}</span> {i18n.t('cg.recapSave.line')}
            </span>
          </Fact>
          <Button label={i18n.t('cg.recapSave.action')} size="sm" class="cg-fact__btn" tooltip={i18n.t('cg.recapSave.actionTooltip')} onClick={() => void dispatch(saved.retry)} />
        </>
      );
  }
}

/** What the Recap read, as the old client said it: «вся переписка (90 сообщений)» or «последние 300 — история длиннее». */
export function coverageLine(i18n: I18n, stamp: RecapViewVM['stamp']): string | null {
  const { coverage, served } = stamp;
  if (served !== null && coverage === 'complete') return i18n.plural('recap.coverage.whole', served);
  if (served !== null && coverage === 'partial') return i18n.t('recap.coverage.window', { n: served });
  // A cut whose size is not known is still said; «охват неизвестен» was a grey word to skip (2026-10-20).
  return coverage === 'partial' ? i18n.t('common.coverage.partial') : null;
}

/** «его учитывают Reply, Fix, Ping и Coach»; a reader unticked in this chat is left out (1.52.0): «…только Reply и Coach». */
export function usedBy(i18n: I18n, recap: RecapViewVM): string {
  const readers = recap.readers;
  if (readers === undefined) return i18n.t(recap.length === 'full' ? 'recap.usedBy.full' : 'recap.usedBy.short');
  const names = readers.map((feature) => i18n.t(`dock.action.${feature}`));
  if (names.length === 0) return i18n.t('recap.usedBy.off');
  if (names.length === 1) return i18n.t('recap.usedBy.one', { name: names[0] ?? '' });
  return i18n.t('recap.usedBy.some', { names: new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(names) });
}

/**
 * The saved recaps are still being read («Проверяю сохранённые Recap…») and a build can already be started:
 * the build buttons do not wait for that read. It only tells what is saved — and when the hub is slow to
 * reach it lasted 20 s on the first live check, with nothing to press meanwhile.
 */
export function checkingWithBuild(picker: RecapPickerVM): boolean {
  return picker.view.s === 'loading' && (picker.build.short.enabled || picker.build.full.enabled);
}

/**
 * Where the choice of the two puts the focus when it opens (⌘⇧S or the bar's button): «Собрать полностью», so Enter
 * builds the full Recap and never reaches the site's field, where it would send the draft (the old client focused its
 * «Полный» the same way). Only from the site's composer, the page or a root of ours — never from a field the person
 * types in. While the saved recaps are still read the group holds the focus — Enter builds nothing yet — and hands it
 * to the button once they are known, unless the person took the focus elsewhere meanwhile.
 */
export function usePickerFocus(take: boolean, checking: boolean): { readonly group: { current: HTMLDivElement | null }; readonly full: { current: HTMLButtonElement | null } } {
  const { deps, root } = useKit();
  const group = useRef<HTMLDivElement>(null);
  const full = useRef<HTMLButtonElement>(null);
  const wanted = useRef(take);
  const held = useRef(false);
  useLayoutEffect(() => {
    if (!wanted.current || group.current === null) return;
    // After the group took it, only a focus still on the group moves on.
    if (held.current && activeIn(root) !== group.current) {
      wanted.current = false;
      return;
    }
    if (!held.current) {
      const where = deps.focus.where?.();
      const idle = where === 'composer' || where === 'none' || where === 'page' || (where === 'ours' && activeIn(root) !== null);
      if (!idle) {
        wanted.current = false;
        return;
      }
    }
    if (checking) {
      if (!held.current) held.current = focusQuietly(group.current);
      return;
    }
    focusQuietly(full.current ?? group.current);
    wanted.current = false;
  });
  return { group, full };
}
