// Clipboard writes (architecture.md §14 «Буфер обмена — только по жесту»):
// called synchronously from the click or key handler; without an active user
// gesture we do not even try. Failure is CG-CLIPBOARD; the text is never logged.

export interface ClipboardNavigator {
  readonly clipboard?: { writeText(text: string): Promise<void> };
  readonly userActivation?: { readonly isActive: boolean };
}

export type ClipboardResult = { readonly ok: true } | { readonly ok: false; readonly code: 'CG-CLIPBOARD'; readonly reason: 'no-gesture' | 'unavailable' | 'refused' };

export async function writeClipboardText(text: string, nav: ClipboardNavigator | undefined = globalThis.navigator): Promise<ClipboardResult> {
  if (nav?.userActivation !== undefined && !nav.userActivation.isActive) return { ok: false, code: 'CG-CLIPBOARD', reason: 'no-gesture' };
  if (!nav?.clipboard) return { ok: false, code: 'CG-CLIPBOARD', reason: 'unavailable' };
  try {
    await nav.clipboard.writeText(text);
    return { ok: true };
  } catch {
    return { ok: false, code: 'CG-CLIPBOARD', reason: 'refused' };
  }
}
