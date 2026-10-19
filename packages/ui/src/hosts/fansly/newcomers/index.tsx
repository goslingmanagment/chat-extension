// @cg/ui/hosts/fansly/newcomers — «Новые фоловеры» on Fansly (R20 P10a; X59; docs/project-unite/architecture.md §8.17;
// ui-design §3.12): a surface of Fansly's own for the shared view `newcomers` with its `pass`, mounted where the shared
// one mounts — the overlay of the window layer, through Fansly's own lazy entry `newcomers` (lazy/fansly/newcomers.ts).
// Its words are Fansly's pack, laid over the tab's I18n for this surface by `texts` (the composition passes core's
// `withFanslyNewcomersTexts`): ui imports no core. Only Fansly's chunk and the galleries import it.

import { useMemo } from 'preact/hooks';

import { type I18n } from '@cg/contracts/vm';

import { KitProvider, useKit, type StyleSource, type SurfaceDefinition } from '../../../kit';
import { NEWCOMERS_FRAME_STYLES } from '../../../newcomers/frame.css';
import { WINDOW_STYLES } from '../../../spenders/window';
import { FanslyNewcomersWindow } from './NewcomersWindow';
import { FANSLY_NEWCOMERS_CSS } from './styles';

export { FanslyNewcomersWindow, checkText, failureView, fanslyText, greetingStart, nextDraft } from './NewcomersWindow';
export { periodText } from '../../../newcomers/frame';

export const FANSLY_NEWCOMERS_STYLES: StyleSource = { id: 'cg-fansly-newcomers', css: FANSLY_NEWCOMERS_CSS };

/** What Fansly's `newcomers` chunk mounts: the window, its words laid over the tab's I18n by `texts`. */
export function fanslyNewcomersSurface(texts: (base: I18n) => I18n): SurfaceDefinition {
  function FanslyNewcomers() {
    const env = useKit();
    const base = env.deps.i18n;
    const scoped = useMemo(() => ({ ...env, deps: { ...env.deps, i18n: texts(base) } }), [env, base]);
    return (
      <KitProvider env={scoped}>
        <FanslyNewcomersWindow />
      </KitProvider>
    );
  }
  // The shared sheets — the menus' buttons (`ChoiceMenu`) and the window's frame — keep their ids: a page that has both carries each once.
  return { view: FanslyNewcomers, styles: [WINDOW_STYLES, NEWCOMERS_FRAME_STYLES, FANSLY_NEWCOMERS_STYLES] };
}
