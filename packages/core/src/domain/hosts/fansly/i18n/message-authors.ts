// The words of «кто написал» before the time under the model's messages on Fansly (2026-11-03): how a message's text
// was written, as the hub recorded the send, and the messages of a run nobody is known for. The AI buttons keep the
// names the dock shows; a login is shown as the hub has it. No long dash in what a chatter reads.

/** How the text was written (hub `composedWith`); a value not named here shows nothing. */
const HOW: Readonly<Record<string, string>> = { hand: 'сам', reply: 'Reply', fix: 'Fix', hi: 'Hi', ping: 'Ping', coach: 'Coach' };

export const MESSAGE_AUTHOR_TEXTS = {
  /** «Reply», «сам»; «Reply + правка» when the AI's text was changed before the send; null — not known. */
  how(composedWith: string | null, edited: boolean | null): string | null {
    const word = composedWith === null ? undefined : HOW[composedWith];
    if (word === undefined) return null;
    return edited === true && composedWith !== 'hand' ? `${word} + правка` : word;
  },
  /** Messages of a run whose sender is not known. */
  unknown: (count: number): string => `+${count} без автора`,
} as const;
