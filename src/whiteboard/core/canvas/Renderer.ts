import type { Element } from "../types/model";
import type { SceneStore } from "./SceneStore";
import { aabb, boxesIntersect, connectorEnds, curveControl, curvePointAt, GRID } from "./geometry";
import { drawElement } from "./shapes";
import { cornerHandles, selectionBox, HANDLE_SCREEN_SIZE } from "./selection";
import { visibleWorldBox } from "./viewport";

const SELECTION_COLOR = "#acd52c";
const ROTATE_OFFSET_SCREEN = 22; // px above the box for the rotation handle

export interface DrawStats {
  drawn: number;
  total: number;
}

/**
 * Draw the whole scene. `cssW/cssH` are the canvas CSS pixel size; `dpr` the
 * device pixel ratio. The context is reset each frame.
 */
export function draw(
  ctx: CanvasRenderingContext2D,
  scene: SceneStore,
  cssW: number,
  cssH: number,
  dpr: number,
  preview: Element | null,
  gridVisible: boolean,
): DrawStats {
  const v = scene.viewport;

  // reset & clear in device pixels
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cssW * dpr, cssH * dpr);

  // dot grid, drawn in screen space (device px) so density stays readable
  if (gridVisible) drawDotGrid(ctx, v, cssW, cssH, dpr);

  // world transform (includes DPR)
  ctx.setTransform(
    v.scale * dpr,
    0,
    0,
    v.scale * dpr,
    v.offsetX * dpr,
    v.offsetY * dpr,
  );

  const view = visibleWorldBox(v, cssW, cssH);
  const sorted = [...scene.all()].sort((a, b) => a.zIndex - b.zIndex);

  let drawn = 0;
  for (const el of sorted) {
    if (el.id === scene.editingId) {
      // A plain-text element stays visible while editing so multi-color updates
      // live under a transparent overlay; other kinds hide under an opaque one.
      if (el.type !== "text" || el.mono) continue;
    }
    if (!boxesIntersect(aabb(el), view)) continue; // culling
    // hide only the label while its label overlay is open (the element stays)
    if (el.id === scene.editingLabelId) {
      drawElement(ctx, { ...el, label: undefined });
    } else {
      drawElement(ctx, el);
    }
    drawn++;
  }
  if (preview) {
    drawElement(ctx, preview);
    drawn++;
  }

  // binding target highlight (drawn under the selection overlay)
  if (scene.bindHighlightId) {
    const t = scene.get(scene.bindHighlightId);
    if (t) {
      const b = aabb(t);
      const pad = 4 / v.scale;
      ctx.save();
      ctx.strokeStyle = "#acd52c";
      ctx.lineWidth = 2 / v.scale;
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.9;
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2, 6 / v.scale);
        ctx.stroke();
      } else {
        ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
      }
      ctx.restore();
    }
  }

  // selection overlay (drawn in world space, but line widths compensated for zoom)
  const single = scene.singleSelection;
  for (const id of scene.selectedIds) {
    if (id === scene.editingId) continue; // no selection frame over the text overlay
    const sel = scene.get(id);
    if (sel) drawSelection(ctx, sel, v.scale, id === single);
  }

  // marquee (drag-select) rectangle
  if (scene.marqueeRect) {
    const m = scene.marqueeRect;
    ctx.save();
    ctx.fillStyle = "rgba(172, 213, 44, 0.10)";
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.lineWidth = 1 / v.scale;
    ctx.setLineDash([4 / v.scale, 3 / v.scale]);
    ctx.fillRect(m.x, m.y, m.w, m.h);
    ctx.strokeRect(m.x, m.y, m.w, m.h);
    ctx.restore();
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { drawn, total: sorted.length };
}

function drawDotGrid(
  ctx: CanvasRenderingContext2D,
  v: { scale: number; offsetX: number; offsetY: number },
  cssW: number,
  cssH: number,
  dpr: number,
): void {
  const step = GRID * v.scale * dpr;
  if (step < 10) return; // too dense when zoomed far out — skip
  const ox = (v.offsetX * dpr) % step;
  const oy = (v.offsetY * dpr) % step;
  const r = Math.max(1, dpr * 0.9);
  const light = document.documentElement.dataset.theme === "light";
  // light theme needs a darker, denser dot to read against the near-white canvas
  ctx.fillStyle = light ? "rgba(60, 74, 20, 0.35)" : "rgba(172, 213, 44, 0.12)";
  for (let x = ox; x < cssW * dpr; x += step) {
    for (let y = oy; y < cssH * dpr; y += step) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  el: Element,
  scale: number,
  withHandles: boolean,
): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = SELECTION_COLOR;
  ctx.lineWidth = 1 / scale;

  // Connectors (line/arrow) are edited point-by-point, not as a box: draw
  // endpoint handles + a midpoint bend handle, with no bounding frame.
  if (el.type === "line" || el.type === "arrow") {
    const g = curveControl(el);
    const ends = connectorEnds(el);
    const hr = (HANDLE_SCREEN_SIZE / 2 + 1) / scale;
    if (withHandles) {
      ctx.fillStyle = "#0f120b";
      for (const p of [ends.a, ends.b]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, hr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      if (!el.elbow) {
        const mid = curvePointAt(g.a, g.b, g.c, 0.5);
        ctx.beginPath();
        ctx.arc(mid.x, mid.y, hr, 0, Math.PI * 2);
        ctx.fillStyle = SELECTION_COLOR;
        ctx.fill();
        ctx.stroke();
      }
    } else {
      // part of a multi-selection: mark the endpoints subtly
      ctx.fillStyle = SELECTION_COLOR;
      for (const p of [ends.a, ends.b]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, hr * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    return;
  }

  const b = selectionBox(el);
  // rotate the whole overlay around the element center so it hugs the element
  if (el.rotation) {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    ctx.translate(cx, cy);
    ctx.rotate(el.rotation);
    ctx.translate(-cx, -cy);
  }

  ctx.setLineDash(withHandles ? [] : [4 / scale, 3 / scale]);
  const pad = 4 / scale;
  ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);

  if (withHandles) {
    const hs = HANDLE_SCREEN_SIZE / scale;
    ctx.setLineDash([]);
    ctx.fillStyle = "#0f120b";
    for (const h of cornerHandles({ ...el, x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 })) {
      ctx.beginPath();
      ctx.rect(h.x - hs / 2, h.y - hs / 2, hs, hs);
      ctx.fill();
      ctx.stroke();
    }
    // rotation handle: a small circle above the top-center
    const rx = b.x + b.w / 2;
    const ry = b.y - pad - ROTATE_OFFSET_SCREEN / scale;
    ctx.beginPath();
    ctx.moveTo(rx, b.y - pad);
    ctx.lineTo(rx, ry);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rx, ry, (HANDLE_SCREEN_SIZE / 2 + 1) / scale, 0, Math.PI * 2);
    ctx.fillStyle = SELECTION_COLOR;
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
