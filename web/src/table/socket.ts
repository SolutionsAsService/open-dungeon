/**
 * WebSocket client with reconnect, an outbox of unacknowledged commands (resent with the same id after
 * reconnecting, so the server can de-duplicate), and optimistic token moves with rollback.
 */
import type { Command, ServerMessage, TokenView } from '../../../shared/protocol';
import { useTable, applySnapshot, applyEvent, toast } from './store';
import { localModeSync } from '../local/mode';
import { LocalWebSocket } from '../local/backend';

type Ack = Extract<ServerMessage, { type: 'ack' }>;
interface Pending { msg: string; resolve: (a: Ack) => void; cmd: Command }

export class TableSocket {
  private ws: WebSocket | LocalWebSocket | null = null;
  private outbox = new Map<string, Pending>();
  private attempt = 0;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private counter = 0;
  private readonly clientId = Math.random().toString(36).slice(2, 10);

  constructor(private sessionId: string) {}

  connect() {
    this.closed = false;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws: WebSocket | LocalWebSocket = localModeSync()
      ? new LocalWebSocket(this.sessionId)
      : new WebSocket(proto + '//' + location.host + '/ws?session=' + encodeURIComponent(this.sessionId));
    this.ws = ws;
    useTable.setState({ conn: this.attempt === 0 ? 'connecting' : 'reconnecting' });
    ws.onmessage = (ev: { data: string }) => this.onMessage(JSON.parse(ev.data));
    ws.onclose = (ev: { code: number }) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closed) return;
      if (ev.code === 4404 || (this.attempt > 2 && !useTable.getState().loaded)) {
        useTable.setState({ fatalError: 'This session does not exist or you are not a member of its campaign.', conn: 'offline' });
        return;
      }
      useTable.setState({ conn: navigator.onLine ? 'reconnecting' : 'offline' });
      const delay = Math.min(5000, 300 * 2 ** this.attempt++);
      this.timer = setTimeout(() => this.connect(), delay);
    };
    addEventListener('online', this.onOnline);
  }
  private onOnline = () => { if (!this.ws && !this.closed) { if (this.timer) clearTimeout(this.timer); this.connect(); } };

  close() { this.closed = true; if (this.timer) clearTimeout(this.timer); removeEventListener('online', this.onOnline); this.ws?.close(); }

  private onMessage(m: ServerMessage) {
    if (m.type === 'snapshot') {
      this.attempt = 0;
      applySnapshot(m.snapshot);
      useTable.setState({ conn: 'connected' });
      // Re-send anything the server never acknowledged; same cid means it won't be applied twice.
      for (const p of this.outbox.values()) this.ws?.send(p.msg);
      this.sync();
    } else if (m.type === 'event') {
      applyEvent(m.seq, m.event);
    } else if (m.type === 'ack') {
      const p = this.outbox.get(m.cid);
      if (!p) return;
      this.outbox.delete(m.cid);
      this.sync();
      p.resolve(m);
    }
  }
  private sync() { useTable.setState({ pending: this.outbox.size }); }

  send(cmd: Command): Promise<Ack> {
    const cid = this.clientId + '-' + ++this.counter;
    const msg = JSON.stringify({ cid, cmd });
    return new Promise<Ack>((resolve) => {
      this.outbox.set(cid, { msg, resolve, cmd });
      this.sync();
      if (this.ws?.readyState === 1) this.ws.send(msg);
    }).then((a) => {
      if (!a.ok && a.code !== 'stale') toast(a.error);
      return a;
    });
  }

  /** Optimistic move: render immediately, roll back if the server refuses. */
  async moveToken(id: string, x: number, y: number) {
    const before = useTable.getState().tokens[id];
    if (!before) return;
    useTable.setState((s) => ({ tokens: { ...s.tokens, [id]: { ...before, x, y } } }));
    const a = await this.send({ type: 'token.move', id, x, y, baseVersion: before.version });
    if (a.ok) return;
    if (a.code === 'stale' && a.current) { useTable.setState((s) => ({ tokens: { ...s.tokens, [id]: a.current as TokenView } })); toast('Someone moved that token first; it snapped to their position.', 'info'); }
    else useTable.setState((s) => (s.tokens[id] ? { tokens: { ...s.tokens, [id]: before } } : {}));
  }
}
