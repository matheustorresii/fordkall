import type { Element } from "../types/model";
import {
  aabb,
  boxCenter,
  curveControl,
  curvePointAt,
  distPointToSegment,
  elbowRouteForEl,
  pointInBox,
  rotateAround,
  type Pt,
} from "./geometry";

function hasFill(el: Element): boolean {
  return "fillColor" in el && el.fillColor !== "" && el.fillColor !== "transparent";
}

/** Distance from p to the nearest edge of a polyline/polygon. */
function distToEdges(p: Pt, pts: Pt[], closed: boolean): number {
  let best = Infinity;
  const n = pts.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    best = Math.min(best, distPointToSegment(p, pts[i], pts[(i + 1) % n]));
  }
  return best;
}

/**
 * Return the topmost element (highest zIndex) hit by world point p.
 * `tol` is the pick tolerance in WORLD units (scaled by caller for thin shapes).
 */
export function hitTest(
  elements: Element[],
  p: Pt,
  tol: number,
): Element | null {
  // iterate topmost first
  const sorted = [...elements].sort((a, b) => b.zIndex - a.zIndex);
  for (const el of sorted) {
    if (hitOne(el, p, tol)) return el;
  }
  return null;
}

function hitOne(el: Element, p: Pt, tol: number): boolean {
  // undo the element's rotation so we can test against its axis-aligned box
  if (el.rotation) p = rotateAround(p, boxCenter(aabb(el)), -el.rotation);
  const border = tol + ("strokeWidth" in el ? el.strokeWidth : 2);
  switch (el.type) {
    case "text":
    case "image":
    case "icon":
      return pointInBox(p, aabb(el), tol);
    case "rectangle": {
      const b = aabb(el);
      if (hasFill(el) || el.label) return pointInBox(p, b, tol);
      const pts = [
        { x: b.x, y: b.y },
        { x: b.x + b.w, y: b.y },
        { x: b.x + b.w, y: b.y + b.h },
        { x: b.x, y: b.y + b.h },
      ];
      return distToEdges(p, pts, true) <= border;
    }
    case "ellipse": {
      const cx = el.x + el.w / 2;
      const cy = el.y + el.h / 2;
      const rx = Math.abs(el.w / 2);
      const ry = Math.abs(el.h / 2);
      if (rx === 0 || ry === 0) return false;
      const d = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry); // 1 on the boundary
      if (hasFill(el) || el.label) return d <= 1 + tol / Math.min(rx, ry);
      return Math.abs(d - 1) <= border / Math.min(rx, ry);
    }
    case "diamond": {
      const cx = el.x + el.w / 2;
      const cy = el.y + el.h / 2;
      const rx = Math.abs(el.w / 2);
      const ry = Math.abs(el.h / 2);
      if (rx === 0 || ry === 0) return false;
      if (hasFill(el) || el.label)
        return Math.abs(p.x - cx) / (rx + tol) + Math.abs(p.y - cy) / (ry + tol) <= 1;
      const pts = [
        { x: cx, y: el.y },
        { x: el.x + el.w, y: cy },
        { x: cx, y: el.y + el.h },
        { x: el.x, y: cy },
      ];
      return distToEdges(p, pts, true) <= border;
    }
    case "line":
    case "arrow": {
      const { a, b, c } = curveControl(el);
      const w = tol + el.strokeWidth;
      if (el.elbow) return distToEdges(p, elbowRouteForEl(el), false) <= w;
      if (!c) return distPointToSegment(p, a, b) <= w;
      // sample the quadratic curve and test the nearest sub-segment
      let prev = a;
      for (let i = 1; i <= 12; i++) {
        const cur = curvePointAt(a, b, c, i / 12);
        if (distPointToSegment(p, prev, cur) <= w) return true;
        prev = cur;
      }
      return false;
    }
    case "freehand": {
      // pad the AABB, then check proximity to any segment of the path
      if (!pointInBox(p, aabb(el), tol + el.strokeWidth * 2)) return false;
      for (let i = 1; i < el.points.length; i++) {
        const a = { x: el.x + el.points[i - 1].x, y: el.y + el.points[i - 1].y };
        const b = { x: el.x + el.points[i].x, y: el.y + el.points[i].y };
        if (distPointToSegment(p, a, b) <= tol + el.strokeWidth * 2) return true;
      }
      return false;
    }
  }
}
