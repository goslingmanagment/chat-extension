// Fansly-shaped data for the spike stand: snowflake ids, messages, socket frames ({t, d} with the two nested JSON
// strings of t:10000), and a /messaging/groups answer of the live size (≈ 115 KB). Shapes follow S2 §Q1, §Q3 and the
// hub's Fansly types; contents are synthetic.

export const CREATOR = '700000000000000001';
let counter = 0n;
const BASE = 812345678901234567n;

export function snowflake() {
  counter += 1n;
  return String(BASE + counter * 4096n);
}

const WORDS = 'hey babe how are you doing today i was thinking about you all day long send me something special please love that so much'.split(' ');
export function text(len) {
  let out = '';
  let i = len;
  while (out.length < len) out += `${WORDS[(i += 7) % WORDS.length]} `;
  return out.slice(0, len).trim() || 'hi';
}

export function message({ id = snowflake(), groupId, senderId, content = text(80), type = 1, createdAt = Date.now() / 1000, correlationId = '0', inReplyTo = null }) {
  return {
    id,
    type,
    dataVersion: 1,
    content,
    groupId,
    senderId,
    correlationId,
    inReplyTo,
    inReplyToRoot: inReplyTo,
    createdAt: Math.floor(createdAt),
    attachments: [],
    likes: [],
    totalTipAmount: 0,
    embeds: [],
    interactions: [{ userId: senderId === CREATOR ? '0' : CREATOR, readAt: 0, deliveredAt: 0 }],
  };
}

export const frame = (serviceId, event) => JSON.stringify({ t: 10000, d: JSON.stringify({ serviceId, event: JSON.stringify(event) }) });
export const newMessageFrame = (m) => frame(5, { type: 1, message: m });
export const deleteFrame = (m) => frame(5, { type: 10, message: m });
export const typingFrame = (groupId, accountId) => frame(5, { typingAnnounceEvent: { accountId, groupId, lastAnnounce: Date.now() } });
export const ackFrame = (userId, ids) => frame(4, { ackCommand: { type: 2, userId, messageIds: ids } });
export const followFrame = (followerId) => frame(3, { type: 2, follow: { id: snowflake(), accountId: CREATOR, followerId } });
export const sessionFrame = () => JSON.stringify({ t: 1, d: JSON.stringify({ session: { id: snowflake(), accountId: CREATOR, deviceId: null, token: 'x'.repeat(48) } }) });

/** A mix close to the busiest page (S2 §1.8): 46 % typing, ~30 % receipts, ~20 % messages, a few follows. */
export function frameMix(n, groups = 40) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const g = String(900000000000000000n + BigInt(i % groups));
    const fan = String(600000000000000000n + BigInt(i % groups));
    const r = i % 100;
    if (r < 46) out.push(typingFrame(g, fan));
    else if (r < 76) out.push(ackFrame(fan, [snowflake(), snowflake()]));
    else if (r < 98) out.push(newMessageFrame(message({ groupId: g, senderId: r % 2 ? fan : CREATOR, content: text(40 + ((i * 37) % 400)) })));
    else out.push(followFrame(fan));
  }
  return out;
}

function account(id) {
  return {
    id,
    username: `fan${id.slice(-6)}`,
    displayName: `Fan ${id.slice(-4)}`,
    flags: 0,
    version: 3,
    createdAt: 1700000000,
    followCount: 12,
    subscriberCount: 0,
    permissions: { accountPermissionFlags: { flags: 0 } },
    timelineStats: { accountId: id, imageCount: 0, videoCount: 0, bundleCount: 0, bundleImageCount: 0, bundleVideoCount: 0, fetchedAt: Date.now() },
    statusId: 1,
    lastSeenAt: Date.now(),
    about: text(260),
    location: '',
    profileAccessFlags: 0,
    profileFlags: 0,
    avatar: {
      id: snowflake(),
      type: 1,
      status: 1,
      accountId: id,
      mimetype: 'image/jpeg',
      flags: 0,
      location: `/${id}/${snowflake()}.jpeg`,
      width: 400,
      height: 400,
      metadata: '{}',
      updatedAt: 1700000000,
      createdAt: 1700000000,
      variants: Array.from({ length: 4 }, (_, k) => ({ id: snowflake(), type: 1, status: 1, mimetype: 'image/jpeg', flags: 0, location: `/${id}/${snowflake()}_${k}.jpeg`, width: 100 * (k + 1), height: 100 * (k + 1), metadata: '{}', updatedAt: 1700000000, locations: [{ locationId: '1', location: `https://cdn3.fansly.com/${id}/${snowflake()}_${k}.jpeg?ngsw-bypass=true&Policy=${'x'.repeat(180)}` }] })),
      variantHash: {},
      locations: [{ locationId: '1', location: `https://cdn3.fansly.com/${id}/${snowflake()}.jpeg?Policy=${'y'.repeat(180)}` }],
    },
  };
}

/** GET /messaging/groups: 20 groups + aggregationData; padded to `bytes` with real-looking accounts. */
export function groupsResponse(bytes = 115_000) {
  const data = [];
  const groups = [];
  const accounts = [];
  for (let i = 0; i < 20; i += 1) {
    const gid = String(900000000000000000n + BigInt(i));
    const fan = String(600000000000000000n + BigInt(i));
    const last = message({ groupId: gid, senderId: fan, content: text(120) });
    data.push({ groupId: gid, unreadCount: i % 3, partnerAccountId: fan, partnerUsername: `fan${i}`, flags: 0, subscriptionTierId: null, lastMessageId: last.id, lastUnreadMessageId: last.id });
    groups.push({ id: gid, type: 1, groupFlags: 0, createdBy: fan, users: [{ groupId: gid, userId: CREATOR, permissionFlags: 0, dmPermissionFlags: 0 }, { groupId: gid, userId: fan, permissionFlags: 0, dmPermissionFlags: 0 }], lastMessage: last, userSettings: { customName: null, hidden: false }, dmPermissionFlags: [], accountDmPermissionFlags: { flags: 0, metadata: '{}' } });
    accounts.push(account(fan));
  }
  const body = { success: true, response: { data, aggregationData: { groups, accounts, accountMedia: [], accountMediaBundles: [] } } };
  let json = JSON.stringify(body);
  let k = 0;
  while (json.length < bytes) {
    body.response.aggregationData.accountMedia.push({ id: snowflake(), accountId: CREATOR, previewId: null, permissionFlags: 0, price: 0, createdAt: 1700000000, deleted: false, media: account(String(500000000000000000n + BigInt((k += 1)))).avatar });
    json = JSON.stringify(body);
  }
  return json;
}

export function historyResponse(groupId, fanId, count) {
  const msgs = [];
  for (let i = 0; i < count; i += 1) msgs.push(message({ groupId, senderId: i % 2 ? fanId : CREATOR, content: text(30 + ((i * 53) % 300)), createdAt: Date.now() / 1000 - (count - i) * 60 }));
  return JSON.stringify({ success: true, response: { messages: msgs.reverse(), tips: [], stories: [], accountMedia: [] } });
}

export function groupResponse(groupId, fanId) {
  return JSON.stringify({ success: true, response: { id: groupId, type: 1, groupFlags: 0, createdBy: fanId, users: [{ groupId, userId: CREATOR, permissionFlags: 0, dmPermissionFlags: 0 }, { groupId, userId: fanId, permissionFlags: 0, dmPermissionFlags: 0 }], lastMessage: null, userSettings: { customName: null, hidden: false }, dmPermissionFlags: [], accountDmPermissionFlags: { flags: 0, metadata: '{}' }, hasDmPermissionFlags: false, sendReadReceipts: true } });
}
