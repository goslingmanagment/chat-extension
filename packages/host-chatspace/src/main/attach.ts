// A file of ours into the open chat's composer (1.47.0, voice notes; contracts TO_MAIN.attachFile,
// HostPort.attachFile): MAIN's fourth write (D-07, §6.10). ChatSpace keeps no file input in its DOM — «Attach media»
// opens a detached one — but the root of its composer frame is a drop zone (VueUse `useDropZone`): a drop whose items
// hold a file gives the page its `files`, and the page uploads them its own way (its vault upload, then a medium of the
// draft and its tile), as when the person drops a file there. The drop is built in the page's own world: a
// DataTransfer of the content script's world passes the zone's «a file?» check and hands the page an empty `files`
// (Firefox filters a copy-mode DataTransfer by principal). It goes out once, on the frame root of the open chat's
// composer — never into `.ProseMirror` —, in the same synchronous step as the checks: the chat, document and composer
// asked for, the role's upload right («Media uploader»), no attach of ours still open. What the draft holds already (an
// audio, a GIF, 40 media) the isolated side reads in the chat's draft key before it asks: MAIN reads no page storage.
// Nothing is sent: the person sends the message with ChatSpace's own Send.
//
// What became of it is read narrowly, for that one attempt: an observer on the composer frame (never on body), no
// timer reading the DOM. What the page puts into the frame for the drop before the next frame is its upload of our
// file (the uploading tile). Once all of that is gone, a node the page put into the frame at the same step (the
// medium's tile) is `attached`; none — `not-attached`: the upload failed, or the person canceled it. Nothing gone
// within ATTACH_WATCH_MS — while the upload is still on view, up to ATTACH_WATCH_MAX_MS — is `unknown`: the composer
// is the person's to check. The isolated side checks every outcome against the chat's draft key. Never a second drop
// for one request: the boot answers a repeated request id with the first answer (WRITE_REQUESTS), a used intent is
// refused, an `unknown` is final.

import { type Guard } from '@cg/host-kit/main/guard';
import { type Plain } from '@cg/host-kit/main/check';
import { type Composer } from './composer';
import { type AttachWire, type Identity } from './requests';
import { ATTACH_WATCH_MAX_MS, ATTACH_WATCH_MS, FRAME_SELECTOR, PERMISSIONS_UPLOAD } from './protocol';

/** What an attach takes of the boot and the runtime. */
export interface AttachHost {
  readonly win: Window;
  readonly now: () => number;
  readonly setTimer: (callback: () => void, ms: number) => unknown;
  readonly frame: (callback: () => void) => void;
  readonly guard: Guard;
  /** The open chat's composer an identity names (runtime.ts `composerOf`); null — another chat, document or composer. */
  readonly composerOf: (expected: Identity) => Composer | null;
  /** The composer's `.ProseMirror`: the person's typing there is no answer of the page to the drop. */
  readonly editorOf: (composer: Composer) => Element | null;
  /** ChatSpace's `["userPermissions"]` as it holds it: the role's permissions. */
  readonly permissions: () => unknown;
}

type Page = Window & typeof globalThis;
const refused = (reason: 'identity' | 'cause' | 'anchor-missing' | 'busy' | 'permission'): Plain => ({ state: 'refused', reason });

export function createAttach(host: AttachHost) {
  const { guard } = host;
  const page = host.win as Page;
  /** Intents seen: one drop per intent, whatever the request id. */
  const used = new Set<string>();
  /** The end of the attempt in progress: one at a time. */
  let open: ((answer: Plain) => void) | null = null;

  return {
    attach(wire: AttachWire): Plain | Promise<Plain> {
      if (used.has(wire.intentId)) return refused('cause');
      used.add(wire.intentId);
      if (open) return refused('busy');
      const composer = host.composerOf(wire.expected);
      if (!composer) return refused('identity');
      const frame = composer.slot.closest(FRAME_SELECTOR);
      const root = frame?.parentElement;
      const permissions = host.permissions();
      if (!frame || !root || !Array.isArray(permissions)) return refused('anchor-missing');
      if (!PERMISSIONS_UPLOAD.some((name) => permissions.includes(name))) return refused('permission');
      let drop: Event;
      try {
        const data = new page.DataTransfer();
        data.items.add(new page.File([wire.file.bytes], wire.file.name, { type: wire.file.type }));
        drop = new page.DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data });
      } catch {
        return refused('anchor-missing');
      }

      const editor = host.editorOf(composer);
      const started = host.now();
      /** What the page put into the frame for the drop, before the next frame: its upload of our file. */
      const upload: Element[] = [];
      let taking = true;
      let resolve: (answer: Plain) => void = () => undefined;
      const done = new Promise<Plain>((settle) => (resolve = settle));
      const shown = (node: Node): boolean => node.isConnected && frame.contains(node);
      const end = (answer: Plain): void => {
        if (open !== end) return;
        open = null;
        watcher.disconnect();
        resolve(answer);
      };
      /** The upload gone from the frame: a node the page put in at the same step — the medium's tile — is our file taken. */
      const judge = (placed: readonly Element[]): void => {
        if (taking || upload.length === 0 || upload.some(shown)) return;
        end(placed.some(shown) ? { state: 'attached', ms: Math.max(0, host.now() - started) } : { state: 'not-attached', reason: 'site-refused' });
      };
      const watcher = new page.MutationObserver(
        guard('attachWatch', (records: MutationRecord[]) => {
          const placed: Element[] = [];
          for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1 && !editor?.contains(node)) placed.push(node as Element);
          if (taking) upload.push(...placed);
          else judge(placed);
        }),
      );
      /** `last` — ATTACH_WATCH_MAX_MS; before it, an upload still on view has its outcome still to come. */
      const deadline = (last: boolean): void => {
        if (open !== end) return;
        // The frame itself may have gone (the composer unmounted, its upload with it): no mutation inside said so.
        judge([]);
        if (open !== end) return;
        if (!last && upload.some(shown)) return void host.setTimer(() => deadline(true), ATTACH_WATCH_MAX_MS - ATTACH_WATCH_MS);
        end({ state: 'unknown' });
      };

      watcher.observe(frame, { childList: true, subtree: true });
      open = end;
      root.dispatchEvent(drop);
      // No drop zone took it (a build without one): the page did nothing with the file.
      if (!drop.defaultPrevented) end(refused('anchor-missing'));
      else {
        host.frame(() => {
          taking = false;
          judge([]);
        });
        host.setTimer(() => deadline(false), ATTACH_WATCH_MS);
      }
      return done;
    },
    /** The runtime goes: an attempt in progress is `unknown`. */
    dispose(): void {
      open?.({ state: 'unknown' });
    },
  };
}
