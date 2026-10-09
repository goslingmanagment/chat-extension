// The preview's own window (CS-030, decision X24; ui-design §4.16, §10): a
// fan the palette's «Онлайн» lists — ChatSpace already shows them online — is
// looked at here without opening the chat. The same pane as in Spenders: the
// hub's archive feed, «Чат не открыт, останется непрочитанным», the local
// draft, Reply · Fix · Hi · Ping, the result with «Отправить» (X8) and
// «Открыть и вставить», «Открыть чат» and ×. One column of the Spenders
// preview's width, the full height of ChatSpace's container, centred in it
// over a scrim like the palette it came from. Esc and × close it and the
// focus goes back where it was before the palette; J and K (← →) walk the
// list the palette showed. It renders `{ of: 'preview', from: 'palette' }`
// and nothing else: it never reads ChatSpace and never loads a chat.

import { type JSX } from 'preact';
import { useRef } from 'preact/hooks';

import { Dialog, OverlayLayer, useDispatch, useI18n, useView } from '../kit';
import { Preview } from '../spenders/preview/Preview';

export function PreviewWindow(): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const vm = useView({ of: 'preview', from: 'palette' }).value;
  const frameRef = useRef<HTMLDivElement>(null);
  const close = (): void => void dispatch(vm.close);
  return (
    <OverlayLayer>
      <Dialog
        open
        label={i18n.t('preview.label')}
        size="column"
        class="cg-pvw"
        onClose={close}
        // The feed takes the focus: J, K and the arrows are the preview's at once, and Enter presses nothing.
        initialFocus={() => frameRef.current?.querySelector<HTMLElement>('.cg-feed') ?? frameRef.current?.querySelector<HTMLElement>('.cg-pv__head .cg-btn:last-child') ?? null}
      >
        <div ref={frameRef} class="cg-pvw__frame">
          <Preview from="palette" />
        </div>
      </Dialog>
    </OverlayLayer>
  );
}

export const PREVIEW_WINDOW_CSS = `
.cg-pvw__frame { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.cg-pvw__frame > .cg-pv {
  flex: 1 1 auto; min-height: 0;
  overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin;
}
`;
