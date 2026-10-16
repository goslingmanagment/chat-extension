// The fake Fansly's commands (fixture-fansly/src/server-protocol.ts
// FakeFanslyCommand): what a test scripts — a fan writes or types, a message is
// deleted, a receipt comes, somebody follows, a group changes, the socket
// closes or stalls, the API answers 429. Each command changes the world first
// and then tells the page's sockets the way Fansly would; `silent` skips the
// frame (the socket «lost» the event). In-process (`FakeFansly.command`) and
// over HTTP (api.ts, the control header) alike.

import type { FakeFanslyCommand, FakeFanslyResult, FakeFanslyStatus } from '../../fixture-fansly/src/server-protocol';
import { EVENT, SERVICE, ackFrame, followFrame, groupUserFrame, messageCreatedFrame, messageDeletedFrame, serviceFrame, typingFrame } from '../../fixture-fansly/src/wire';
import type { FakeGroup } from './data';
import type { FanslySocketHub } from './socket';
import type { FanslyState } from './state';

/** A command the world cannot carry out (an unknown group or message): HTTP 400 over the control endpoint. */
export class FakeFanslyCommandError extends Error {}

function groupOf(state: FanslyState, groupId: string): FakeGroup {
  const group = state.world.groups.get(groupId);
  if (group === undefined) throw new FakeFanslyCommandError(`no group ${groupId}`);
  return group;
}

export function statusOf(state: FanslyState, hub: FanslySocketHub): FakeFanslyStatus {
  return { creatorId: state.world.creatorId, token: state.token, sockets: hub.views(), connections: hub.count, rules: state.pendingRules };
}

export function runCommand(state: FanslyState, hub: FanslySocketHub, command: FakeFanslyCommand): FakeFanslyResult {
  const world = state.world;
  switch (command.op) {
    case 'reset': {
      hub.closeAll();
      state.reset();
      return { ok: true };
    }
    case 'status':
      return { ok: true, status: statusOf(state, hub) };
    case 'message': {
      const group = groupOf(state, command.groupId);
      const from = command.from ?? 'fan';
      const senderId = from === 'creator' ? world.creatorId : from === 'fan' ? group.fanId : from;
      if (senderId === null) throw new FakeFanslyCommandError(`group ${group.id} has no fan`);
      const message = world.addMessage({
        groupId: group.id,
        senderId,
        content: command.text,
        ...(command.type !== undefined ? { type: command.type } : {}),
        ...(command.correlationId !== undefined ? { correlationId: command.correlationId } : {}),
        ...(command.inReplyTo !== undefined ? { inReplyTo: command.inReplyTo } : {}),
        ...(command.createdAt !== undefined ? { createdAt: command.createdAt } : {}),
        ...(command.id !== undefined ? { id: command.id } : {}),
      });
      const wire = world.wireMessage(message);
      return { ok: true, message: wire, sent: command.silent === true ? 0 : hub.emit([messageCreatedFrame(wire)], '5/1') };
    }
    case 'broadcast': {
      for (const groupId of command.groupIds) groupOf(state, groupId);
      const { parent, copies } = world.broadcast(command.text, command.groupIds);
      const wires = copies.map((copy) => world.wireMessage(copy));
      const parentWire = world.wireMessage(parent);
      const sent = command.silent === true ? 0 : hub.emit([parentWire, ...wires].map(messageCreatedFrame), '5/1 mass send');
      return { ok: true, message: parentWire, messages: wires, sent };
    }
    case 'delete': {
      // The frame carries the message as it was: its `type` decides the page's cascade.
      const known = world.messages.get(command.messageId);
      if (known === undefined) throw new FakeFanslyCommandError(`no message ${command.messageId}`);
      const wire = world.wireMessage(known);
      const removed = world.deleteMessage(command.messageId);
      const cascade = (removed?.cascade ?? []).map((message) => world.wireMessage(message));
      return { ok: true, message: wire, messages: cascade, sent: command.silent === true ? 0 : hub.emit([messageDeletedFrame(wire)], '5/10') };
    }
    case 'ack': {
      const first = world.messages.get(command.messageIds[0] ?? '');
      const reader = command.userId ?? (first === undefined ? null : (world.groups.get(first.groupId)?.fanId ?? null));
      if (reader === null) throw new FakeFanslyCommandError('no reader for the receipt: name `userId` or a known message');
      const type = command.type ?? 2;
      world.ack(reader, command.messageIds, type);
      return { ok: true, sent: hub.emit([ackFrame({ type, userId: reader, messageIds: [...command.messageIds] })], '4/2') };
    }
    case 'typing': {
      const group = groupOf(state, command.groupId);
      const accountId = command.accountId ?? group.fanId;
      if (accountId === null) throw new FakeFanslyCommandError(`group ${group.id} has no fan`);
      return { ok: true, sent: hub.emit([typingFrame(group.id, accountId)], '5/22') };
    }
    case 'follow': {
      const follow = world.wireFollow(world.follow(command.followerId));
      return { ok: true, follow, sent: command.silent === true ? 0 : hub.emit([followFrame(follow)], '3/2') };
    }
    case 'group': {
      const group = groupOf(state, command.groupId);
      let sent = 0;
      if (command.partners !== undefined) {
        const { added, removed } = world.setPartners(group, command.partners);
        const frames = [...added.map((userId) => groupUserFrame(world.wireGroupUser(group, userId), true)), ...removed.map((userId) => groupUserFrame(world.wireGroupUser(group, userId), false))];
        if (frames.length > 0) sent = hub.emit(frames, '4/6 4/7');
      }
      if (command.dmRulesUnmet !== undefined) group.dmRulesUnmet = command.dmRulesUnmet;
      if (command.status !== undefined && group.fanId !== null) world.ensureAccount(group.fanId).statusId = command.status;
      return { ok: true, sent };
    }
    case 'note':
      return { ok: true, noteId: world.createNote(command.fanId, command.contentType ?? 12000, command.title, command.note).id };
    case 'frames':
      return { ok: true, sent: hub.emit(command.frames, 'raw', command.batch === true) };
    case 'socket': {
      if (command.pong !== undefined) state.socket.pong = command.pong;
      if (command.verify !== undefined) state.socket.verify = command.verify;
      if (command.verifyDelayMs !== undefined) state.socket.verifyDelayMs = command.verifyDelayMs;
      if (command.stall !== undefined) state.socket.stall = command.stall;
      return { ok: true, ...(command.close === true ? { sent: hub.closeAll() } : {}) };
    }
    case 'api':
      state.script(command.rules);
      return { ok: true };
    case 'send': {
      if (command.echo !== undefined) state.send.echo = command.echo;
      if (command.receiptDelayMs !== undefined) state.send.receiptDelayMs = command.receiptDelayMs;
      if (command.echoDelayMs !== undefined) state.send.echoDelayMs = command.echoDelayMs;
      return { ok: true };
    }
    case 'session': {
      if (command.expire === true) {
        state.expired = true;
        hub.expire();
      }
      return { ok: true, ...(command.issue !== undefined ? { token: state.issue(command.issue) } : {}) };
    }
    default:
      throw new FakeFanslyCommandError(`no such command: ${JSON.stringify(command)}`);
  }
}

/** `4/8`: a group was created; the page asks for it by its id (`onGroupCreate` → `GET /group/<id>/`, main:29170-29177). */
export const groupCreatedFrame = (groupId: string): string => serviceFrame(SERVICE.group, { type: EVENT.group.created, id: groupId });
