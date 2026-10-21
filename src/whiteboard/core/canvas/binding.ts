import type { ArrowElement, Binding, Element } from "../types/model";
import { aabb, type Pt } from "./geometry";

export const BIND_THRESHOLD = 16; // world units
export const BIND_GAP = 8; // world-unit breathing room between an arrow tip and the shape

/** Find a shape whose border is within threshold of world point p. */
export function findBindTarget(
  elements: Element[],
  p: Pt,
  excludeId: string,
): Element | null {
  // Prefer a shape that CONTAINS the point (smallest one wins, so an icon inside
  // a box binds to the icon, not the wrapping box). Fall back to the nearest
  // border within threshold when the point is outside every shape.
  let contained: Element | null = null;
  let containedArea = Infinity;
  let nearest: Element | null = null;
  let nearestDist = BIND_THRESHOLD;
  for (const el of elements) {
    if (el.id === excludeId) continue;
    if (el.type === "line" || el.type === "arrow" || el.type === "freehand") continue;
    const b = aabb(el);
    const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w));
    const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h));
    const d = Math.hypot(dx, dy);
    if (d === 0) {
      const area = b.w * b.h;
      if (
        area < containedArea ||
        (area === containedArea && (!contained || el.zIndex > contained.zIndex))
      ) {
        contained = el;
        containedArea = area;
      }
    } else if (d <= nearestDist) {
      nearestDist = d;
      nearest = el;
    }
  }
  return contained ?? nearest;
}

/** Build a binding descriptor for point p relative to target's AABB. */
export function makeBinding(target: Element, p: Pt): Binding {
  const b = aabb(target);
  const focusX = b.w === 0 ? 0.5 : (p.x - b.x) / b.w;
  const focusY = b.h === 0 ? 0.5 : (p.y - b.y) / b.h;
  return {
    elementId: target.id,
    focusX: Math.min(1, Math.max(0, focusX)),
    focusY: Math.min(1, Math.max(0, focusY)),
    gap: BIND_GAP,
  };
}

/**
 * Resolve the world position of a binding against the current target box.
 * `gapOverride` lets the caller pin the tail flush to the edge (gap 0) while the
 * head keeps its breathing room.
 */
export function resolveBinding(binding: Binding, target: Element, gapOverride?: number): Pt {
  const b = aabb(target);
  // point on/near the border closest to the focus anchor
  const raw = { x: b.x + binding.focusX * b.w, y: b.y + binding.focusY * b.h };
  const center = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  // push the point out to the border along the line from center to raw
  const dx = raw.x - center.x;
  const dy = raw.y - center.y;
  const gap = gapOverride ?? Math.max(binding.gap, BIND_GAP);
  if (dx === 0 && dy === 0) return { x: center.x, y: b.y - gap };
  const scaleX = dx !== 0 ? b.w / 2 / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? b.h / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(scaleX, scaleY);
  // push the tip out along the edge normal so it never buries into the shape
  const onX = scaleX <= scaleY; // hit a left/right edge → gap along x, else along y
  return {
    x: center.x + dx * s + (onX ? Math.sign(dx) * gap : 0),
    y: center.y + dy * s + (onX ? 0 : Math.sign(dy) * gap),
  };
}

/** Recompute an arrow's bound endpoints against current targets. Mutates a copy. */
export function applyBindings(
  arrow: ArrowElement,
  lookup: (id: string) => Element | undefined,
): ArrowElement {
  const pts = arrow.points.map((p) => ({ ...p }));
  const absStart = { x: arrow.x + pts[0].x, y: arrow.y + pts[0].y };
  const absEnd = {
    x: arrow.x + pts[pts.length - 1].x,
    y: arrow.y + pts[pts.length - 1].y,
  };
  let s = absStart;
  let e = absEnd;
  if (arrow.boundStart) {
    const t = lookup(arrow.boundStart.elementId);
    if (t) s = resolveBinding(arrow.boundStart, t, 0); // tail flush against the edge
  }
  if (arrow.boundEnd) {
    const t = lookup(arrow.boundEnd.elementId);
    if (t) e = resolveBinding(arrow.boundEnd, t);
  }
  // rebase points so element origin = min corner, points relative to it
  const minX = Math.min(s.x, e.x);
  const minY = Math.min(s.y, e.y);
  return {
    ...arrow,
    x: minX,
    y: minY,
    w: Math.abs(e.x - s.x),
    h: Math.abs(e.y - s.y),
    points: [
      { x: s.x - minX, y: s.y - minY },
      { x: e.x - minX, y: e.y - minY },
    ],
  };
}
