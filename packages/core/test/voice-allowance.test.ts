// The page's day allowance in the tab (1.49.0): the studio's line beside «Озвучить» — what is left, a script longer
// than that, nothing left (domain voiceAllowanceLine) — and the desk that reads it: one read of a page at a time, read
// again once a take moves while the studio is open, dropped when its day ends.

import { chatKeyOf, type VoiceAllowance, type VoiceSession, type VoiceTake } from '@cg/contracts';
import { voiceAllowanceLine, voiceScriptMax } from '@cg/core/domain/voice';
import { describe, expect, it } from 'vitest';

import { type AiPorts } from '../src/application/ai/ports';
import { VoiceDesk } from '../src/application/ai/voice-desk';
import { chatOf, uuid } from './support/world';

const NOW = Date.parse('2026-10-22T21:00:00.000Z');
const MIDNIGHT = '2026-10-23T00:00:00.000Z';
const FAN = '2002';
const PAGE_ID = 11;
const day = (remainingChars: number): VoiceAllowance => ({ scriptMaxChars: 600, dailyChars: 5_000, remainingChars, resetsAt: MIDNIGHT });

describe('the line beside «Озвучить»', () => {
  it('says what is left, warns of a longer script and of an empty day, and says nothing it does not know', () => {
    expect(voiceAllowanceLine(day(1_400), 120, NOW)).toEqual({ state: 'left', remaining: 1_400, resetsAt: MIDNIGHT });
    expect(voiceAllowanceLine(day(120), 120, NOW)?.state).toBe('left');
    expect(voiceAllowanceLine(day(119), 120, NOW)).toEqual({ state: 'short', remaining: 119, resetsAt: MIDNIGHT });
    expect(voiceAllowanceLine(day(0), 120, NOW)).toEqual({ state: 'out', remaining: 0, resetsAt: MIDNIGHT });
    // No script to voice yet: only an empty day is worth saying.
    expect(voiceAllowanceLine(day(0), null, NOW)?.state).toBe('out');
    expect(voiceAllowanceLine(day(1_400), null, NOW)).toBeNull();
    // Not known, or its day is over.
    expect(voiceAllowanceLine(null, 120, NOW)).toBeNull();
    expect(voiceAllowanceLine(day(0), 120, Date.parse(MIDNIGHT))).toBeNull();
  });

  it('the editor counts to the hub’s live cap, else its default, never past the wire’s own bound', () => {
    expect(voiceScriptMax(null)).toBe(600);
    expect(voiceScriptMax({ scriptMaxChars: 400 })).toBe(400);
    expect(voiceScriptMax({ scriptMaxChars: 9_000 })).toBe(5_000);
  });
});

type Answer = { readonly ok: true; readonly payload: { readonly allowance: VoiceAllowance | null } } | { readonly ok: false; readonly error: { readonly code: string } };

interface Rig {
  readonly desk: VoiceDesk;
  /** The `voice.allowance` requests asked, in order; `answer` settles the oldest one still waiting. */
  readonly asked: number[];
  answer(answer: Answer): Promise<void>;
  /** The background tells the tabs of the chat's session (`voice.changed`). */
  told(session: VoiceSession): void;
  /** Moves the clock and runs the timers that are due. */
  advance(ms: number): Promise<void>;
  studio: boolean;
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function rig(): Rig {
  let now = NOW;
  const waiting: ((answer: Answer) => void)[] = [];
  const listeners = new Map<string, (payload: unknown) => void>();
  const timers = new Set<{ readonly at: number; readonly run: () => void }>();
  const chat = chatOf(FAN);
  const key = chatKeyOf(chat);
  const r = {
    asked: [] as number[],
    studio: true,
    desk: null as unknown as VoiceDesk,
    async answer(answer: Answer) {
      waiting.shift()?.(answer);
      await settle();
    },
    told(session: VoiceSession) {
      listeners.get('voice.changed')?.({ chat, conversationRef: FAN, session });
    },
    async advance(ms: number) {
      now += ms;
      for (const timer of [...timers]) {
        if (timer.at > now) continue;
        timers.delete(timer);
        timer.run();
      }
      await settle();
    },
  };
  const ports = {
    rpc: {
      request: (type: string, payload: { readonly pageId: number }) => {
        if (type !== 'voice.allowance') return Promise.resolve({ ok: false, error: { code: 'CG-UNKNOWN' } });
        r.asked.push(payload.pageId);
        return new Promise<Answer>((resolve) => waiting.push(resolve));
      },
      onEvent: (type: string, listener: (payload: unknown) => void) => {
        listeners.set(type, listener);
        return () => listeners.delete(type);
      },
    },
    clock: {
      now: () => now,
      setTimer: (ms: number, run: () => void) => {
        const timer = { at: now + ms, run };
        timers.add(timer);
        return timer;
      },
      clearTimer: (timer: unknown) => timers.delete(timer as { readonly at: number; readonly run: () => void }),
    },
  } as unknown as AiPorts;
  r.desk = new VoiceDesk({ ports, changed: () => undefined, openChat: () => ({ key, pageId: PAGE_ID, conversationRef: FAN }), studioOpen: () => r.studio });
  return r;
}

const session = (state: VoiceTake['state'], revision: number): VoiceSession => ({
  sessionId: uuid(0x700),
  pageId: PAGE_ID,
  chat: chatOf(FAN),
  conversationRef: FAN,
  fanRef: FAN,
  createdAt: NOW,
  updatedAt: NOW,
  revision,
  draft: 'hey, i missed you',
  script: { tone: 'warm', generationRef: uuid(0x702), original: 'Hey you', edited: null },
  writing: null,
  error: null,
  takes: [{ takeId: uuid(0x801), createdAt: NOW, script: 'Hey you', sourceGenerationRef: uuid(0x702), state, voiceNoteId: state === 'creating' ? null : 77, audio: null, billed: null, error: null, attached: null }],
});

describe('the desk’s read of the day', () => {
  it('one read of a page at a time: one asked meanwhile follows it; a failure is «not known» and is not asked again by itself', async () => {
    const r = rig();
    r.desk.readAllowance(PAGE_ID);
    r.desk.readAllowance(PAGE_ID);
    r.desk.ensureAllowance(PAGE_ID);
    expect(r.asked).toEqual([PAGE_ID]);
    await r.answer({ ok: true, payload: { allowance: day(1_400) } });
    expect(r.desk.allowance(PAGE_ID)).toEqual(day(1_400));
    expect(r.asked).toHaveLength(2);
    await r.answer({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE' } });
    expect(r.desk.allowance(PAGE_ID)).toBeNull();
    r.desk.ensureAllowance(PAGE_ID);
    expect(r.asked).toHaveLength(2);
  });

  it('a take that moves reads the day again while the studio is open, not while it is closed', async () => {
    const r = rig();
    r.told(session('creating', 1));
    expect(r.asked).toHaveLength(0);
    r.told(session('working', 2));
    expect(r.asked).toHaveLength(1);
    await r.answer({ ok: true, payload: { allowance: day(1_393) } });
    // The same state told again moves nothing; a settle with the studio closed waits for it to open.
    r.told(session('working', 3));
    r.studio = false;
    r.told(session('ready', 4));
    expect(r.asked).toHaveLength(1);
  });

  it('when its day ends the kept day goes, and the open studio reads the new one', async () => {
    const r = rig();
    r.desk.readAllowance(PAGE_ID);
    await r.answer({ ok: true, payload: { allowance: day(0) } });
    await r.advance(Date.parse(MIDNIGHT) - NOW - 1);
    expect([r.desk.allowance(PAGE_ID), r.asked.length]).toEqual([day(0), 1]);
    await r.advance(1_001);
    expect([r.desk.allowance(PAGE_ID), r.asked.length]).toEqual([null, 2]);
  });
});
