/**
 * The 3D table (three.js), an alternative view of the same server-authoritative state the PixiJS engine draws.
 * - World units are millimetres at print scale: one grid cell = 25.4 mm (shared/minis.ts). Map px (x right, y down)
 *   map to world X and Z; Y is up. North (map y = 0) is world -Z.
 * - Tokens are the same TokenView rows as 2D: moving here sends token.move, so 2D and other players follow.
 * - Camera: OrbitControls (left drag orbit, right drag pan, wheel zoom). Left drag on a token you may move drags it.
 * Loaded lazily (dynamic import) so the 2D table does not pay for three.js.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { useTable, isGm, type TableState } from './store';
import type { TableSocket } from './socket';
import { assetSrc } from '../api';
import { GridConfig, worldToCell, cellCenter, hexCorners, snapPoint, type Point } from '../../../shared/grid';
import { canEditToken, type Role } from '../../../shared/permissions';
import { mmPerPx, MM_PER_CELL, groundFootprint, type MiniItem, type MeshPart } from '../../../shared/minis';
import { miniById, meshUrl } from '../minis/library';
import type { TokenView } from '../../../shared/protocol';

const TABLE_MARGIN = 60; // mm of wooden table around the board

interface MiniMesh { parts: { geo: THREE.BufferGeometry; color: string }[] }
const miniMeshes = new Map<string, Promise<MiniMesh>>();
const failedMinis = new Set<string>(); // meshes that failed to load fall back to a pawn
/** Parts mesh (mm, z up) as y-up geometry centred on its ground contact, cached per miniature and never disposed. */
function loadMini(item: MiniItem): Promise<MiniMesh> {
  let p = miniMeshes.get(item.id);
  if (!p) {
    p = fetch(meshUrl(item)).then((r) => { if (!r.ok) throw new Error('mesh ' + r.status); return r.json(); }).then((parts: MeshPart[]) => {
      const f = groundFootprint(parts);
      return { parts: parts.map((part) => {
        const pos = new Float32Array(part.vertices.length * 3);
        // model (x, y, z) z-up -> world (x, z, -y): model +y (north) becomes world -Z, the map's up
        part.vertices.forEach((v, i) => { pos[i * 3] = v[0] - f.cx; pos[i * 3 + 1] = v[2] - f.zMin; pos[i * 3 + 2] = -(v[1] - f.cy); });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setIndex(part.triangles.flat());
        geo.computeVertexNormals();
        geo.userData.shared = true;
        return { geo, color: part.color ?? '#999999' };
      }) };
    });
    miniMeshes.set(item.id, p);
  }
  return p;
}

interface TokenObj { obj: THREE.Group; key: string; height: number }

export class Table3D {
  renderer!: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 1, 100000);
  controls!: OrbitControls;
  private board = new THREE.Group();
  private tokensG = new THREE.Group();
  private sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  private fogMesh: THREE.Mesh | null = null;
  private fogCanvas = document.createElement('canvas');
  private views = new Map<string, TokenObj>();
  private bgAsset: string | null = null;
  private dirty = { board: true, tokens: true, fog: true };
  private needsRender = true;
  private unsub: (() => void) | null = null;
  private ro: ResizeObserver | null = null;
  private el!: HTMLElement;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private drag: { id: string; offX: number; offY: number; moved: boolean } | null = null;
  private preview: { id: string; x: number; y: number } | null = null;
  private down: { x: number; y: number } | null = null;
  private fitted = false;

  constructor(private socket: TableSocket) {}

  init(el: HTMLElement) {
    this.el = el;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const c = this.renderer.domElement;
    c.tabIndex = 0;
    c.style.touchAction = 'none';
    c.setAttribute('role', 'application');
    c.setAttribute('aria-label', '3D tabletop. Drag to orbit, right-drag to pan, wheel to zoom. Arrow keys move the selected token, Q and E turn it.');
    el.appendChild(c);
    this.scene.background = new THREE.Color(0x14110e);
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a2c20, 1.1));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target, this.board, this.tokensG);
    // our pointerdown runs before OrbitControls' so a token drag can switch the controls off first
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onUp);
    c.addEventListener('keydown', this.onKey);
    this.controls = new OrbitControls(this.camera, c);
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.screenSpacePanning = false;
    this.controls.addEventListener('change', () => { this.needsRender = true; });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);
    this.resize();
    this.unsub = useTable.subscribe((s, p) => this.onState(s, p));
    this.onState(useTable.getState(), {} as TableState);
    this.renderer.setAnimationLoop(() => this.frame());
    (window as any).__odTable3d = { engine: this, state: () => useTable.getState(), mapToScreen: (p: Point, h = 0) => this.mapToScreen(p, h) };
  }

  destroy() {
    this.unsub?.(); this.ro?.disconnect();
    this.renderer?.setAnimationLoop(null);
    this.controls?.dispose();
    this.clearGroup(this.board); this.clearGroup(this.tokensG);
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    if ((window as any).__odTable3d?.engine === this) delete (window as any).__odTable3d;
  }

  // ---------- coordinates ----------
  private k() { return mmPerPx(this.gridCfg()); }
  private gridCfg(): GridConfig { return useTable.getState().map?.grid ?? GridConfig.parse({}); }
  private ray(clientX: number, clientY: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
    return this.raycaster;
  }
  /** Map px under a client (screen) point, on the table surface; null if the ray misses it. */
  clientToMap(clientX: number, clientY: number): Point | null {
    const hit = this.ray(clientX, clientY).ray.intersectPlane(this.groundPlane, new THREE.Vector3());
    if (!hit) return null;
    const k = this.k();
    return { x: hit.x / k, y: hit.z / k };
  }
  /** Client (screen) point for a map px position at a height in mm (tests and overlays). */
  mapToScreen(p: Point, heightMm = 0) {
    const k = this.k(), v = new THREE.Vector3(p.x * k, heightMm, p.y * k).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  // ---------- camera ----------
  private resize() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.needsRender = true;
  }
  /** Look at the whole board from the south, about 50 degrees above the table. */
  fit() {
    const m = useTable.getState().map; if (!m) return;
    const k = this.k(), W = m.width * k, H = m.height * k;
    const fov = (this.camera.fov * Math.PI) / 180;
    const dist = (Math.max(H, W / this.camera.aspect) / 2 / Math.tan(fov / 2)) * 1.45; // perspective: the near edge looks larger than the far one
    const el = (50 * Math.PI) / 180;
    this.controls.target.set(W / 2, 0, H / 2);
    this.camera.position.set(W / 2, Math.sin(el) * dist, H / 2 + Math.cos(el) * dist);
    this.controls.maxDistance = dist * 4; this.controls.minDistance = 30;
    this.controls.update(); this.needsRender = true;
  }
  zoomBy(f: number) {
    const off = this.camera.position.clone().sub(this.controls.target).multiplyScalar(1 / f);
    this.camera.position.copy(this.controls.target).add(off); this.controls.update(); this.needsRender = true;
  }

  // ---------- state ----------
  private onState(s: TableState, p: TableState) {
    if (s.map !== p.map) {
      this.dirty.board = this.dirty.tokens = this.dirty.fog = true;
      if (s.map && !this.fitted) { this.fitted = true; this.fit(); }
    }
    if (s.tokens !== p.tokens || s.selectedId !== p.selectedId) this.dirty.tokens = true;
    if (s.fog !== p.fog || s.me !== p.me) this.dirty.fog = true;
  }

  private frame() {
    const s = useTable.getState();
    if (this.dirty.board) { this.dirty.board = false; this.buildBoard(s); this.needsRender = true; }
    if (this.dirty.tokens) { this.dirty.tokens = false; this.syncTokens(s); this.needsRender = true; }
    if (this.dirty.fog) { this.dirty.fog = false; this.drawFog(s); this.needsRender = true; }
    if (!this.needsRender) return;
    this.needsRender = false;
    this.renderer.render(this.scene, this.camera);
  }

  /** Remove and dispose children; geometry flagged userData.shared (cached miniature meshes) is kept. */
  private clearGroup(g: THREE.Object3D) {
    for (const o of [...g.children]) {
      g.remove(o);
      o.traverse((x) => {
        const m = x as THREE.Mesh;
        if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
        for (const mat of ([] as THREE.Material[]).concat((m.material as any) ?? [])) { (mat as any).map?.dispose(); (mat as any).alphaMap?.dispose(); mat.dispose(); }
      });
    }
  }

  private buildBoard(s: TableState) {
    this.clearGroup(this.board); this.fogMesh = null;
    const m = s.map; if (!m) return;
    const k = this.k(), W = m.width * k, H = m.height * k, cell = MM_PER_CELL, g = m.grid;
    // table top under the board
    const wood = new THREE.Mesh(new THREE.BoxGeometry(W + TABLE_MARGIN * 2, 30, H + TABLE_MARGIN * 2), new THREE.MeshStandardMaterial({ color: 0x4a2f1c, roughness: 0.85 }));
    wood.position.set(W / 2, -15.5, H / 2); wood.receiveShadow = true;
    this.board.add(wood);
    // ground: the map image, else a flagstone tile texture with one stone per cell
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
    ground.rotation.x = -Math.PI / 2; ground.position.set(W / 2, 0, H / 2); ground.receiveShadow = true;
    this.board.add(ground);
    if (m.backgroundAssetId) {
      const id = m.backgroundAssetId; this.bgAsset = id;
      assetSrc(id).then((src) => new THREE.TextureLoader().loadAsync(src)).then((tex) => {
        if (this.bgAsset !== id || !ground.parent) { tex.dispose(); return; }
        tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
        mat.map = tex; mat.needsUpdate = true; this.needsRender = true;
      }).catch(() => undefined);
    } else {
      this.bgAsset = null;
      const tex = flagstoneTexture();
      const rx = W / (2 * cell), ry = H / (2 * cell);
      tex.repeat.set(rx, ry);
      tex.offset.set(-(g.offsetX * k) / (2 * cell), ((g.offsetY * k) / (2 * cell) - ry) % 1);
      mat.map = tex;
    }
    // grid lines just above the ground
    if (g.visible && g.type !== 'none') {
      const pts: number[] = [], y = 0.15;
      if (g.type === 'square') {
        const s0 = g.cellSize;
        for (let x = g.offsetX - Math.floor(g.offsetX / s0) * s0; x <= m.width + 0.01; x += s0) pts.push(x * k, y, 0, x * k, y, H);
        for (let z = g.offsetY - Math.floor(g.offsetY / s0) * s0; z <= m.height + 0.01; z += s0) pts.push(0, y, z * k, W, y, z * k);
      } else {
        const a = worldToCell(g, { x: 0, y: 0 }), b = worldToCell(g, { x: m.width, y: m.height }), c = worldToCell(g, { x: m.width, y: 0 }), d = worldToCell(g, { x: 0, y: m.height });
        const qs = [a.a, b.a, c.a, d.a], rs = [a.b, b.b, c.b, d.b];
        let count = 0;
        for (let q = Math.min(...qs) - 1; q <= Math.max(...qs) + 1 && count < 20000; q++) for (let r = Math.min(...rs) - 1; r <= Math.max(...rs) + 1 && count < 20000; r++) {
          const ctr = cellCenter(g, { a: q, b: r });
          if (ctr.x < 0 || ctr.x > m.width || ctr.y < 0 || ctr.y > m.height) continue;
          count++;
          const cs = hexCorners(g, { a: q, b: r });
          cs.forEach((p0, i) => { const p1 = cs[(i + 1) % 6]; pts.push(p0.x * k, y, p0.y * k, p1.x * k, y, p1.y * k); });
        }
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.board.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: g.color, transparent: true, opacity: Math.max(0.35, g.opacity) })));
    }
    // fog sheet, painted in drawFog
    const fogTex = new THREE.CanvasTexture(this.fogCanvas);
    this.fogMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ color: 0x07060a, transparent: true, alphaMap: fogTex, depthWrite: false }));
    this.fogMesh.rotation.x = -Math.PI / 2; this.fogMesh.position.set(W / 2, 0.4, H / 2); this.fogMesh.renderOrder = 2;
    this.board.add(this.fogMesh);
    this.dirty.fog = true;
    // light covers the board so every token casts a shadow
    const R = Math.hypot(W, H) / 2 + TABLE_MARGIN;
    this.sun.position.set(W / 2 - R * 0.6, R * 1.4, H / 2 + R * 0.8); this.sun.target.position.set(W / 2, 0, H / 2);
    Object.assign(this.sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: R * 4 });
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  private drawFog(s: TableState) {
    const m = s.map, mesh = this.fogMesh; if (!m || !mesh) return;
    mesh.visible = m.fogEnabled;
    if (!m.fogEnabled) return;
    // alphaMap reads the green channel: white = fogged, black = revealed; same compositing order as the 2D engine
    const scale = Math.min(1, 2048 / Math.max(m.width, m.height));
    const cv = this.fogCanvas; cv.width = Math.ceil(m.width * scale); cv.height = Math.ceil(m.height * scale);
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, m.width, m.height);
    for (const r of s.fog) {
      ctx.fillStyle = r.mode === 'reveal' ? '#000000' : '#ffffff';
      ctx.beginPath();
      const sh = r.shape;
      if (sh.kind === 'rect') ctx.rect(sh.x, sh.y, sh.w, sh.h);
      else if (sh.kind === 'circle') ctx.arc(sh.x, sh.y, sh.r, 0, Math.PI * 2);
      else { ctx.moveTo(sh.points[0].x, sh.points[0].y); for (const p of sh.points.slice(1)) ctx.lineTo(p.x, p.y); ctx.closePath(); }
      ctx.fill();
    }
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.alphaMap!.needsUpdate = true;
    mat.opacity = isGm(s) ? 0.5 : 1; // GMs see through fog, dimmed
  }

  // ---------- tokens ----------
  private syncTokens(s: TableState) {
    const k = this.k(), seen = new Set<string>();
    for (const t of Object.values(s.tokens)) {
      seen.add(t.id);
      const selected = s.selectedId === t.id;
      const key = [t.size, t.color, t.name, t.hidden, selected, s.map?.grid.cellSize, t.miniId].join('|');
      let v = this.views.get(t.id);
      if (!v || v.key !== key) {
        if (v) { this.tokensG.remove(v.obj); this.clearGroup(v.obj); }
        v = this.buildToken(t, selected, key);
        this.views.set(t.id, v); this.tokensG.add(v.obj);
      }
      const dragging = this.preview?.id === t.id;
      const pos = dragging ? this.preview! : t;
      v.obj.position.set(pos.x * k, dragging ? 3 : 0, pos.y * k);
      v.obj.rotation.y = (-t.rotation * Math.PI) / 180; // 2D rotation is clockwise seen from above
    }
    for (const [id, v] of this.views) if (!seen.has(id)) { this.tokensG.remove(v.obj); this.clearGroup(v.obj); this.views.delete(id); }
  }

  /** A painted pawn on a round base sized like the 2D token (size cells across), facing north at rotation 0. */
  private buildToken(t: TokenView, selected: boolean, key: string): TokenObj {
    const item = miniById(t.miniId);
    if (item && !failedMinis.has(item.id)) return this.buildMini(t, item, selected, key);
    const g = new THREE.Group(); g.userData.tokenId = t.id;
    const r = ((t.size * MM_PER_CELL) / 2) * 0.96, h = 3;
    const opacity = t.hidden ? 0.45 : 1;
    const std = (color: THREE.ColorRepresentation) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, transparent: t.hidden, opacity });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.03, h, 48), std(0x1b1714));
    base.position.y = h / 2;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.92, 0.6, 48), std(t.color));
    top.position.y = h + 0.3;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.28, r * 0.5, r * 1.3, 24), std(t.color));
    body.position.y = h + r * 0.65;
    const head = new THREE.Mesh(new THREE.SphereGeometry(r * 0.3, 24, 16), std(t.color));
    head.position.y = h + r * 1.5;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(r * 0.12, r * 0.5, 12), std(0xf3ead8));
    nose.rotation.x = -Math.PI / 2; nose.position.set(0, h + 0.8, -r * 0.7); // facing tick, like the 2D one
    for (const m of [base, top, body, head, nose]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
    const height = h + r * 1.8;
    if (selected) g.add(selectionRing(r));
    if (t.name) g.add(label(t.name, height + 4));
    return { obj: g, key, height };
  }

  /** The library model at print scale (1 cell = 25.4 mm), loaded once and shared by every token using it. */
  private buildMini(t: TokenView, item: MiniItem, selected: boolean, key: string): TokenObj {
    const g = new THREE.Group(); g.userData.tokenId = t.id;
    if (selected) g.add(selectionRing(Math.max(item.footprintMm, item.cells * MM_PER_CELL * 0.9) / 2));
    if (t.name && item.kind === 'figure') g.add(label(t.name, item.heightMm + 5));
    loadMini(item).then((m) => {
      if (this.views.get(t.id)?.obj !== g) return; // replaced or removed while loading
      for (const p of m.parts) {
        const mesh = new THREE.Mesh(p.geo, new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.75, metalness: 0.05, transparent: t.hidden, opacity: t.hidden ? 0.45 : 1 }));
        mesh.castShadow = mesh.receiveShadow = true;
        g.add(mesh);
      }
      this.needsRender = true;
    }).catch(() => { failedMinis.add(item.id); if (this.views.get(t.id)?.obj === g) { this.views.delete(t.id); this.tokensG.remove(g); this.dirty.tokens = true; } });
    return { obj: g, key, height: item.heightMm };
  }

  private tokenAt(clientX: number, clientY: number): TokenView | null {
    for (const hit of this.ray(clientX, clientY).intersectObjects(this.tokensG.children, true)) {
      if ((hit.object as THREE.Sprite).isSprite) continue;
      let o: THREE.Object3D | null = hit.object;
      while (o && !o.userData.tokenId) o = o.parent;
      const t = o && useTable.getState().tokens[o.userData.tokenId];
      if (t) return t;
    }
    return null;
  }
  private canMove(t: TokenView) { const s = useTable.getState(); return !!s.me && canEditToken(s.me.role as Role, s.me.id, t); }

  // ---------- input ----------
  private onDown = (e: PointerEvent) => {
    this.renderer.domElement.focus();
    if (e.button !== 0) return;
    this.down = { x: e.clientX, y: e.clientY };
    if (useTable.getState().tool !== 'select') return;
    const t = this.tokenAt(e.clientX, e.clientY);
    if (!t) return;
    useTable.setState({ selectedId: t.id });
    if (!this.canMove(t)) return;
    const p = this.clientToMap(e.clientX, e.clientY); if (!p) return;
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.drag = { id: t.id, offX: p.x - t.x, offY: p.y - t.y, moved: false };
  };
  private onMove = (e: PointerEvent) => {
    const d = this.drag; if (!d) return;
    const p = this.clientToMap(e.clientX, e.clientY); if (!p) return;
    d.moved = true;
    this.preview = { id: d.id, x: p.x - d.offX, y: p.y - d.offY };
    this.dirty.tokens = true;
  };
  private onUp = (e: PointerEvent) => {
    const d = this.drag; this.drag = null; this.controls.enabled = true;
    const click = !!this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 4;
    this.down = null;
    const s = useTable.getState();
    if (d) {
      if (d.moved && this.preview) {
        const t = s.tokens[d.id];
        const q = snapPoint(this.gridCfg(), this.preview, Math.round(t?.size ?? 1));
        this.socket.moveToken(d.id, Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100);
      }
      this.preview = null; this.dirty.tokens = true;
      return;
    }
    if (!click || e.button !== 0) return;
    const p = this.clientToMap(e.clientX, e.clientY);
    if (s.tool === 'select') useTable.setState({ selectedId: null });
    else if (s.tool === 'ping' && p) this.socket.send({ type: 'ping', x: p.x, y: p.y });
    else if (s.tool === 'token' && p && isGm(s)) {
      const q = snapPoint(this.gridCfg(), p), nt = s.newToken;
      this.socket.send({ type: 'token.create', name: nt.name, category: nt.category as any, color: nt.color, x: q.x, y: q.y, size: 1, hidden: false, ownerIds: [], assetId: null });
    }
  };
  private onKey = (e: KeyboardEvent) => {
    const s = useTable.getState();
    const t = s.selectedId ? s.tokens[s.selectedId] : null;
    if (e.key === 'f') { this.fit(); return; }
    if (!t) return;
    const cfg = this.gridCfg();
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (dirs[e.key] && this.canMove(t)) {
      e.preventDefault();
      const [dx, dy] = dirs[e.key];
      const q = snapPoint(cfg, { x: t.x + dx * cfg.cellSize, y: t.y + dy * cfg.cellSize }, Math.round(t.size));
      this.socket.moveToken(t.id, q.x, q.y);
    } else if ((e.key === 'q' || e.key === 'e') && this.canMove(t)) {
      const rotation = (((t.rotation + (e.key === 'e' ? 45 : -45)) % 360) + 360) % 360;
      this.socket.send({ type: 'token.update', id: t.id, patch: { rotation }, baseVersion: t.version });
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && isGm(s)) {
      if (confirm('Delete token "' + (t.name || 'token') + '"?')) this.socket.send({ type: 'token.delete', id: t.id });
    } else if (e.key === 'Escape') useTable.setState({ selectedId: null });
  };
}

function selectionRing(r: number) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(r + 1, r + 2.6, 48), new THREE.MeshBasicMaterial({ color: 0x5dade2, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.3;
  return ring;
}

/** Name tag that always faces the camera. */
function label(text: string, y: number) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const ctx = cv.getContext('2d')!;
  ctx.font = '600 30px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 6; ctx.strokeStyle = '#000'; ctx.strokeText(text, 128, 32, 248);
  ctx.fillStyle = '#fff'; ctx.fillText(text, 128, 32, 248);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sp.scale.set(24, 6, 1); sp.position.y = y; sp.renderOrder = 3;
  return sp;
}

/** 2 x 2 cells of flagstones with mortar joints on the grid lines (repeats across the board). */
function flagstoneTexture() {
  const N = 256, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#2a2622'; ctx.fillRect(0, 0, N, N);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const tones = ['#6f675c', '#665e54', '#776e62', '#5f584f'];
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const x = i * 128 + 3, y = j * 128 + 3;
    ctx.fillStyle = tones[i * 2 + j]; ctx.fillRect(x, y, 122, 122);
    for (let n = 0; n < 140; n++) { ctx.fillStyle = 'rgba(' + (rnd() > 0.5 ? '255,255,255' : '0,0,0') + ',' + (0.03 + rnd() * 0.05) + ')'; ctx.fillRect(x + rnd() * 116, y + rnd() * 116, 2 + rnd() * 8, 2 + rnd() * 8); }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}
