// Fansly's own operations (1.15.0, R20 P4b3; host: fansly-web; docs/project-unite/architecture.md §1.6, §8.8,
// §11.1): the voice script and «Заполнить из чата» — the shared types and the site's schemas say the same, each one's
// driver data, the hub features they stream and the body fields and rules those take; the module stays Fansly's own.

import { readFileSync } from 'node:fs';

import { describe, expect, expectTypeOf, it } from 'vitest';
import type * as z from 'zod/mini';

import { FANSLY_OP_VIEW_FIXTURES } from './fixtures/ops-fansly';
import { FANSLY_FEATURES } from '../src/features/fansly';
import * as C from '../src/index';
import * as O from '../src/ops-fansly';
import { FANSLY_TAB_LIMITS } from '../src/tab-messages-fansly';
import {
  FANSLY_OP_REQUEST_FIXTURES,
  FANSLY_OP_RESULT_FIXTURES,
  FANSLY_START_OP_FIXTURES,
  NOTE_FIELDS_FIXTURES,
  fanslyNotesFillStart,
  fanslyVoiceScriptStart,
  noteFieldsResult,
  voiceScriptResult,
  type Verdicts,
} from './fixtures/index';

function expectVerdicts(label: string, schema: { safeParse(value: unknown): { success: boolean } }, verdicts: Verdicts): void {
  expect(verdicts.valid.length * verdicts.invalid.length, label).toBeGreaterThan(0);
  verdicts.valid.forEach((value, index) => expect(schema.safeParse(value).success, `${label} valid[${index}]`).toBe(true));
  verdicts.invalid.forEach((value, index) => expect(schema.safeParse(value).success, `${label} invalid[${index}]`).toBe(false));
}

describe('[host:fansly] the operations of Fansly’s slice (architecture §1.6, §8.8)', () => {
  it('P12a: display metadata of a site stays beside the closed common summaries', () => {
    const summary = { opId: '00000000-0000-4000-8000-000000000550', feature: 'voice-script', surface: 'dock', chat: fanslyVoiceScriptStart.target.chat, fanLabel: null, state: 'streaming', startedAt: 1, inThisTab: true };
    expectVerdicts('SiteActiveOpSummary', C.SiteActiveOpSummarySchema, { valid: [summary], invalid: [{ ...summary, feature: {} }, { ...summary, feature: 'not a token' }] });
    expect(C.ActiveOpSummarySchema.safeParse(summary).success).toBe(false);
    expect(C.AdmissionSchema.safeParse({ ok: false, code: 'CG-OP-TAB-LIMIT', active: [], siteActive: [summary, summary, summary, summary] }).success).toBe(false);
  });

  it('P12a: the kept view stays in the site registry; result and source agree', () => { expectVerdicts('FanslyOpView', O.FanslyOpViewSchema, FANSLY_OP_VIEW_FIXTURES); });

  it('are the shared type’s site operations, none of them a shared feature', () => {
    expect(O.FANSLY_OPS).toEqual(['voice-script', 'notes-fill']);
    expectTypeOf<O.FanslyOp>().toEqualTypeOf<C.SiteOpId>();
    expectTypeOf<C.OpFeature>().toEqualTypeOf<C.FeatureId | C.SiteOpId>();
    for (const op of O.FANSLY_OPS) {
      expect(C.FEATURE_IDS as readonly string[], op).not.toContain(op);
      expect(C.FeatureIdSchema.safeParse(op).success, op).toBe(false);
      expect(O.isFanslyOp(op), op).toBe(true);
    }
    for (const feature of C.FEATURE_IDS) expect(O.isFanslyOp(feature), feature).toBe(false);
  });

  it('each one’s driver: the hub feature it streams, the manifest entry that admits it — its switch the page’s — its result and timeouts', () => {
    expect(Object.keys(O.FANSLY_OP_DRIVERS)).toEqual([...O.FANSLY_OPS]);
    expect(O.FANSLY_OP_DRIVERS['voice-script']).toEqual({ hub: 'voice-script', feature: 'voice', result: 'voice-script', timeouts: C.OP_TIMEOUTS.reply });
    expect(O.FANSLY_OP_DRIVERS['notes-fill']).toEqual({ hub: 'fan-notes-fill', feature: 'notes-fill', result: 'note-fields', timeouts: C.OP_TIMEOUTS.recap });
    for (const op of O.FANSLY_OPS) {
      const driver = O.FANSLY_OP_DRIVERS[op];
      expect(C.HUB_AI_FEATURES, op).toContain(driver.hub);
      // A shared feature never streams one of them: the hub's two features are the site's operations' alone.
      expect(Object.values(C.HUB_FEATURE_MAP).map((spec) => spec.hub), op).not.toContain(driver.hub);
      // Admitted by its entry's `generate` (§1.4): the page's own switch, `voice` and `notesFill` (§11.1).
      expect(FANSLY_FEATURES[driver.feature].actions, op).toHaveProperty('generate');
    }
    expect([FANSLY_FEATURES.voice.base.flags, FANSLY_FEATURES['notes-fill'].base.flags]).toEqual([['voice'], ['notesFill']]);
  });

  it('a start: the voice script from a draft in a preset’s tone, the notes fill with the labels and their values (X43) — a Fansly chat’s, the group apart from the fan', () => {
    expectVerdicts('FanslyStartOp', O.FanslyStartOpSchema, FANSLY_START_OP_FIXTURES);
    expect(O.FanslyStartOpSchema.safeParse(fanslyVoiceScriptStart).success).toBe(true);
    expect(fanslyVoiceScriptStart.target.conversationRef).not.toBe(fanslyVoiceScriptStart.target.fanRef);
    expect(Object.keys(O.VoiceScriptStartSchema.def.shape).sort()).toEqual(['cause', 'draft', 'feature', 'force', 'regenerateOf', 'target', 'tone', 'window'].sort());
    expect(Object.keys(O.NotesFillStartSchema.def.shape).sort()).toEqual(['cause', 'feature', 'fields', 'force', 'regenerateOf', 'target', 'values', 'window'].sort());
    // The shared StartOp knows neither: a site operation never passes the shared schemas, and no shared one widens.
    expect(C.StartOpSchema.safeParse({ ...fanslyVoiceScriptStart, surface: 'dock', split: false }).success).toBe(false);
    expect(C.StartOpSchema.safeParse({ ...fanslyNotesFillStart, surface: 'dock', tone: null, split: false }).success).toBe(false);
  });

  it('a result: the script for the editor, or each asked label with what the chat gave it', () => {
    expectVerdicts('FanslyOpResult', O.FanslyOpResultSchema, FANSLY_OP_RESULT_FIXTURES);
    expect(C.OpResultSchema.safeParse(voiceScriptResult).success).toBe(false);
    expect(C.OpResultSchema.safeParse(noteFieldsResult).success).toBe(false);
    // The script the result carries is one the paid voicing takes (`fansly.voice.create`).
    expect(O.FANSLY_OP_LIMITS.voiceScriptMaxChars).toBe(FANSLY_TAB_LIMITS.voiceScriptMaxChars);
    // Each driver names the kind its result parses to.
    expect(O.FANSLY_OPS.map((op) => O.FANSLY_OP_DRIVERS[op].result)).toEqual([voiceScriptResult.kind, noteFieldsResult.kind]);
    // HF-6 (R20 P11c): the fill's depth floor is a window the wire carries.
    expect(O.FANSLY_OP_LIMITS.notesFillDepthMin).toBe(3000);
    expect(O.FANSLY_OP_LIMITS.notesFillDepthMin).toBeLessThanOrEqual(C.AI_REQUEST_LIMITS.messageCountMax);
  });

  it('the shared types and the site’s schemas say the same (the union is the types’ alone)', () => {
    expectTypeOf<z.infer<typeof O.FanslyStartOpSchema>>().toMatchTypeOf<C.SiteStartOp>();
    expectTypeOf<z.infer<typeof O.FanslyOpResultSchema>>().toMatchTypeOf<C.SiteOpResult>();
    expectTypeOf<keyof z.infer<typeof O.VoiceScriptStartSchema>>().toEqualTypeOf<keyof C.VoiceScriptStart>();
    expectTypeOf<keyof z.infer<typeof O.NotesFillStartSchema>>().toEqualTypeOf<keyof C.NotesFillStart>();
    expectTypeOf<z.infer<typeof O.FanslyStartOpSchema>['feature']>().toEqualTypeOf<C.SiteStartOp['feature']>();
    expectTypeOf<z.infer<typeof O.FanslyOpResultSchema>['kind']>().toEqualTypeOf<C.SiteOpResult['kind']>();
    expectTypeOf<C.AnyStartOp>().toEqualTypeOf<C.StartOp | C.SiteStartOp>();
    expectTypeOf<C.AnyOpResult>().toEqualTypeOf<C.OpResult | C.SiteOpResult>();
  });
});

describe('[host:fansly] the hub’s side of the two (contracts/src/hub, HF-4а, HF-12, `fan-notes-fill`)', () => {
  it('the questionnaire’s labels as the hub takes them: 1–30, ≤ 60 each, trimmed, none twice, nothing that breaks `Label: value`', () => {
    expectVerdicts('NoteFields', C.NoteFieldsSchema, NOTE_FIELDS_FIXTURES);
    expect(C.NOTE_FILL_LIMITS).toEqual({ fieldsMax: 30, labelMaxChars: 60, valueMaxChars: 2000 });
  });

  it('a request of each: what the hub’s handler refuses, the mirror refuses', () => {
    expectVerdicts('HubStreamRequest (Fansly operations)', C.HubStreamRequestSchema, FANSLY_OP_REQUEST_FIXTURES);
  });

  it('the body fields of a feature are its alone: the tone and the draft go to the script too, the labels to the fill alone', () => {
    expect(C.HUB_FEATURE_ONLY_FIELDS.replyTone).toEqual(['fast-reply', 'voice-script']);
    expect(C.HUB_FEATURE_ONLY_FIELDS.draftText).toEqual(['improve-draft', 'coach-chat', 'voice-script']);
    expect(C.HUB_FEATURE_ONLY_FIELDS.noteFields).toEqual(['fan-notes-fill']);
    // Fresh page text stays the four drafts' (D-14): neither the script nor the fill takes it.
    for (const hub of ['voice-script', 'fan-notes-fill'] as const) expect(C.HUB_FEATURE_ONLY_FIELDS.liveTextContext as readonly string[], hub).not.toContain(hub);
    // 1.28.0 (X43): the questionnaire's values are the fill's alone, beside its labels — never on another feature.
    expect(C.HUB_FEATURE_ONLY_FIELDS.noteValues).toEqual(['fan-notes-fill']);
  });
});

describe('[host:fansly] ops-fansly stays Fansly’s own module (§1.8, §3.2)', () => {
  it('is a subpath only: the root re-exports none of it', () => {
    const root = Object.keys(C);
    for (const name of Object.keys(O)) expect(root, name).not.toContain(name);
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { exports: Record<string, string> };
    expect(manifest.exports['./ops-fansly']).toBe('./src/ops-fansly.ts');
  });

  it('the shared modules name Fansly’s operations in types alone: no value of them in features.ts or ops.ts', () => {
    for (const file of ['../src/features.ts', '../src/ops.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      for (const op of O.FANSLY_OPS) expect([...code.matchAll(new RegExp(`'${op}'`, 'g'))].every((match) => /type |interface |extends /.test(code.slice(code.lastIndexOf('\n', match.index), match.index))), `${file}: ${op}`).toBe(true);
    }
  });
});
