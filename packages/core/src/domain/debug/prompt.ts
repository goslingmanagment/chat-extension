// The prompt snapshot's content (architecture.md §9.3; DB-004…DB-008): what
// `debug_input_v1` brings, cut to the limits — blocks up to 500 000
// characters each, the context manifest up to 100 000 — with every cut
// marked. The text lives only in the background's memory (the store is
// core/services/diagnostics) and reaches only debug-prompt.html by an
// opaque token; it is never logged.

import { DEBUG_LIMITS } from '@cg/contracts/limits';
import { type FeatureId } from '@cg/contracts/features';
import { type HubFrame } from '@cg/contracts/hub';
import { type PromptSnapshotView } from '@cg/contracts/tab-messages';

export type DebugInputFrame = Extract<HubFrame, { readonly type: 'debug_input_v1' }>;

/** Appended to a cut text (the manifest has no `truncated` flag of its own in the view). */
export const TRUNCATED_MARK = '\n…[truncated]';

/** The view carries at most this many blocks; more are merged per side. */
export const PROMPT_VIEW_MAX_BLOCKS = 32;

export interface PromptBlock {
  readonly name: string;
  readonly text: string;
  readonly truncated: boolean;
}

export interface PromptSnapshotContent {
  readonly feature: FeatureId | null;
  readonly capturedAt: number;
  /** The generation was served from a cache: explained on the page (DB-008). */
  readonly fromCache: boolean;
  readonly blocks: readonly PromptBlock[];
  /** JSON of the context manifest, cut with TRUNCATED_MARK; null when the hub sent none. */
  readonly manifest: string | null;
  readonly manifestTruncated: boolean;
  /** Characters held (blocks + manifest): the store's own budget. */
  readonly chars: number;
}

export function cutText(text: string, max: number): { readonly text: string; readonly truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  let cut = Math.max(0, max - TRUNCATED_MARK.length);
  const last = text.charCodeAt(cut - 1);
  if (cut > 0 && last >= 0xd800 && last <= 0xdbff) cut -= 1;
  return { text: `${text.slice(0, cut)}${TRUNCATED_MARK}`, truncated: true };
}

export function isTruncatedText(text: string): boolean {
  return text.endsWith(TRUNCATED_MARK);
}

type FrameBlock = DebugInputFrame['systemBlocks'][number];

function sideBlocks(side: 'system' | 'user', blocks: readonly FrameBlock[], merge: boolean): PromptBlock[] {
  if (merge) {
    const caches = [...new Set(blocks.map((block) => block.cache))].join('/');
    const joined = cutText(blocks.map((block) => block.text).join('\n\n— — —\n\n'), DEBUG_LIMITS.promptBlockMaxChars);
    return [{ name: `${side} ×${blocks.length} · cache ${caches}`, ...joined }];
  }
  return blocks.map((block, i) => ({ name: `${side} ${i + 1} · cache ${block.cache}`, ...cutText(block.text, DEBUG_LIMITS.promptBlockMaxChars) }));
}

function manifestText(manifest: DebugInputFrame['contextManifest']): string | null {
  if (manifest === null) return null;
  try {
    return JSON.stringify(manifest, null, 2) ?? null;
  } catch {
    return '"[unserializable manifest]"';
  }
}

/** DB-005: the frame cut to the limits, blocks named by side, order and cache. */
export function snapshotFromFrame(
  frame: DebugInputFrame,
  facts: { readonly feature: FeatureId | null; readonly capturedAt: number; readonly fromCache?: boolean },
): PromptSnapshotContent {
  const merge = frame.systemBlocks.length + frame.userBlocks.length > PROMPT_VIEW_MAX_BLOCKS;
  const blocks = [...sideBlocks('system', frame.systemBlocks, merge), ...sideBlocks('user', frame.userBlocks, merge)];
  const rawManifest = manifestText(frame.contextManifest);
  const manifest = rawManifest === null ? null : cutText(rawManifest, DEBUG_LIMITS.promptManifestMaxChars);
  const chars = blocks.reduce((sum, block) => sum + block.text.length, 0) + (manifest?.text.length ?? 0);
  return {
    feature: facts.feature,
    capturedAt: facts.capturedAt,
    fromCache: facts.fromCache ?? false,
    blocks,
    manifest: manifest?.text ?? null,
    manifestTruncated: manifest?.truncated ?? false,
    chars,
  };
}

export type PromptViewState = PromptSnapshotView['state'];

/** The answer of `debug.prompt`: the content, or an honest reason why there is none (DB-008). */
export function promptView(state: PromptViewState, content: PromptSnapshotContent | null): PromptSnapshotView {
  if (state !== 'ok' || content === null) {
    return {
      state: state === 'ok' ? 'not-found' : state,
      fromCache: content?.fromCache ?? false,
      capturedAt: content === null ? null : new Date(content.capturedAt).toISOString(),
      feature: content?.feature ?? null,
      manifest: null,
      blocks: [],
    };
  }
  return {
    state: 'ok',
    fromCache: content.fromCache,
    capturedAt: new Date(content.capturedAt).toISOString(),
    feature: content.feature,
    manifest: content.manifest,
    blocks: content.blocks.map((block) => ({ name: block.name.slice(0, 64), text: block.text, truncated: block.truncated })),
  };
}
