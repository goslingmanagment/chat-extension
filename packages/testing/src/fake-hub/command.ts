// A minimal check of the fake hub's control commands (the same JSON
// in-process and over the loopback control endpoint): an unknown op, an
// unknown field (a typo such as `advanceMS`) or a field of the wrong kind is
// an error of the test, never a silent `{ ok: true }` that leaves the hub as
// it was. The loopback endpoint answers it with 400.

import { ONLINE_SEED_KEYS } from './online';
import { type FakeHubCommand } from './types';
import { FAKE_VOICE_OUTCOMES } from './voice';

type FieldCheck = (value: unknown) => boolean;

const isString: FieldCheck = (value) => typeof value === 'string';
const isNumber: FieldCheck = (value) => typeof value === 'number' && Number.isFinite(value);
const isBoolean: FieldCheck = (value) => typeof value === 'boolean';
const isObject: FieldCheck = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isArray: FieldCheck = (value) => Array.isArray(value);
const isStringArray: FieldCheck = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');
const oneOf =
  (...allowed: readonly unknown[]): FieldCheck =>
  (value) =>
    allowed.includes(value);
const either =
  (...checks: readonly FieldCheck[]): FieldCheck =>
  (value) =>
    checks.some((check) => check(value));

const SEED_FIELDS: Readonly<Record<string, FieldCheck>> = {
  fanRef: (value) => typeof value === 'string' && /^[1-9]\d{0,29}$/.test(value),
  conversationRef: either((value) => typeof value === 'string' && /^[1-9]\d{0,29}$/.test(value), oneOf(null)),
  username: isString,
  displayName: either(isString, oneOf(null)),
  lifetimeUsd: isNumber,
  windowUsd: either(isNumber, oneOf(null)),
  fanWroteAgoSec: either(isNumber, oneOf(null)),
  weWroteAgoSec: either(isNumber, oneOf(null)),
  awaiting: isBoolean,
  preview: isString,
  lookupMissAgoSec: isNumber,
};
/** `spenderFans.fans`: objects with a fan id and nothing but the seed's own fields. */
const isSpenderSeeds: FieldCheck = (value) =>
  Array.isArray(value) &&
  value.every(
    (seed) =>
      isObject(seed) &&
      SEED_FIELDS['fanRef']?.((seed as Record<string, unknown>)['fanRef']) === true &&
      Object.entries(seed as Record<string, unknown>).every(([key, field]) => field === undefined || SEED_FIELDS[key]?.(field) === true),
  );

const isNativeId: FieldCheck = (value) => typeof value === 'string' && /^[1-9]\d{0,29}$/.test(value);
/** `archiveConversation.messages`: an id, a side, at most a state, and what the site shows of it (text, time, price) — nothing else. */
const CONVERSATION_SEED_FIELDS: Readonly<Record<string, FieldCheck>> = {
  state: oneOf('held', 'deleted'),
  text: isString,
  at: (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)),
  priceMills: (value) => isNumber(value) && (value as number) >= 0,
};
const isConversationSeed: FieldCheck = (value) =>
  Array.isArray(value) &&
  value.every(
    (message) =>
      isObject(message) &&
      isNativeId((message as Record<string, unknown>)['id']) &&
      oneOf('fan', 'model')((message as Record<string, unknown>)['sender']) &&
      Object.entries(message as Record<string, unknown>).every(([key, field]) => key === 'id' || key === 'sender' || (field === undefined ? key in CONVERSATION_SEED_FIELDS : CONVERSATION_SEED_FIELDS[key]?.(field) === true)),
  );

/** `online.items`: a fan id each and nothing but the hub item's fields (and `seenAgoMs`, `onlineAgoMs`); null — the stand's fans. */
const isOnlineSeeds: FieldCheck = (value) =>
  value === null ||
  (Array.isArray(value) &&
    value.every(
      (item) =>
        isObject(item) &&
        isNativeId((item as Record<string, unknown>)['fanRef']) &&
        Object.keys(item as Record<string, unknown>).every((key) => ONLINE_SEED_KEYS.has(key)) &&
        ['seenAgoMs', 'onlineAgoMs'].every((key) => (item as Record<string, unknown>)[key] === undefined || (isNumber((item as Record<string, unknown>)[key]) && ((item as Record<string, unknown>)[key] as number) >= 0)),
    ));
/** `online.templates`: `{ id, group, text }` each; null — the guide. */
const isOnlineTemplates: FieldCheck = (value) =>
  value === null ||
  (Array.isArray(value) &&
    value.every((item) => isObject(item) && Object.keys(item as Record<string, unknown>).every((key) => key === 'id' || key === 'group' || key === 'text') && ['id', 'group', 'text'].every((key) => isString((item as Record<string, unknown>)[key]))));

const MATCH = oneOf('exact', 'route');
const UNSCRIPTED = oneOf('fail', 'model');
const PAGE_FAN = { pageLabel: isString, fanRef: isString };

const isVoiceOutcome = oneOf(...FAKE_VOICE_OUTCOMES);
/** `scriptVoice.outcomes`: an outcome's name, or `{ outcome, ms }` (ms ≥ 0) with nothing else. */
const isVoiceOutcomes: FieldCheck = (value) =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      isVoiceOutcome(item) ||
      (isObject(item) &&
        isVoiceOutcome((item as Record<string, unknown>)['outcome']) &&
        Object.entries(item as Record<string, unknown>).every(([key, field]) => key === 'outcome' || (key === 'ms' && (field === undefined || (isNumber(field) && (field as number) >= 0))))),
  );

/** Per op: its fields (required ones listed in REQUIRED), each with its check. */
const FIELDS: Readonly<Record<FakeHubCommand['op'], Readonly<Record<string, FieldCheck>>>> = {
  reset: {},
  preset: { name: oneOf('pilot-pages', 'pilot-on', 'all-off', 'master-off') },
  config: { patch: isObject },
  useHttpScenario: { scenario: either(isString, isObject), match: MATCH, unscripted: UNSCRIPTED },
  useSseScenario: { scenario: either(isString, isObject), match: MATCH },
  scriptHttp: { exchanges: isArray, match: MATCH, unscripted: UNSCRIPTED },
  scriptSse: { responses: isArray, feature: isString },
  scriptVoice: { outcomes: isVoiceOutcomes },
  clearScripts: {},
  release: { gate: isString },
  clock: { mode: oneOf('manual', 'system'), setMs: isNumber, advanceMs: isNumber },
  revokeTokens: { userId: isNumber, tokenId: isNumber },
  expireTokens: { userId: isNumber, tokenId: isNumber },
  health: { status: oneOf('ok', 'degraded'), compatibleClientSdks: either(isStringArray, oneOf(null)), contractHash: isString },
  persona: { key: isString, definitionId: isString, displayName: isString, status: oneOf('active', 'archived') },
  resolveCustody: { ...PAGE_FAN, attemptId: isString, outcome: oneOf('sent', 'not_sent'), platformMessageId: isString },
  desktopHold: { ...PAGE_FAN, held: isBoolean },
  desktopGreeting: PAGE_FAN,
  archiveMessage: { ...PAGE_FAN, sender: oneOf('fan', 'model'), messageId: isString },
  archiveConversation: { pageLabel: isString, conversationRef: isNativeId, messages: isConversationSeed, lookupFails: isBoolean },
  thread: { pageLabel: isString, conversationRef: isNativeId, fanRef: either(isNativeId, oneOf(null)) },
  archiveRebuild: PAGE_FAN,
  grantPages: { username: isString, userId: isNumber, pages: isStringArray },
  pageAccount: { pageLabel: isString, platformAccountId: either(isString, oneOf(null)) },
  audienceEvent: { ...PAGE_FAN, kind: oneOf('new', 'returning'), trial: isBoolean, fanWrote: isBoolean, handSent: isBoolean, agoMs: isNumber, username: isString, displayName: isString },
  spenderFans: { fans: isSpenderSeeds },
  talking: { ...PAGE_FAN, conversationRef: isNativeId, name: isString, agoMs: isNumber },
  fanCard: { ...PAGE_FAN, card: isObject },
  noteWrite: { ...PAGE_FAN, noteRef: (value) => typeof value === 'string' && value !== '', action: (value) => value === 'created' || value === 'edited' || value === 'deleted', login: (value) => typeof value === 'string' && value !== '', at: (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) },
  queue: { pageLabel: isString, waiting: isArray, winBack: isObject, handoff: isObject },
  online: { pageLabel: isString, items: isOnlineSeeds, templates: isOnlineTemplates },
  fanQueues: { pageLabel: isString, set: oneOf('stand', null), userId: isNumber },
  status: {},
};

const REQUIRED: Readonly<Partial<Record<FakeHubCommand['op'], readonly string[]>>> = {
  preset: ['name'],
  config: ['patch'],
  useHttpScenario: ['scenario'],
  useSseScenario: ['scenario'],
  scriptHttp: ['exchanges'],
  scriptSse: ['responses'],
  scriptVoice: ['outcomes'],
  release: ['gate'],
  persona: ['key', 'definitionId'],
  resolveCustody: ['pageLabel', 'fanRef', 'attemptId', 'outcome'],
  desktopHold: ['pageLabel', 'fanRef', 'held'],
  desktopGreeting: ['pageLabel', 'fanRef'],
  archiveMessage: ['pageLabel', 'fanRef'],
  archiveConversation: ['pageLabel', 'conversationRef', 'messages'],
  thread: ['pageLabel', 'conversationRef', 'fanRef'],
  archiveRebuild: ['pageLabel', 'fanRef'],
  grantPages: ['pages'],
  pageAccount: ['pageLabel', 'platformAccountId'],
  audienceEvent: ['pageLabel', 'fanRef'],
  spenderFans: ['fans'],
  talking: ['pageLabel', 'fanRef', 'name'],
  fanCard: ['pageLabel', 'fanRef', 'card'],
  noteWrite: ['pageLabel', 'fanRef', 'noteRef', 'action', 'login', 'at'],
  queue: ['pageLabel'],
  online: ['pageLabel'],
  fanQueues: ['pageLabel', 'set'],
};

/** Keys of a config patch (FakeHubConfigPatch). */
const PATCH_KEYS: ReadonlySet<string> = new Set([
  'master',
  'flags',
  'pageFlags',
  'capabilities',
  'minVersion',
  'bindingsByHost',
  'limits',
  'narrowTokens',
  'clientBootstrap',
  'quotaRequestsToday',
  'personalAiLimit',
  'generationVisibleAfterMs',
  'spendersTotal',
  'aiChunkDelayMs',
  'aiThinkMs',
  'aiNameFan',
  'aiTexts',
  'voiceLaneOff',
  'voiceDay',
  'coachDepth',
  'onlineStand',
]);

const VOICE_DAY_FIELDS: Readonly<Record<string, FieldCheck>> = {
  pageChars: (value) => isNumber(value) && Number.isInteger(value) && (value as number) >= 1,
  globalChars: (value) => isNumber(value) && Number.isInteger(value) && (value as number) >= 1,
  scriptMaxChars: (value) => isNumber(value) && Number.isInteger(value) && (value as number) >= 1,
  spentToday: (value) => isObject(value) && Object.values(value as object).every((chars) => isNumber(chars) && Number.isInteger(chars) && (chars as number) >= 0),
};
/** `config.patch.voiceDay`: whole positive budgets and caps, whole spends of zero or more, nothing else. */
const isVoiceDay: FieldCheck = (value) => isObject(value) && Object.entries(value as Record<string, unknown>).every(([key, field]) => field === undefined || VOICE_DAY_FIELDS[key]?.(field) === true);

const isOp = (op: unknown): op is FakeHubCommand['op'] => typeof op === 'string' && Object.hasOwn(FIELDS, op);

/** The command as given, or an Error naming what is wrong with it. */
export function checkCommand(value: unknown): FakeHubCommand {
  if (!isObject(value)) throw new Error('fake hub control: a command is a JSON object with an `op`');
  const command = value as Record<string, unknown>;
  const op = command['op'];
  if (!isOp(op)) throw new Error(`fake hub control: unknown op «${String(op)}»`);
  const fields = FIELDS[op];
  for (const [key, field] of Object.entries(command)) {
    if (key === 'op') continue;
    const check = fields[key];
    if (check === undefined) throw new Error(`fake hub control: ${op} has no field «${key}»`);
    if (field !== undefined && !check(field)) throw new Error(`fake hub control: ${op}.${key} is not valid (${JSON.stringify(field)?.slice(0, 80) ?? 'undefined'})`);
  }
  for (const key of REQUIRED[op] ?? []) if (command[key] === undefined) throw new Error(`fake hub control: ${op} needs «${key}»`);
  if (op === 'grantPages' && command['username'] === undefined && command['userId'] === undefined) throw new Error('fake hub control: grantPages needs «username» or «userId»');
  if (op === 'config') {
    const patch = command['patch'] as Record<string, unknown>;
    const unknown = Object.keys(patch).filter((key) => !PATCH_KEYS.has(key));
    if (unknown.length > 0) throw new Error(`fake hub control: config patch has no field «${unknown.join('», «')}»`);
    const limits = patch['limits'];
    if (limits !== undefined && (!isObject(limits) || ((limits as Record<string, unknown>)['deepMax'] !== undefined && !oneOf(1500, 3000, 5000)((limits as Record<string, unknown>)['deepMax'])))) throw new Error('fake hub control: limits.deepMax must be 1500, 3000 or 5000');
    const texts = patch['aiTexts'];
    if (texts !== undefined && !(isObject(texts) && Object.values(texts as object).every(isString))) throw new Error('fake hub control: config.patch.aiTexts is not a map of feature → text');
    const depth = patch['coachDepth'];
    const whole = (value: unknown): boolean => isNumber(value) && Number.isInteger(value) && (value as number) >= 1;
    const knob = depth as Record<string, unknown> | null | undefined;
    if (knob !== undefined && knob !== null && !(isObject(knob) && whole(knob['stored']) && whole(knob['oldestDays']) && whole(knob['moreBelow']) && isString(knob['note']) && (knob['deepText'] === undefined || isString(knob['deepText'])))) {
      throw new Error('fake hub control: config.patch.coachDepth takes stored, oldestDays, moreBelow (whole, ≥ 1), note and deepText, or null');
    }
    const day = patch['voiceDay'];
    if (day !== undefined && !isVoiceDay(day)) throw new Error('fake hub control: config.patch.voiceDay takes pageChars, globalChars, scriptMaxChars (whole, ≥ 1) and spentToday (page → whole chars ≥ 0)');
    if (patch['onlineStand'] !== undefined && !isBoolean(patch['onlineStand'])) throw new Error('fake hub control: config.patch.onlineStand is true or false');
  }
  return value as FakeHubCommand;
}
