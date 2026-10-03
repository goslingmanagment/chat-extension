// A minimal check of the fake hub's control commands (the same JSON
// in-process and over the loopback control endpoint): an unknown op, an
// unknown field (a typo such as `advanceMS`) or a field of the wrong kind is
// an error of the test, never a silent `{ ok: true }` that leaves the hub as
// it was. The loopback endpoint answers it with 400.

import { type FakeHubCommand } from './types';

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

const MATCH = oneOf('exact', 'route');
const UNSCRIPTED = oneOf('fail', 'model');
const PAGE_FAN = { pageLabel: isString, fanRef: isString };

/** Per op: its fields (required ones listed in REQUIRED), each with its check. */
const FIELDS: Readonly<Record<FakeHubCommand['op'], Readonly<Record<string, FieldCheck>>>> = {
  reset: {},
  preset: { name: oneOf('pilot-on', 'all-off', 'master-off') },
  config: { patch: isObject },
  useHttpScenario: { scenario: either(isString, isObject), match: MATCH, unscripted: UNSCRIPTED },
  useSseScenario: { scenario: either(isString, isObject), match: MATCH },
  scriptHttp: { exchanges: isArray, match: MATCH, unscripted: UNSCRIPTED },
  scriptSse: { responses: isArray, feature: isString },
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
  archiveRebuild: PAGE_FAN,
  grantPages: { username: isString, userId: isNumber, pages: isStringArray },
  audienceEvent: { ...PAGE_FAN, kind: oneOf('new', 'returning'), trial: isBoolean },
  status: {},
};

const REQUIRED: Readonly<Partial<Record<FakeHubCommand['op'], readonly string[]>>> = {
  preset: ['name'],
  config: ['patch'],
  useHttpScenario: ['scenario'],
  useSseScenario: ['scenario'],
  scriptHttp: ['exchanges'],
  scriptSse: ['responses'],
  release: ['gate'],
  persona: ['key', 'definitionId'],
  resolveCustody: ['pageLabel', 'fanRef', 'attemptId', 'outcome'],
  desktopHold: ['pageLabel', 'fanRef', 'held'],
  desktopGreeting: ['pageLabel', 'fanRef'],
  archiveMessage: ['pageLabel', 'fanRef'],
  archiveRebuild: ['pageLabel', 'fanRef'],
  grantPages: ['pages'],
  audienceEvent: ['pageLabel', 'fanRef'],
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
  'quotaRequestsToday',
  'generationVisibleAfterMs',
  'spendersTotal',
  'aiChunkDelayMs',
]);

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
    const unknown = Object.keys(command['patch'] as object).filter((key) => !PATCH_KEYS.has(key));
    if (unknown.length > 0) throw new Error(`fake hub control: config patch has no field «${unknown.join('», «')}»`);
  }
  return value as FakeHubCommand;
}
