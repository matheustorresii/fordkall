import getStroke from "perfect-freehand";
import type {
  ArrowElement,
  Element,
  FreehandElement,
  IconElement,
  ImageElement,
  LineElement,
  TextElement,
} from "../types/model";
import { getImage } from "./imageCache";
import { drawIconArt } from "./icons";
import { colorFor, tokenizeLines } from "./highlight";
import { connectorMidpoint, curveControl, elbowRouteForEl } from "./geometry";
import { STROKE_DARK, STROKE_LIGHT } from "../theme";

// The two theme-default stroke colors flip with the theme so default-colored
// content stays visible after a theme switch; explicit colors are left alone.
function adapt(color: string): string {
  const light = document.documentElement.dataset.theme === "light";
  if (light && color === STROKE_DARK) return STROKE_LIGHT;
  if (!light && color === STROKE_LIGHT) return STROKE_DARK;
  return color;
}

// All draw functions receive a context already transformed to WORLD space
// (ctx.setTransform applied by the Renderer). strokeWidth is in world units.

function applyStroke(ctx: CanvasRenderingContext2D, el: Element): void {
  ctx.globalAlpha = el.opacity;
  ctx.strokeStyle = adapt(el.strokeColor);
  ctx.lineWidth = el.strokeWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
}

/** Text label centered inside a shape (rectangle/ellipse/diamond). */
function drawCenteredLabel(ctx: CanvasRenderingContext2D, el: Element): void {
  if (!el.label) return;
  ctx.save();
  ctx.globalAlpha = el.opacity;
  ctx.fillStyle = adapt(el.strokeColor);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fs = 16;
  ctx.font = `${fs}px Inter, sans-serif`;
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const lines = el.label.split("\n");
  const lh = fs * 1.25;
  const startY = cy - ((lines.length - 1) * lh) / 2;
  lines.forEach((ln, i) => ctx.fillText(ln, cx, startY + i * lh));
  ctx.restore();
}

function applyFill(ctx: CanvasRenderingContext2D, el: Element): boolean {
  if (el.fillColor && el.fillColor !== "transparent") {
    ctx.fillStyle = el.fillColor;
    return true;
  }
  return false;
}

export function drawRectangle(ctx: CanvasRenderingContext2D, el: Element): void {
  applyStroke(ctx, el);
  ctx.beginPath();
  if (el.rounded && ctx.roundRect) {
    const r = Math.min(16, Math.abs(el.w) * 0.2, Math.abs(el.h) * 0.2);
    ctx.roundRect(el.x, el.y, el.w, el.h, r);
  } else {
    ctx.rect(el.x, el.y, el.w, el.h);
  }
  if (applyFill(ctx, el)) ctx.fill();
  ctx.stroke();
  drawCenteredLabel(ctx, el);
}

/** Trace a convex polygon with rounded corners of the given radius. */
function roundedPolyPath(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  radius: number,
): void {
  const n = pts.length;
  const last = pts[n - 1];
  ctx.moveTo((last.x + pts[0].x) / 2, (last.y + pts[0].y) / 2);
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    ctx.arcTo(cur.x, cur.y, (cur.x + next.x) / 2, (cur.y + next.y) / 2, radius);
  }
  ctx.closePath();
}

export function drawDiamond(ctx: CanvasRenderingContext2D, el: Element): void {
  applyStroke(ctx, el);
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const pts = [
    { x: cx, y: el.y }, // top
    { x: el.x + el.w, y: cy }, // right
    { x: cx, y: el.y + el.h }, // bottom
    { x: el.x, y: cy }, // left
  ];
  ctx.beginPath();
  if (el.rounded) {
    const edge = Math.hypot(el.w / 2, el.h / 2);
    roundedPolyPath(ctx, pts, Math.min(14, edge * 0.35));
  } else {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }
  if (applyFill(ctx, el)) ctx.fill();
  ctx.stroke();
  drawCenteredLabel(ctx, el);
}

export function drawEllipse(ctx: CanvasRenderingContext2D, el: Element): void {
  applyStroke(ctx, el);
  ctx.beginPath();
  ctx.ellipse(
    el.x + el.w / 2,
    el.y + el.h / 2,
    Math.abs(el.w / 2),
    Math.abs(el.h / 2),
    0,
    0,
    Math.PI * 2,
  );
  if (applyFill(ctx, el)) ctx.fill();
  ctx.stroke();
  drawCenteredLabel(ctx, el);
}

export function drawLine(ctx: CanvasRenderingContext2D, el: LineElement): void {
  applyStroke(ctx, el);
  const { a, b, c } = curveControl(el);
  ctx.beginPath();
  if (el.elbow) {
    const pts = elbowRouteForEl(el);
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  } else {
    ctx.moveTo(a.x, a.y);
    if (c) ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
    else ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
}

export function drawArrow(ctx: CanvasRenderingContext2D, el: ArrowElement): void {
  applyStroke(ctx, el);
  const { a, b, c } = curveControl(el);
  ctx.beginPath();
  let from = a; // point just before the end, for the arrowhead angle
  let end = b; // where the arrowhead tip sits
  if (el.elbow) {
    // the elbow route may re-anchor its endpoints to the facing edges, so the
    // whole path (start, corners, tip) comes from the route, not the raw a/b.
    const pts = elbowRouteForEl(el);
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    from = pts[pts.length - 2];
    end = pts[pts.length - 1];
  } else if (c) {
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
    from = c;
  } else {
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();

  // arrowhead — angle from the tangent at the end
  const angle = Math.atan2(end.y - from.y, end.x - from.x);
  const size = Math.max(10, el.strokeWidth * 4);
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(
    end.x - size * Math.cos(angle - Math.PI / 6),
    end.y - size * Math.sin(angle - Math.PI / 6),
  );
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(
    end.x - size * Math.cos(angle + Math.PI / 6),
    end.y - size * Math.sin(angle + Math.PI / 6),
  );
  ctx.stroke();

  if (el.label) {
    const mid = connectorMidpoint(el);
    const fs = 14;
    ctx.font = `${fs}px Inter, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    const tw = ctx.measureText(el.label).width;
    const padX = 5;
    const padY = 3;
    // canvas bg so the line doesn't cross the text
    ctx.fillStyle = document.documentElement.dataset.theme === "light" ? "#fbfcf6" : "#0f120b";
    ctx.beginPath();
    const bw = tw + padX * 2;
    const bh = fs + padY * 2;
    if (ctx.roundRect) ctx.roundRect(mid.x - bw / 2, mid.y - bh / 2, bw, bh, 4);
    else ctx.rect(mid.x - bw / 2, mid.y - bh / 2, bw, bh);
    ctx.fill();
    ctx.fillStyle = adapt(el.strokeColor);
    ctx.fillText(el.label, mid.x, mid.y);
    ctx.textAlign = "left";
  }
}

export function drawFreehand(
  ctx: CanvasRenderingContext2D,
  el: FreehandElement,
): void {
  ctx.globalAlpha = el.opacity;
  ctx.fillStyle = adapt(el.strokeColor);
  const input = el.points.map((p, i) => [
    el.x + p.x,
    el.y + p.y,
    el.pressures?.[i] ?? 0.5,
  ]);
  const outline = getStroke(input, {
    size: el.strokeWidth * 3.2,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
  });
  if (outline.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    ctx.lineTo(outline[i][0], outline[i][1]);
  }
  ctx.closePath();
  ctx.fill();
}

export const CODE_PAD = 10; // world-unit padding inside a code block

function textFont(el: TextElement): string {
  return el.mono
    ? `${el.fontSize}px ui-monospace, monospace`
    : `${el.fontSize}px ${el.fontFamily}, sans-serif`;
}

/**
 * Lay out a text element into visual lines. When `autoWidth === false`, words
 * wrap to fit `el.w` (minus padding); otherwise only manual newlines break
 * lines. Returns the visual lines plus the element's world-space w/h so the
 * AABB matches what is drawn (including code-block padding).
 */
export function layoutText(
  ctx: CanvasRenderingContext2D,
  el: TextElement,
): { lines: string[]; w: number; h: number } {
  ctx.font = textFont(el);
  const pad = el.mono ? CODE_PAD : 0;
  const lineHeight = el.fontSize * 1.2;
  const paras = el.text.split("\n");
  let lines: string[];
  let contentW: number;

  if (el.autoWidth === false) {
    const maxW = Math.max(el.w - pad * 2, el.fontSize);
    lines = [];
    for (const para of paras) {
      const words = para.split(" ");
      let line = "";
      for (const word of words) {
        const test = line ? line + " " + word : word;
        if (ctx.measureText(test).width > maxW && line) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      lines.push(line);
    }
    contentW = maxW;
  } else {
    lines = paras;
    contentW = Math.max(4, ...paras.map((l) => ctx.measureText(l || " ").width));
  }

  const w = el.autoWidth === false ? el.w : contentW + pad * 2;
  const h = Math.max(lines.length, 1) * lineHeight + pad * 2;
  return { lines, w, h };
}

export function drawText(ctx: CanvasRenderingContext2D, el: TextElement): void {
  ctx.globalAlpha = el.opacity;
  const pad = el.mono ? CODE_PAD : 0;
  const { lines } = layoutText(ctx, el);

  if (el.mono) {
    ctx.fillStyle = "#282c34"; // One Dark editor background
    ctx.strokeStyle = "#3e4451";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(el.x, el.y, el.w, el.h, 6);
    else ctx.rect(el.x, el.y, el.w, el.h);
    ctx.fill();
    ctx.stroke();
  }

  ctx.textBaseline = "top";
  ctx.font = textFont(el);
  const lineHeight = el.fontSize * 1.2;

  if (el.mono) {
    // real syntax highlighting: draw each token in its theme color
    const hl = tokenizeLines(el.text, el.lang ?? "typescript");
    hl.forEach((runs, i) => {
      let x = el.x + pad;
      const y = el.y + pad + i * lineHeight;
      for (const run of runs) {
        ctx.fillStyle = colorFor(run.type);
        ctx.fillText(run.text, x, y);
        x += ctx.measureText(run.text).width;
      }
    });
    return;
  }

  const base = adapt(el.strokeColor);
  const align = el.align ?? "left";
  const runs = el.colorRuns?.length ? el.colorRuns : null;

  if (!runs) {
    ctx.fillStyle = base;
    const anchorX =
      align === "center" ? el.x + el.w / 2 : align === "right" ? el.x + el.w - pad : el.x + pad;
    ctx.textAlign = align;
    lines.forEach((line, i) => {
      ctx.fillText(line, anchorX, el.y + pad + i * lineHeight);
    });
    ctx.textAlign = "left";
    return;
  }

  // Multi-color: draw each visual line as a sequence of same-color segments,
  // positioning them by hand so alignment still works.
  ctx.textAlign = "left";
  const starts = lineStartOffsets(el.text, lines);
  lines.forEach((line, i) => {
    const y = el.y + pad + i * lineHeight;
    const segs = colorSegments(line, starts[i], runs, base);
    const lineW = ctx.measureText(line).width;
    let x =
      align === "center"
        ? el.x + el.w / 2 - lineW / 2
        : align === "right"
          ? el.x + el.w - pad - lineW
          : el.x + pad;
    for (const seg of segs) {
      ctx.fillStyle = seg.color === base ? base : adapt(seg.color);
      ctx.fillText(seg.text, x, y);
      x += ctx.measureText(seg.text).width;
    }
  });
}

/** Absolute start offset (into raw text) of each laid-out visual line. */
function lineStartOffsets(text: string, lines: string[]): number[] {
  const starts: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    if (line.length === 0) {
      starts.push(cursor);
      continue;
    }
    const idx = text.indexOf(line, cursor);
    const start = idx >= 0 ? idx : cursor;
    starts.push(start);
    cursor = start + line.length;
  }
  return starts;
}

/** Split a visual line into consecutive same-color runs. */
function colorSegments(
  line: string,
  start: number,
  runs: { start: number; end: number; color: string }[],
  base: string,
): { text: string; color: string }[] {
  const colorAt = (abs: number): string => {
    for (const r of runs) if (abs >= r.start && abs < r.end) return r.color;
    return base;
  };
  const segs: { text: string; color: string }[] = [];
  for (let i = 0; i < line.length; i++) {
    const c = colorAt(start + i);
    const last = segs[segs.length - 1];
    if (last && last.color === c) last.text += line[i];
    else segs.push({ text: line[i], color: c });
  }
  return segs;
}

/** Clamp/drop color runs so they stay within `[0, len)` after a text edit. */
export function clampColorRuns(
  runs: { start: number; end: number; color: string }[] | undefined,
  len: number,
): { start: number; end: number; color: string }[] | undefined {
  if (!runs?.length) return undefined;
  const out = runs
    .map((r) => ({ ...r, start: Math.max(0, r.start), end: Math.min(len, r.end) }))
    .filter((r) => r.start < r.end);
  return out.length ? out : undefined;
}

/** Merge a new [start,end) color over existing runs (replacing overlaps). */
export function mergeColorRun(
  runs: { start: number; end: number; color: string }[] | undefined,
  start: number,
  end: number,
  color: string,
): { start: number; end: number; color: string }[] {
  if (start >= end) return runs ?? [];
  const out: { start: number; end: number; color: string }[] = [];
  for (const r of runs ?? []) {
    if (r.end <= start || r.start >= end) {
      out.push(r); // no overlap
      continue;
    }
    if (r.start < start) out.push({ ...r, end: start }); // left remnant
    if (r.end > end) out.push({ ...r, start: end }); // right remnant
  }
  out.push({ start, end, color });
  out.sort((a, b) => a.start - b.start);
  return out;
}

/** Element-level measure used on commit/resize. */
export function measureTextEl(
  ctx: CanvasRenderingContext2D,
  el: TextElement,
): { w: number; h: number } {
  const { w, h } = layoutText(ctx, el);
  return { w, h };
}

export function drawIcon(ctx: CanvasRenderingContext2D, el: IconElement): void {
  drawIconArt(ctx, el.iconId, el.x, el.y, el.w, el.h, el.strokeColor, el.opacity);
  if (el.label) {
    ctx.globalAlpha = el.opacity;
    ctx.fillStyle = adapt(el.strokeColor);
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    ctx.font = `12px Inter, sans-serif`;
    ctx.fillText(el.label, el.x + el.w / 2, el.y + el.h + 4);
    ctx.textAlign = "left";
  }
}

export function drawImage(ctx: CanvasRenderingContext2D, el: ImageElement): void {
  ctx.globalAlpha = el.opacity;
  const img = getImage(el.src);
  if (img) {
    ctx.drawImage(img, el.x, el.y, el.w, el.h);
  } else {
    // placeholder while decoding
    ctx.fillStyle = "#1c2015";
    ctx.strokeStyle = "rgba(172, 213, 44, 0.3)";
    ctx.lineWidth = 1;
    ctx.fillRect(el.x, el.y, el.w, el.h);
    ctx.strokeRect(el.x, el.y, el.w, el.h);
  }
}

export function drawElement(ctx: CanvasRenderingContext2D, el: Element): void {
  ctx.save();
  if (el.rotation) {
    const cx = el.x + el.w / 2;
    const cy = el.y + el.h / 2;
    ctx.translate(cx, cy);
    ctx.rotate(el.rotation);
    ctx.translate(-cx, -cy);
  }
  switch (el.type) {
    case "rectangle":
      drawRectangle(ctx, el);
      break;
    case "diamond":
      drawDiamond(ctx, el);
      break;
    case "ellipse":
      drawEllipse(ctx, el);
      break;
    case "line":
      drawLine(ctx, el);
      break;
    case "arrow":
      drawArrow(ctx, el);
      break;
    case "freehand":
      drawFreehand(ctx, el);
      break;
    case "text":
      drawText(ctx, el);
      break;
    case "image":
      drawImage(ctx, el);
      break;
    case "icon":
      drawIcon(ctx, el);
      break;
  }
  ctx.restore();
}
