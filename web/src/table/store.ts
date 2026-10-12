/**
 * Table state. Server snapshot/events are the source of truth; local-only UI state (tool, selection,
 * camera) lives alongside but is never sent. High-frequency pointer state stays inside the canvas engine.
 */
import { create } from 'zustand';
import type { SessionSnapshot, ServerEvent, TokenView, MapView, FogRegionView, DrawingView, ChatView, InitiativeView, MemberView } from '../../../shared/protocol';

export type Tool = 'select' | 'pan' | 'measure' | 'draw' | 'erase' | 'token' | 'fog' | 'ping';
export type ConnState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface Ping { id: number; x: number; y: number; color: string; at: number }
export interface TableState {
  loaded: boolean;
  me: SessionSnapshot['me'] | null;
  session: SessionSnapshot['session'] | null;
  members: MemberView[];
  map: MapView | null;
  tokens: Record<string, TokenView>;
  fog: FogRegionView[];
  drawings: DrawingView[];
  initiative: InitiativeView;
  chat: ChatView[];
  conn: ConnState;
  pending: number;
  seq: number;
  tool: Tool;
  selectedId: string | null;
  pings: Ping[];
  toast: { text: string; kind: 'error' | 'info'; at: number } | null;
  // contextual tool options
  drawColor: string; drawWidth: number; drawGmOnly: boolean; drawTemporary: boolean;
  fogMode: 'reveal' | 'hide';
  newToken: { name: string; category: string; color: string };
  fatalError: string | null;
  panelTab: 'chat' | 'turns' | 'party' | 'sheets';
  openCharacterId: string | null;
}

const emptyInit: InitiativeView = { round: 1, turnIndex: 0, active: false, activeId: null, participants: [] };
export const useTable = create<TableState>(() => ({
  loaded: false, me: null, session: null, members: [], map: null, tokens: {}, fog: [], drawings: [], initiative: emptyInit, chat: [],
  conn: 'connecting', pending: 0, seq: 0, tool: 'select', selectedId: null, pings: [], toast: null,
  drawColor: '#e0a95b', drawWidth: 4, drawGmOnly: false, drawTemporary: false, fogMode: 'reveal',
  newToken: { name: 'Token', category: 'npc', color: '#c0392b' }, fatalError: null,
  panelTab: 'chat', openCharacterId: null,
}));

export const isGm = (s: Pick<TableState, 'me'>) => !!s.me && ['owner', 'gm', 'assistant_gm'].includes(s.me.role);
export const toast = (text: string, kind: 'error' | 'info' = 'error') => useTable.setState({ toast: { text, kind, at: Date.now() } });

export function applySnapshot(s: SessionSnapshot) {
  useTable.setState((st) => ({
    loaded: true, me: s.me, session: s.session, members: s.members, map: s.map, fog: s.fog, drawings: s.drawings, initiative: s.initiative, chat: s.chat, seq: s.seq,
    tokens: Object.fromEntries(s.tokens.map((t) => [t.id, t])),
    selectedId: st.selectedId && s.tokens.some((t) => t.id === st.selectedId) ? st.selectedId : null,
  }));
}

let pingId = 0;
export function applyEvent(seq: number, e: ServerEvent) {
  useTable.setState((st) => {
    const next: Partial<TableState> = { seq: Math.max(st.seq, seq) };
    switch (e.type) {
      case 'token.upsert': next.tokens = { ...st.tokens, [e.token.id]: e.token }; break;
      case 'token.remove': { const t = { ...st.tokens }; delete t[e.id]; next.tokens = t; if (st.selectedId === e.id) next.selectedId = null; break; }
      case 'map.updated': next.map = e.map; break;
      case 'fog.updated': next.fog = e.fog; if (st.map) next.map = { ...st.map, fogEnabled: e.fogEnabled }; break;
      case 'drawing.added': next.drawings = [...st.drawings.filter((d) => d.id !== e.drawing.id), e.drawing]; break;
      case 'drawing.removed': next.drawings = st.drawings.filter((d) => !e.ids.includes(d.id)); break;
      case 'chat.message': next.chat = [...st.chat, e.message].slice(-300); break;
      case 'initiative.updated': next.initiative = e.initiative; break;
      case 'presence': next.members = e.members; break;
      case 'ping': next.pings = [...st.pings.filter((p) => Date.now() - p.at < 3000), { id: ++pingId, x: e.x, y: e.y, color: e.color, at: Date.now() }]; break;
      case 'session.status': if (st.session) next.session = { ...st.session, status: e.status }; break;
    }
    return next;
  });
}
