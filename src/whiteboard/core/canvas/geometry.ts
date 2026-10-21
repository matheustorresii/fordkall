import type { Element, LinePoint } from "../types/model";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Pt {
  x: number;
  y: number;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** World units between grid dots. Shared by the dot grid and snap-to-grid. */
export const GRID = 24;

export function snap(v: number, grid = GRID): number {
  return Math.round(v / grid) * grid;
}

export function snapPt(p: Pt, grid = GRID): Pt {
  return { x: snap(p.x, grid), y: snap(p.y, grid) };
}

/** Axis-aligned bounding box of an element in world space. */
export function aabb(el: Element): Box {
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

/** Normalize a box so w and h are non-negative. */
export function normalizeBox(x0: number, y0: number, x1: number, y1: number): Box {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
  };
}

export function pointInBox(p: Pt, b: Box, pad = 0): boolean {
  return (
    p.x >= b.x - pad &&
    p.x <= b.x + b.w + pad &&
    p.y >= b.y - pad &&
    p.y <= b.y + b.h + pad
  );
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return !(
    a.x + a.w < b.x ||
    b.x + b.w < a.x ||
    a.y + a.h < b.y ||
    b.y + b.h < a.y
  );
}

/** True when `inner` is fully enclosed by `outer`. */
export function boxContains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/** Distance from point p to segment ab. */
export function distPointToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** AABB of a list of points (relative), returned in relative coords. */
export function pointsBounds(points: LinePoint[]): Box {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Center of a box. */
export function boxCenter(b: Box): Pt {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** Absolute endpoints + quadratic control point of a line/arrow (null when straight). */
export function curveControl(el: {
  x: number;
  y: number;
  points: Pt[];
  bend?: number;
}): { a: Pt; b: Pt; c: Pt | null } {
  const p0 = el.points[0];
  const p1 = el.points[el.points.length - 1];
  const a = { x: el.x + p0.x, y: el.y + p0.y };
  const b = { x: el.x + p1.x, y: el.y + p1.y };
  const bend = el.bend ?? 0;
  if (!bend) return { a, b, c: null };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len; // perpendicular unit
  return {
    a,
    b,
    c: { x: (a.x + b.x) / 2 + px * bend, y: (a.y + b.y) / 2 + py * bend },
  };
}

/** Point on a quadratic bezier (or the segment when c is null) at parameter t. */
export function curvePointAt(a: Pt, b: Pt, c: Pt | null, t: number): Pt {
  if (!c) return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

/** Orthogonal (right-angle) polyline from a to b, routed along the dominant axis. */
export function elbowPoints(a: Pt, b: Pt): Pt[] {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx >= dy) {
    const mx = (a.x + b.x) / 2;
    return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
  }
  const my = (a.y + b.y) / 2;
  return [a, { x: a.x, y: my }, { x: b.x, y: my }, b];
}

// The renderer/hit-test need each bound target's box to route elbow arrows so
// they leave/enter perpendicular to the anchored edge. Registered by the canvas.
let boxResolver: (id: string) => Box | null = () => null;
export function setBoxResolver(fn: (id: string) => Box | null): void {
  boxResolver = fn;
}

const BIND_GAP = 8; // keep in sync with binding.ts (breathing room at the tip)
const CLEAR = 18; // extra clearance kept around boxes when routing around them

/** Outward axis-aligned unit normal of the box edge nearest to point p. */
function outwardNormal(p: Pt, box: Box): Pt {
  const cx = clamp(p.x, box.x, box.x + box.w);
  const cy = clamp(p.y, box.y, box.y + box.h);
  const dx = p.x - cx;
  const dy = p.y - cy;
  if (dx === 0 && dy === 0) {
    const ux = p.x - (box.x + box.w / 2);
    const uy = p.y - (box.y + box.h / 2);
    return Math.abs(ux) >= Math.abs(uy)
      ? { x: Math.sign(ux) || 1, y: 0 }
      : { x: 0, y: Math.sign(uy) || 1 };
  }
  return Math.abs(dx) >= Math.abs(dy)
    ? { x: Math.sign(dx), y: 0 }
    : { x: 0, y: Math.sign(dy) };
}

function padBox(b: Box, m: number): Box {
  return { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m };
}

/** Move a point onto the box border along its outward normal (flush contact). */
function snapToEdge(p: Pt, box: Box, dir: Pt): Pt {
  if (dir.x !== 0) {
    return { x: dir.x < 0 ? box.x : box.x + box.w, y: clamp(p.y, box.y, box.y + box.h) };
  }
  return { x: clamp(p.x, box.x, box.x + box.w), y: dir.y < 0 ? box.y : box.y + box.h };
}

/** Does an axis-aligned segment pass through a box's open interior? */
function segCrossesBox(p: Pt, q: Pt, box: Box): boolean {
  const eps = 0.5;
  const bx0 = box.x + eps;
  const bx1 = box.x + box.w - eps;
  const by0 = box.y + eps;
  const by1 = box.y + box.h - eps;
  if (p.y === q.y) {
    // horizontal
    if (p.y <= box.y || p.y >= box.y + box.h) return false;
    const x0 = Math.min(p.x, q.x);
    const x1 = Math.max(p.x, q.x);
    return Math.min(x1, bx1) - Math.max(x0, bx0) > 0;
  }
  // vertical
  if (p.x <= box.x || p.x >= box.x + box.w) return false;
  const y0 = Math.min(p.y, q.y);
  const y1 = Math.max(p.y, q.y);
  return Math.min(y1, by1) - Math.max(y0, by0) > 0;
}

/** Simple mid-split elbow, used as a fallback when the router finds no path. */
function simpleElbow(a: Pt, b: Pt): Pt[] {
  return elbowPoints(a, b);
}

/**
 * Orthogonal route from a→b that leaves a along aDir and enters b along -bDir,
 * staying outside the two endpoint boxes. Solved as a shortest path (fewest
 * bends, then shortest length) over the grid of interesting coordinates, so the
 * arrow routes AROUND a shape instead of cutting through it — while keeping the
 * edges the user anchored to. Excalidraw-style.
 */
export function routeElbow(
  a: Pt,
  aDir: Pt,
  b: Pt,
  bDir: Pt,
  boxA: Box | null,
  boxB: Box | null,
): Pt[] {
  const ep = { x: a.x + aDir.x * CLEAR, y: a.y + aDir.y * CLEAR };
  const eq = { x: b.x + bDir.x * CLEAR, y: b.y + bDir.y * CLEAR };
  const obstacles: Box[] = [];
  if (boxA) obstacles.push(padBox(boxA, BIND_GAP));
  if (boxB) obstacles.push(padBox(boxB, BIND_GAP));

  // candidate grid lines: the ports, their extensions, and channels around boxes
  const xsSet = new Set<number>([a.x, b.x, ep.x, eq.x]);
  const ysSet = new Set<number>([a.y, b.y, ep.y, eq.y]);
  for (const bx of [boxA, boxB]) {
    if (!bx) continue;
    const pb = padBox(bx, CLEAR);
    xsSet.add(pb.x);
    xsSet.add(pb.x + pb.w);
    ysSet.add(pb.y);
    ysSet.add(pb.y + pb.h);
  }
  const xs = [...xsSet].sort((m, n) => m - n);
  const ys = [...ysSet].sort((m, n) => m - n);
  const xi = new Map(xs.map((v, i) => [v, i]));
  const yi = new Map(ys.map((v, i) => [v, i]));

  const si = xi.get(ep.x)!;
  const sj = yi.get(ep.y)!;
  const gi = xi.get(eq.x)!;
  const gj = yi.get(eq.y)!;
  const aAxis = aDir.x === 0 ? 2 : 1; // 1 = horizontal, 2 = vertical
  const bAxis = bDir.x === 0 ? 2 : 1;
  const BEND = 60; // world-unit penalty per turn (prefer straighter routes)

  // Dijkstra over (i, j, lastAxis)
  const key = (i: number, j: number, ax: number) => (i * ys.length + j) * 3 + ax;
  const best = new Map<number, number>();
  const prev = new Map<number, { i: number; j: number; ax: number } | null>();
  const startKey = key(si, sj, aAxis);
  best.set(startKey, 0);
  prev.set(startKey, null);
  // tiny array-based priority queue (grid is small)
  const pq: { c: number; i: number; j: number; ax: number }[] = [
    { c: 0, i: si, j: sj, ax: aAxis },
  ];
  let goalState: { i: number; j: number; ax: number } | null = null;
  while (pq.length) {
    let bi = 0;
    for (let k = 1; k < pq.length; k++) if (pq[k].c < pq[bi].c) bi = k;
    const cur = pq.splice(bi, 1)[0];
    const ck = key(cur.i, cur.j, cur.ax);
    if (cur.c > (best.get(ck) ?? Infinity)) continue;
    if (cur.i === gi && cur.j === gj) {
      goalState = cur;
      break;
    }
    const steps = [
      { di: 1, dj: 0 },
      { di: -1, dj: 0 },
      { di: 0, dj: 1 },
      { di: 0, dj: -1 },
    ];
    for (const s of steps) {
      const ni = cur.i + s.di;
      const nj = cur.j + s.dj;
      if (ni < 0 || nj < 0 || ni >= xs.length || nj >= ys.length) continue;
      const from = { x: xs[cur.i], y: ys[cur.j] };
      const to = { x: xs[ni], y: ys[nj] };
      if (from.x === to.x && from.y === to.y) continue;
      if (obstacles.some((o) => segCrossesBox(from, to, o))) continue;
      const moveAxis = s.di !== 0 ? 1 : 2;
      const len = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
      const c = cur.c + len + (moveAxis !== cur.ax ? BEND : 0);
      const nk = key(ni, nj, moveAxis);
      if (c < (best.get(nk) ?? Infinity)) {
        best.set(nk, c);
        prev.set(nk, { i: cur.i, j: cur.j, ax: cur.ax });
        pq.push({ c, i: ni, j: nj, ax: moveAxis });
      }
    }
  }

  if (!goalState) return simpleElbow(a, b);
  // add the final turn penalty for entering b (informational; path already found)
  const path: Pt[] = [];
  let node: { i: number; j: number; ax: number } | null = goalState;
  while (node) {
    path.unshift({ x: xs[node.i], y: ys[node.j] });
    node = prev.get(key(node.i, node.j, node.ax)) ?? null;
  }
  void bAxis;
  // full polyline: a → (stub) → grid path (ep..eq) → (stub) → b
  const full = [a, ...path, b];
  // drop duplicates and collapse collinear points
  const dedup: Pt[] = [];
  for (const p of full) {
    const last = dedup[dedup.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.01) dedup.push(p);
  }
  const simp: Pt[] = [];
  for (let k = 0; k < dedup.length; k++) {
    const prevP = simp[simp.length - 1];
    const nextP = dedup[k + 1];
    if (prevP && nextP) {
      const collinear =
        (prevP.x === dedup[k].x && dedup[k].x === nextP.x) ||
        (prevP.y === dedup[k].y && dedup[k].y === nextP.y);
      if (collinear) continue;
    }
    simp.push(dedup[k]);
  }
  return simp.length >= 2 ? simp : [a, b];
}

/**
 * Elbow polyline for a connector. Keeps the edges the user anchored to and
 * routes around the endpoint shapes.
 */
export function elbowRouteForEl(el: {
  x: number;
  y: number;
  points: Pt[];
  boundStart?: { elementId: string };
  boundEnd?: { elementId: string };
}): Pt[] {
  const p0 = el.points[0];
  const p1 = el.points[el.points.length - 1];
  const a = { x: el.x + p0.x, y: el.y + p0.y };
  const b = { x: el.x + p1.x, y: el.y + p1.y };
  const boxA = el.boundStart ? boxResolver(el.boundStart.elementId) : null;
  const boxB = el.boundEnd ? boxResolver(el.boundEnd.elementId) : null;
  const domTo = (dx: number, dy: number): Pt =>
    Math.abs(dx) >= Math.abs(dy)
      ? { x: Math.sign(dx) || 1, y: 0 }
      : { x: 0, y: Math.sign(dy) || 1 };
  // Respect the anchored edge; free ends aim along the dominant axis.
  const aDir = boxA ? outwardNormal(a, boxA) : domTo(b.x - a.x, b.y - a.y);
  const bDir = boxB ? outwardNormal(b, boxB) : domTo(a.x - b.x, a.y - b.y);
  // The tail sits FLUSH on the source edge (no gap) so it visibly connects;
  // the head keeps its gap for the arrowhead's breathing room.
  const start = boxA ? snapToEdge(a, boxA, aDir) : a;
  return routeElbow(start, aDir, b, bDir, boxA, boxB);
}

/** Visible start/end points of a connector (elbow route ends, else raw a/b). */
export function connectorEnds(el: {
  x: number;
  y: number;
  points: Pt[];
  bend?: number;
  elbow?: boolean;
  boundStart?: { elementId: string };
  boundEnd?: { elementId: string };
}): { a: Pt; b: Pt } {
  if (el.elbow) {
    const r = elbowRouteForEl(el);
    return { a: r[0], b: r[r.length - 1] };
  }
  const { a, b } = curveControl(el);
  return { a, b };
}

/** The visual midpoint of a line/arrow (curve/elbow aware) for labels & handles. */
export function connectorMidpoint(el: {
  x: number;
  y: number;
  points: Pt[];
  bend?: number;
  elbow?: boolean;
  boundStart?: { elementId: string };
  boundEnd?: { elementId: string };
}): Pt {
  const p0 = el.points[0];
  const p1 = el.points[el.points.length - 1];
  const a = { x: el.x + p0.x, y: el.y + p0.y };
  const b = { x: el.x + p1.x, y: el.y + p1.y };
  if (el.elbow) {
    const pts = elbowRouteForEl(el);
    // midpoint by arc length so the label sits on the visual middle
    let total = 0;
    const segs: number[] = [];
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      segs.push(d);
      total += d;
    }
    let acc = 0;
    for (let i = 0; i < segs.length; i++) {
      if (acc + segs[i] >= total / 2) {
        const t = segs[i] === 0 ? 0 : (total / 2 - acc) / segs[i];
        return {
          x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
          y: pts[i].y + (pts[i + 1].y - pts[i].y) * t,
        };
      }
      acc += segs[i];
    }
    return b;
  }
  const { c } = curveControl(el);
  return curvePointAt(a, b, c, 0.5);
}

/** Rotate point p around center c by angle (radians). */
export function rotateAround(p: Pt, c: Pt, angle: number): Pt {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}
