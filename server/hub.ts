/**
 * Realtime hub: one room per game session. Commands for a room are applied strictly one at a time,
 * so every client observes the same order. Each outgoing event is filtered per recipient (role,
 * ownership, fog) so secret data never reaches a socket that shouldn't have it.
 */
import type { WebSocket } from 'ws';
import { ClientMessage, type ServerMessage, type ServerEvent } from '../shared/protocol';
import { isGmRole, type Role } from '../shared/permissions';
import { Services, CommandError, type Effect, type Audience } from './services';
import { HttpError } from './errors';
import { canReadEntry } from '../shared/journal';
import type { JournalChange } from './journal';

interface Conn { ws: WebSocket; userId: string; role: Role; known: Set<string>; cids: Map<string, Promise<ServerMessage>>; bucket: number; last: number }
/** cids are remembered per user per room (not per socket) so a command resent after a reconnect is still recognised. */
interface Room { conns: Set<Conn>; queue: Promise<unknown>; cids: Map<string, Map<string, Promise<ServerMessage>>>; campaignId?: string }

const RATE = 20, BURST = 60; // commands per second, burst size
const CID_MEMORY = 256;

export class Hub {
  rooms = new Map<string, Room>();
  constructor(private svc: Services) {}

  private room(id: string): Room {
    let r = this.rooms.get(id);
    if (!r) { r = { conns: new Set(), queue: Promise.resolve(), cids: new Map() }; this.rooms.set(id, r); }
    return r;
  }
  online(sessionId: string) { return new Set([...(this.rooms.get(sessionId)?.conns ?? [])].map((c) => c.userId)); }

  async join(ws: WebSocket, userId: string, sessionId: string) {
    const room = this.room(sessionId);
    const online = this.online(sessionId); online.add(userId);
    const snapshot = await this.svc.snapshot(userId, sessionId, online);
    room.campaignId = snapshot.session.campaignId;
    if (!room.cids.has(userId)) room.cids.set(userId, new Map());
    const conn: Conn = { ws, userId, role: snapshot.me.role as Role, known: new Set(snapshot.tokens.map((t) => t.id)), cids: room.cids.get(userId)!, bucket: BURST, last: Date.now() };
    room.conns.add(conn);
    send(ws, { type: 'snapshot', snapshot });
    this.presence(sessionId).catch(() => undefined);
    ws.on('message', (raw) => this.onMessage(conn, sessionId, raw.toString()));
    ws.on('close', () => {
      room.conns.delete(conn);
      if (room.conns.size) this.presence(sessionId).catch(() => undefined);
      else setTimeout(() => { if (!room.conns.size && this.rooms.get(sessionId) === room) this.rooms.delete(sessionId); }, 5 * 60_000).unref?.();
    });
  }

  private onMessage(conn: Conn, sessionId: string, raw: string) {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return send(conn.ws, { type: 'ack', cid: '?', ok: false, code: 'invalid', error: 'Malformed message' }); }
    const msg = ClientMessage.safeParse(parsed);
    const cid = typeof (parsed as any)?.cid === 'string' ? String((parsed as any).cid).slice(0, 64) : '?';
    if (!msg.success) return send(conn.ws, { type: 'ack', cid, ok: false, code: 'invalid', error: msg.error.issues[0]?.message ?? 'Invalid command' });
    const now = Date.now();
    conn.bucket = Math.min(BURST, conn.bucket + ((now - conn.last) / 1000) * RATE); conn.last = now;
    if (conn.bucket < 1) return send(conn.ws, { type: 'ack', cid, ok: false, code: 'rate_limited', error: 'Slow down' });
    conn.bucket -= 1;
    const dup = conn.cids.get(cid);
    // Duplicate (retry after a flaky connection, or still in flight): answer with the original result, never re-apply.
    if (dup) { dup.then((m) => send(conn.ws, m)); return; }
    const room = this.room(sessionId);
    const result = room.queue.then(async (): Promise<ServerMessage> => {
      try {
        const { seq, effects } = await this.svc.applyCommand(conn.userId, sessionId, msg.data.cmd);
        const ack: ServerMessage = { type: 'ack', cid, ok: true, seq };
        send(conn.ws, ack);
        await this.deliver(sessionId, seq, effects);
        return ack;
      } catch (e) {
        let ack: ServerMessage;
        if (e instanceof CommandError) ack = { type: 'ack', cid, ok: false, code: e.code, error: e.message, ...(e.current ? { current: e.current } : {}) };
        else if (e instanceof HttpError) ack = { type: 'ack', cid, ok: false, code: e.status === 403 ? 'forbidden' : 'not_found', error: e.message };
        else { console.error('command failed', msg.data.cmd.type, (e as Error).message); ack = { type: 'ack', cid, ok: false, code: 'invalid', error: 'Server error' }; }
        send(conn.ws, ack);
        return ack;
      }
    });
    remember(conn, cid, result);
    room.queue = result;
  }

  /** Broadcast effects produced outside the socket path (e.g. HTTP uploads). */
  async deliver(sessionId: string, seq: number, effects: Effect[]) {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    for (const eff of effects) {
      if (eff.kind === 'event') {
        for (const c of room.conns) if (inAudience(c, eff.audience)) send(c.ws, { type: 'event', seq, event: eff.event });
      } else if (eff.kind === 'tokens') {
        for (const c of room.conns) {
          for (const { token, revealed } of eff.tokens) {
            if (Services.tokenVisibleTo(c.role, c.userId, token, revealed)) { c.known.add(token.id); send(c.ws, { type: 'event', seq, event: { type: 'token.upsert', token } }); }
            else if (c.known.delete(token.id)) send(c.ws, { type: 'event', seq, event: { type: 'token.remove', id: token.id } });
          }
          for (const id of eff.removedIds) if (c.known.delete(id) || isGmRole(c.role)) send(c.ws, { type: 'event', seq, event: { type: 'token.remove', id } });
        }
      } else if (eff.kind === 'initiative') {
        const full = await this.svc.initiativeFull(sessionId);
        for (const c of room.conns) send(c.ws, { type: 'event', seq, event: { type: 'initiative.updated', initiative: this.svc.filterInitiative(full, c.role) } });
      }
    }
  }

  /**
   * Fan a journal change out to every open table of the campaign. Each socket gets the new entry only if
   * it may read it; sockets that could read the old version but not the new one are told to drop it.
   */
  journalChanged(ch: JournalChange) {
    for (const room of this.rooms.values()) {
      if (room.campaignId !== ch.campaignId) continue;
      for (const c of room.conns) {
        if (ch.after && canReadEntry(c.role, c.userId, ch.after)) send(c.ws, { type: 'event', seq: 0, event: { type: 'journal.upsert', entry: ch.after } });
        else if (ch.before && canReadEntry(c.role, c.userId, ch.before)) send(c.ws, { type: 'event', seq: 0, event: { type: 'journal.remove', id: ch.before.id } });
      }
    }
  }

  broadcast(sessionId: string, event: ServerEvent, seq = 0) {
    for (const c of this.rooms.get(sessionId)?.conns ?? []) send(c.ws, { type: 'event', seq, event });
  }

  /** Re-sync every socket in a session from scratch (used after status changes). */
  async resync(sessionId: string) {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    const online = this.online(sessionId);
    for (const c of room.conns) {
      try { const snapshot = await this.svc.snapshot(c.userId, sessionId, online); c.role = snapshot.me.role as Role; c.known = new Set(snapshot.tokens.map((t) => t.id)); send(c.ws, { type: 'snapshot', snapshot }); }
      catch { c.ws.close(4404, 'gone'); }
    }
  }

  private async presence(sessionId: string) {
    const room = this.rooms.get(sessionId);
    if (!room || !room.conns.size) return;
    const any = [...room.conns][0];
    const snap = await this.svc.snapshot(any.userId, sessionId, this.online(sessionId));
    this.broadcast(sessionId, { type: 'presence', members: snap.members });
  }
}

function inAudience(c: Conn, a: Audience) {
  switch (a.kind) {
    case 'all': return true;
    case 'gm': return isGmRole(c.role);
    case 'users': return a.ids.includes(c.userId);
    case 'gmAndUsers': return isGmRole(c.role) || a.ids.includes(c.userId);
  }
}
function remember(c: Conn, cid: string, m: Promise<ServerMessage>) {
  c.cids.set(cid, m);
  if (c.cids.size > CID_MEMORY) c.cids.delete(c.cids.keys().next().value as string);
}
function send(ws: WebSocket, m: ServerMessage) { if (ws.readyState === 1) ws.send(JSON.stringify(m)); }
