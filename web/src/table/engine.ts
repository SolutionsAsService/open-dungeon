/**
 * The tabletop renderer and pointer/keyboard interaction layer (PixiJS).
 * - World coordinates are map pixels; the camera is a translate+scale on the world container.
 * - Persistent state comes from the store; drag previews, rulers and box drags are local until committed.
 * - Layers (bottom→top): background, grid, drawings, tokens, measure, fog, selection/fx.
 * React never re-renders on pointer movement; this class redraws only dirty layers per animation frame.
 */
import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { useTable, isGm, type TableState } from './store';
import type { TableSocket } from './socket';
import { assetUrl } from '../api';
import { GridConfig, worldToCell, cellCenter, hexCorners, snapPoint, measurePath, type Point } from '../../../shared/grid';
import { canEditToken, type Role } from '../../../shared/permissions';
import type { TokenView, DrawingShape } from '../../../shared/protocol';

const hex = (c: string) => parseInt(c.slice(1), 16);
const MIN_ZOOM = 0.1, MAX_ZOOM = 6;

type Drag =
  | { kind: 'pan'; sx: number; sy: number; cx: number; cy: number }
  | { kind: 'token'; id: string; offX: number; offY: number; start: Point; moved: boolean }
  | { kind: 'draw'; points: Point[] }
  | { kind: 'fog'; start: Point; end: Point }
  | { kind: 'measure'; dragging: boolean; downAt: Point };

export class TableEngine {
  app = new Application();
  world = new Container();
  private bg = new Container();
  private grid = new Graphics();
  private drawingsG = new Graphics();
  private drawingTexts = new Container();
  private tokensC = new Container();
  private measureG = new Graphics();
  private measureLabel = new Text({ text: '', style: { fill: '#ffffff', fontSize: 16, fontWeight: '700', stroke: { color: '#000000', width: 4 } } });
  private fogSprite = new Sprite();
  private fogCanvas = document.createElement('canvas');
  private fx = new Graphics();
  private tokenViews = new Map<string, { c: Container; ring: Graphics; label: Text; sprite?: Sprite; assetId: string | null; key: string }>();
  private bgSprite: Sprite | null = null;
  private bgAsset: string | null = null;
  private textures = new Map<string, Promise<Texture>>();
  private dirty = { grid: true, tokens: true, drawings: true, fog: true, measure: true, bg: true };
  private cam = { x: 0, y: 0, scale: 1 };
  private drag: Drag | null = null;
  private ruler: Point[] = [];
  private rulerHover: Point | null = null;
  private preview: { id: string; x: number; y: number } | null = null;
  private unsub: (() => void) | null = null;
  private el!: HTMLElement;
  private destroyed = false;
  private fitted = false;

  constructor(private socket: TableSocket) {}

  async init(el: HTMLElement) {
    this.el = el;
    await this.app.init({ resizeTo: el, background: '#0f0d0b', antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1), preference: 'webgl' });
    if (this.destroyed) { this.app.destroy(true); return; }
    el.appendChild(this.app.canvas);
    this.app.canvas.setAttribute('aria-label', 'Tabletop map. Use the toolbar and the token inspector for keyboard-accessible controls.');
    this.app.canvas.setAttribute('role', 'application');
    this.app.canvas.tabIndex = 0;
    this.app.canvas.style.touchAction = 'none';
    this.world.addChild(this.bg, this.grid, this.drawingsG, this.drawingTexts, this.tokensC, this.measureG, this.measureLabel, this.fogSprite, this.fx);
    this.app.stage.addChild(this.world);
    this.unsub = useTable.subscribe((s, prev) => this.onState(s, prev));
    this.onState(useTable.getState(), {} as TableState);
    const c = this.app.canvas;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onUp);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('contextmenu', (e) => { e.preventDefault(); this.ruler = []; this.dirty.measure = true; });
    c.addEventListener('keydown', this.onKey);
    this.app.ticker.add(() => this.frame());
    (window as any).__odTable = { worldToScreen: (p: Point) => this.worldToScreen(p), camera: () => ({ ...this.cam }), engine: this };
  }

  destroy() {
    this.destroyed = true;
    this.unsub?.();
    try { this.app.destroy(true, { children: true }); } catch { /* not initialised yet */ }
  }

  // ---------- camera ----------
  screenToWorld(sx: number, sy: number): Point { return { x: (sx - this.cam.x) / this.cam.scale, y: (sy - this.cam.y) / this.cam.scale }; }
  worldToScreen(p: Point) { const r = this.app.canvas.getBoundingClientRect(); return { x: r.left + p.x * this.cam.scale + this.cam.x, y: r.top + p.y * this.cam.scale + this.cam.y }; }
  private applyCam() { this.world.position.set(this.cam.x, this.cam.y); this.world.scale.set(this.cam.scale); this.dirty.grid = true; }
  zoomAt(sx: number, sy: number, factor: number) {
    const s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.cam.scale * factor));
    const w = this.screenToWorld(sx, sy);
    this.cam.scale = s; this.cam.x = sx - w.x * s; this.cam.y = sy - w.y * s; this.applyCam();
  }
  zoomBy(f: number) { this.zoomAt(this.app.screen.width / 2, this.app.screen.height / 2, f); }
  fit() {
    const m = useTable.getState().map; if (!m) return;
    const W = this.app.screen.width, H = this.app.screen.height;
    const s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(W / m.width, H / m.height) * 0.95));
    this.cam = { scale: s, x: (W - m.width * s) / 2, y: (H - m.height * s) / 2 }; this.applyCam();
  }
  centerOn(p: Point) { this.cam.x = this.app.screen.width / 2 - p.x * this.cam.scale; this.cam.y = this.app.screen.height / 2 - p.y * this.cam.scale; this.applyCam(); }
  centerOnSelected() { const s = useTable.getState(); const t = s.selectedId ? s.tokens[s.selectedId] : null; if (t) this.centerOn(t); }

  // ---------- state ----------
  private onState(s: TableState, p: TableState) {
    if (s.map !== p.map) { this.dirty.grid = this.dirty.bg = this.dirty.fog = this.dirty.tokens = this.dirty.drawings = true; if (s.map && !this.fitted && this.app.renderer) { this.fitted = true; requestAnimationFrame(() => this.fit()); } }
    if (s.tokens !== p.tokens || s.selectedId !== p.selectedId || s.initiative !== p.initiative) this.dirty.tokens = true;
    if (s.drawings !== p.drawings) this.dirty.drawings = true;
    if (s.fog !== p.fog || s.me !== p.me) this.dirty.fog = true;
    if (s.pings !== p.pings) this.dirty.measure = true;
    if (s.tool !== p.tool) { this.ruler = []; this.dirty.measure = true; this.app.canvas.style.cursor = s.tool === 'pan' ? 'grab' : s.tool === 'select' ? 'default' : 'crosshair'; }
  }
  private gridCfg(): GridConfig { return useTable.getState().map?.grid ?? GridConfig.parse({}); }

  private frame() {
    const s = useTable.getState();
    if (this.dirty.bg) { this.dirty.bg = false; this.drawBackground(s); }
    if (this.dirty.grid) { this.dirty.grid = false; this.drawGrid(s); }
    if (this.dirty.drawings) { this.dirty.drawings = false; this.drawDrawings(s); }
    if (this.dirty.tokens) { this.dirty.tokens = false; this.drawTokens(s); }
    if (this.dirty.fog) { this.dirty.fog = false; this.drawFog(s); }
    this.drawMeasureAndFx(s);
  }

  private loadTexture(assetId: string): Promise<Texture> {
    let t = this.textures.get(assetId);
    if (!t) {
      t = new Promise<Texture>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(Texture.from(img));
        img.onerror = reject;
        img.src = assetUrl(assetId);
      });
      this.textures.set(assetId, t);
    }
    return t;
  }

  private drawBackground(s: TableState) {
    const m = s.map; if (!m) return;
    this.bg.removeChildren();
    const plate = new Graphics().rect(0, 0, m.width, m.height).fill({ color: 0x2b2420 });
    this.bg.addChild(plate);
    if (m.backgroundAssetId) {
      if (this.bgAsset !== m.backgroundAssetId) { this.bgSprite = null; this.bgAsset = m.backgroundAssetId; }
      this.loadTexture(m.backgroundAssetId).then((tex) => {
        if (this.bgAsset !== m.backgroundAssetId) return;
        this.bgSprite = new Sprite(tex);
        const cur = useTable.getState().map!;
        this.bgSprite.width = cur.width; this.bgSprite.height = cur.height;
        this.bg.addChild(this.bgSprite);
      }).catch(() => undefined);
    } else this.bgAsset = null;
  }

  private drawGrid(s: TableState) {
    const g = this.grid; g.clear();
    const m = s.map; if (!m || !m.grid.visible || m.grid.type === 'none') return;
    const cfg = m.grid;
    // only draw the visible part of the map (viewport culling)
    const tl = this.screenToWorld(0, 0), br = this.screenToWorld(this.app.screen.width, this.app.screen.height);
    const x0 = Math.max(0, tl.x), y0 = Math.max(0, tl.y), x1 = Math.min(m.width, br.x), y1 = Math.min(m.height, br.y);
    if (x1 <= x0 || y1 <= y0) return;
    const color = hex(cfg.color), width = 1 / this.cam.scale;
    if (cfg.type === 'square') {
      const s0 = cfg.cellSize;
      if (s0 * this.cam.scale < 4) return;
      for (let x = cfg.offsetX + Math.ceil((x0 - cfg.offsetX) / s0) * s0; x <= x1; x += s0) g.moveTo(x, y0).lineTo(x, y1);
      for (let y = cfg.offsetY + Math.ceil((y0 - cfg.offsetY) / s0) * s0; y <= y1; y += s0) g.moveTo(x0, y).lineTo(x1, y);
      g.stroke({ width, color, alpha: cfg.opacity });
    } else {
      const a = worldToCell(cfg, { x: x0, y: y0 }), b = worldToCell(cfg, { x: x1, y: y1 }), c = worldToCell(cfg, { x: x1, y: y0 }), d = worldToCell(cfg, { x: x0, y: y1 });
      const qs = [a.a, b.a, c.a, d.a], rs = [a.b, b.b, c.b, d.b];
      let count = 0;
      for (let q = Math.min(...qs) - 2; q <= Math.max(...qs) + 2; q++) for (let r = Math.min(...rs) - 2; r <= Math.max(...rs) + 2; r++) {
        const ctr = cellCenter(cfg, { a: q, b: r });
        if (ctr.x < x0 - cfg.cellSize || ctr.x > x1 + cfg.cellSize || ctr.y < y0 - cfg.cellSize || ctr.y > y1 + cfg.cellSize) continue;
        if (++count > 20000) break;
        const pts = hexCorners(cfg, { a: q, b: r });
        g.poly(pts.flatMap((p) => [p.x, p.y]), true);
      }
      g.stroke({ width, color, alpha: cfg.opacity });
    }
  }

  private drawDrawings(s: TableState) {
    const g = this.drawingsG; g.clear(); this.drawingTexts.removeChildren();
    for (const d of s.drawings) this.paintShape(g, d.shape, d.gmOnly ? 0.6 : 1);
  }
  private paintShape(g: Graphics, sh: DrawingShape, alpha = 1) {
    if (sh.kind === 'text') {
      const t = new Text({ text: sh.text, style: { fill: sh.color, fontSize: sh.size, stroke: { color: '#000000', width: 3 } } });
      t.position.set(sh.x, sh.y); t.alpha = alpha; this.drawingTexts.addChild(t); return;
    }
    const stroke = { width: sh.width, color: hex(sh.color), alpha, cap: 'round' as const, join: 'round' as const };
    if (sh.kind === 'path') { g.moveTo(sh.points[0].x, sh.points[0].y); for (const p of sh.points.slice(1)) g.lineTo(p.x, p.y); g.stroke(stroke); }
    else if (sh.kind === 'line') {
      g.moveTo(sh.from.x, sh.from.y).lineTo(sh.to.x, sh.to.y).stroke(stroke);
      if (sh.arrow) { const a = Math.atan2(sh.to.y - sh.from.y, sh.to.x - sh.from.x), L = 6 + sh.width * 3; g.moveTo(sh.to.x, sh.to.y).lineTo(sh.to.x - L * Math.cos(a - 0.5), sh.to.y - L * Math.sin(a - 0.5)).moveTo(sh.to.x, sh.to.y).lineTo(sh.to.x - L * Math.cos(a + 0.5), sh.to.y - L * Math.sin(a + 0.5)).stroke(stroke); }
    }
    else if (sh.kind === 'rect') g.rect(Math.min(sh.x, sh.x + sh.w), Math.min(sh.y, sh.y + sh.h), Math.abs(sh.w), Math.abs(sh.h)).stroke(stroke);
    else if (sh.kind === 'circle') g.circle(sh.x, sh.y, sh.r).stroke(stroke);
  }

  private tokenRadius(t: TokenView) { return (this.gridCfg().cellSize * t.size) / 2; }
  private drawTokens(s: TableState) {
    const seen = new Set<string>();
    const activeTokenId = s.initiative.active ? s.initiative.participants.find((p) => p.id === s.initiative.activeId)?.tokenId ?? null : null;
    const gm = isGm(s);
    for (const t of Object.values(s.tokens)) {
      seen.add(t.id);
      let v = this.tokenViews.get(t.id);
      if (!v) {
        const c = new Container(); const ring = new Graphics();
        const label = new Text({ text: '', style: { fill: '#ffffff', fontSize: 13, fontWeight: '600', stroke: { color: '#000000', width: 3 } } });
        label.anchor.set(0.5, 0);
        c.addChild(ring, label); this.tokensC.addChild(c);
        v = { c, ring, label, assetId: null, key: '' }; this.tokenViews.set(t.id, v);
      }
      const r = this.tokenRadius(t);
      const pos = this.preview?.id === t.id ? this.preview : t;
      v.c.position.set(pos.x, pos.y);
      v.c.alpha = t.hidden ? 0.45 : 1;
      const key = [r, t.color, t.rotation, t.hp, t.hpMax, t.conditions.join(), s.selectedId === t.id, activeTokenId === t.id, t.name, t.assetId, gm].join('|');
      if (key === v.key) continue;
      v.key = key;
      const g = v.ring; g.clear();
      g.circle(0, 0, r + 4).fill({ color: 0x000000, alpha: 0.35 });
      g.circle(0, 0, r).fill({ color: hex(t.color) });
      if (!t.assetId) { // facing tick so rotation is visible without artwork
        const a = ((t.rotation - 90) * Math.PI) / 180;
        g.moveTo(0, 0).lineTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9).stroke({ width: Math.max(2, r / 10), color: 0xffffff, alpha: 0.7 });
      }
      g.circle(0, 0, r).stroke({ width: Math.max(2, r / 12), color: activeTokenId === t.id ? 0xf1c40f : 0x1b1714 });
      if (s.selectedId === t.id) g.circle(0, 0, r + 6).stroke({ width: 3, color: 0x5dade2 });
      if (t.hp != null && t.hpMax) {
        const w = r * 1.6, frac = Math.max(0, Math.min(1, t.hp / t.hpMax));
        g.rect(-w / 2, r + 3, w, 5).fill({ color: 0x000000, alpha: 0.7 });
        g.rect(-w / 2, r + 3, w * frac, 5).fill({ color: frac > 0.5 ? 0x7fc28a : frac > 0.25 ? 0xf0c419 : 0xe0675b });
      }
      t.conditions.slice(0, 6).forEach((_, i) => { const a = -Math.PI / 2 + (i - 2.5) * 0.45; g.circle(Math.cos(a) * r, Math.sin(a) * r, Math.max(4, r / 7)).fill({ color: 0xe0a95b }).stroke({ width: 1.5, color: 0x000000 }); });
      v.label.text = t.name;
      v.label.position.set(0, r + (t.hp != null && t.hpMax ? 10 : 4));
      if (t.assetId !== v.assetId) {
        v.sprite?.destroy(); v.sprite = undefined; v.assetId = t.assetId;
        if (t.assetId) this.loadTexture(t.assetId).then((tex) => {
          const cur = this.tokenViews.get(t.id); if (!cur || cur.assetId !== t.assetId) return;
          const sp = new Sprite(tex); sp.anchor.set(0.5);
          const mask = new Graphics().circle(0, 0, 1).fill(0xffffff);
          sp.mask = mask; cur.c.addChildAt(mask, 1); cur.c.addChildAt(sp, 1); cur.sprite = sp; cur.key = ''; this.dirty.tokens = true;
        }).catch(() => undefined);
      }
      if (v.sprite) {
        const d = r * 2 - Math.max(2, r / 12);
        v.sprite.width = v.sprite.height = d; v.sprite.rotation = (t.rotation * Math.PI) / 180;
        (v.sprite.mask as Graphics).clear().circle(0, 0, d / 2).fill(0xffffff);
      }
    }
    for (const [id, v] of this.tokenViews) if (!seen.has(id)) { v.c.destroy({ children: true }); this.tokenViews.delete(id); }
  }

  private drawFog(s: TableState) {
    const m = s.map;
    if (!m || !m.fogEnabled) { this.fogSprite.visible = false; return; }
    const scale = Math.min(1, 2048 / Math.max(m.width, m.height));
    const cv = this.fogCanvas; cv.width = Math.ceil(m.width * scale); cv.height = Math.ceil(m.height * scale);
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#07060a'; ctx.fillRect(0, 0, m.width, m.height);
    for (const r of s.fog) {
      ctx.globalCompositeOperation = r.mode === 'reveal' ? 'destination-out' : 'source-over';
      ctx.beginPath();
      const sh = r.shape;
      if (sh.kind === 'rect') ctx.rect(sh.x, sh.y, sh.w, sh.h);
      else if (sh.kind === 'circle') ctx.arc(sh.x, sh.y, sh.r, 0, Math.PI * 2);
      else { ctx.moveTo(sh.points[0].x, sh.points[0].y); for (const p of sh.points.slice(1)) ctx.lineTo(p.x, p.y); ctx.closePath(); }
      ctx.fill();
    }
    const old = this.fogSprite.texture;
    this.fogSprite.texture = Texture.from(cv, true);
    if (old && old !== Texture.EMPTY) old.destroy(true);
    this.fogSprite.width = m.width; this.fogSprite.height = m.height;
    this.fogSprite.alpha = isGm(s) ? 0.5 : 1; // GMs see through fog, dimmed
    this.fogSprite.visible = true;
  }

  private drawMeasureAndFx(s: TableState) {
    const g = this.measureG; g.clear(); this.measureLabel.text = '';
    const pts = this.rulerHover ? [...this.ruler, this.rulerHover] : this.ruler;
    const cfg = this.gridCfg();
    if (pts.length >= 2) {
      const sc = this.cam.scale;
      g.moveTo(pts[0].x, pts[0].y); for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
      g.stroke({ width: 3 / sc, color: 0x5dade2 });
      for (const p of pts) g.circle(p.x, p.y, 5 / sc).fill({ color: 0x5dade2 });
      const m = measurePath(cfg, pts);
      const end = pts[pts.length - 1];
      this.measureLabel.text = m.label;
      this.measureLabel.scale.set(1 / sc);
      this.measureLabel.position.set(end.x + 10 / sc, end.y - 24 / sc);
    }
    if (this.drag?.kind === 'fog') {
      const a = this.drag.start, b = this.drag.end;
      g.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)).fill({ color: s.fogMode === 'reveal' ? 0x7fc28a : 0xe0675b, alpha: 0.25 }).stroke({ width: 2 / this.cam.scale, color: 0xffffff });
    }
    if (this.drag?.kind === 'draw' && this.drag.points.length > 1) this.paintShape(g, { kind: 'path', points: this.drag.points, color: s.drawColor, width: s.drawWidth });
    // pings: expanding rings that fade over 2.5s
    const fx = this.fx; fx.clear();
    const now = Date.now();
    for (const p of s.pings) {
      const age = (now - p.at) / 2500; if (age > 1) continue;
      fx.circle(p.x, p.y, (10 + age * 60) / this.cam.scale).stroke({ width: 4 / this.cam.scale, color: hex(p.color), alpha: 1 - age });
    }
  }

  // ---------- input ----------
  private local(e: PointerEvent | WheelEvent) { const r = this.app.canvas.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; }
  private tokenAt(p: Point): TokenView | null {
    const toks = Object.values(useTable.getState().tokens);
    for (let i = toks.length - 1; i >= 0; i--) { const t = toks[i]; if (Math.hypot(p.x - t.x, p.y - t.y) <= this.tokenRadius(t)) return t; }
    return null;
  }
  private canMove(t: TokenView) { const s = useTable.getState(); return !!s.me && canEditToken(s.me.role as Role, s.me.id, t); }

  private onDown = (e: PointerEvent) => {
    this.app.canvas.focus();
    const { sx, sy } = this.local(e);
    const p = this.screenToWorld(sx, sy);
    const s = useTable.getState();
    const tool = e.button === 1 ? 'pan' : s.tool;
    if (e.button === 2) return;
    this.app.canvas.setPointerCapture(e.pointerId);
    const cfg = this.gridCfg();
    switch (tool) {
      case 'select': {
        const t = this.tokenAt(p);
        useTable.setState({ selectedId: t?.id ?? null });
        if (t && this.canMove(t)) this.drag = { kind: 'token', id: t.id, offX: p.x - t.x, offY: p.y - t.y, start: { x: t.x, y: t.y }, moved: false };
        else this.drag = { kind: 'pan', sx, sy, cx: this.cam.x, cy: this.cam.y };
        break;
      }
      case 'pan': this.drag = { kind: 'pan', sx, sy, cx: this.cam.x, cy: this.cam.y }; this.app.canvas.style.cursor = 'grabbing'; break;
      case 'measure': {
        const q = snapPoint(cfg, p);
        // drag to measure; shift+click adds waypoints to the current ruler
        if (e.shiftKey && this.ruler.length) this.ruler.push(q); else this.ruler = [q];
        this.drag = { kind: 'measure', dragging: false, downAt: q };
        this.rulerHover = q; break;
      }
      case 'draw': this.drag = { kind: 'draw', points: [p] }; break;
      case 'fog': if (isGm(s)) this.drag = { kind: 'fog', start: p, end: p }; break;
      case 'erase': {
        const hit = this.drawingAt(p);
        if (hit) this.socket.send({ type: 'drawing.delete', id: hit });
        break;
      }
      case 'ping': this.socket.send({ type: 'ping', x: p.x, y: p.y }); break;
      case 'token': {
        if (!isGm(s)) break;
        const q = snapPoint(cfg, p);
        const nt = s.newToken;
        this.socket.send({ type: 'token.create', name: nt.name, category: nt.category as any, color: nt.color, x: q.x, y: q.y, size: 1, hidden: false, ownerIds: [], assetId: null });
        break;
      }
    }
  };

  private onMove = (e: PointerEvent) => {
    const { sx, sy } = this.local(e);
    const p = this.screenToWorld(sx, sy);
    const d = this.drag;
    if (useTable.getState().tool === 'measure' && this.ruler.length && (d?.kind === 'measure' || e.shiftKey)) { this.rulerHover = snapPoint(this.gridCfg(), p); if (d?.kind === 'measure' && Math.hypot(this.rulerHover.x - d.downAt.x, this.rulerHover.y - d.downAt.y) > 4) d.dragging = true; }
    if (!d) return;
    if (d.kind === 'pan') { this.cam.x = d.cx + (sx - d.sx); this.cam.y = d.cy + (sy - d.sy); this.applyCam(); }
    else if (d.kind === 'token') {
      d.moved = true;
      this.preview = { id: d.id, x: p.x - d.offX, y: p.y - d.offY };
      this.dirty.tokens = true;
      this.ruler = [d.start]; this.rulerHover = snapPoint(this.gridCfg(), this.preview, this.tokenFootprint(d.id));
    }
    else if (d.kind === 'draw') { const last = d.points[d.points.length - 1]; if (Math.hypot(p.x - last.x, p.y - last.y) * this.cam.scale > 3 && d.points.length < 2000) d.points.push(p); }
    else if (d.kind === 'fog') d.end = p;
  };
  private tokenFootprint(id: string) { return Math.round(useTable.getState().tokens[id]?.size ?? 1); }

  private onUp = (e: PointerEvent) => {
    const d = this.drag; this.drag = null;
    const s = useTable.getState();
    if (s.tool === 'pan') this.app.canvas.style.cursor = 'grab';
    if (!d) return;
    if (d.kind === 'token') {
      this.ruler = []; this.rulerHover = null;
      if (d.moved && this.preview) {
        const q = snapPoint(this.gridCfg(), this.preview, this.tokenFootprint(d.id));
        this.preview = null;
        this.socket.moveToken(d.id, Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100);
      }
      this.preview = null; this.dirty.tokens = true;
    } else if (d.kind === 'measure') {
      if (d.dragging && this.rulerHover) this.ruler.push(this.rulerHover); // freeze the ruler where the drag ended
      this.rulerHover = null;
    } else if (d.kind === 'draw' && d.points.length > 1) {
      this.socket.send({ type: 'drawing.add', shape: { kind: 'path', points: d.points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })), color: s.drawColor, width: s.drawWidth }, gmOnly: s.drawGmOnly && isGm(s), ...(s.drawTemporary ? { ttlSeconds: 60 } : {}) });
    } else if (d.kind === 'fog') {
      const x = Math.min(d.start.x, d.end.x), y = Math.min(d.start.y, d.end.y), w = Math.abs(d.end.x - d.start.x), h = Math.abs(d.end.y - d.start.y);
      if (w > 2 && h > 2) this.socket.send({ type: 'fog.add', mode: s.fogMode, shape: { kind: 'rect', x, y, w, h } });
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const { sx, sy } = this.local(e);
    if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) this.zoomAt(sx, sy, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    else { this.cam.x -= e.deltaX; this.applyCam(); }
  };

  private onKey = (e: KeyboardEvent) => {
    const s = useTable.getState();
    const t = s.selectedId ? s.tokens[s.selectedId] : null;
    const cfg = this.gridCfg();
    const step = cfg.type === 'none' ? cfg.cellSize / 2 : cfg.cellSize;
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (dirs[e.key]) {
      e.preventDefault();
      const [dx, dy] = dirs[e.key];
      if (t && this.canMove(t)) { const q = snapPoint(cfg, { x: t.x + dx * step, y: t.y + dy * step }, this.tokenFootprint(t.id)); this.socket.moveToken(t.id, q.x, q.y); }
      else { this.cam.x -= dx * 60; this.cam.y -= dy * 60; this.applyCam(); }
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && t && isGm(s)) {
      if (confirm('Delete token "' + (t.name || 'token') + '"?')) this.socket.send({ type: 'token.delete', id: t.id });
    } else if (e.key === 'Escape') { useTable.setState({ selectedId: null }); this.ruler = []; this.rulerHover = null; }
    else if (e.key === '+' || e.key === '=') this.zoomBy(1.2);
    else if (e.key === '-') this.zoomBy(1 / 1.2);
    else if (e.key === 'f') this.fit();
    else if (e.key === 'c') this.centerOnSelected();
  };

  private drawingAt(p: Point): string | null {
    const s = useTable.getState(); const tol = 8 / this.cam.scale;
    const segDist = (a: Point, b: Point) => { const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2; const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2)) : 0; return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y))); };
    for (let i = s.drawings.length - 1; i >= 0; i--) {
      const d = s.drawings[i]; const sh = d.shape;
      if (d.authorId !== s.me?.id && !isGm(s)) continue;
      let hit = false;
      if (sh.kind === 'path') hit = sh.points.some((q, j) => j > 0 && segDist(sh.points[j - 1], q) < tol + sh.width / 2);
      else if (sh.kind === 'line') hit = segDist(sh.from, sh.to) < tol;
      else if (sh.kind === 'circle') hit = Math.abs(Math.hypot(p.x - sh.x, p.y - sh.y) - sh.r) < tol;
      else if (sh.kind === 'rect') hit = p.x >= sh.x - tol && p.x <= sh.x + sh.w + tol && p.y >= sh.y - tol && p.y <= sh.y + sh.h + tol;
      else if (sh.kind === 'text') hit = Math.hypot(p.x - sh.x, p.y - sh.y) < sh.size * 2;
      if (hit) return d.id;
    }
    return null;
  }
}
