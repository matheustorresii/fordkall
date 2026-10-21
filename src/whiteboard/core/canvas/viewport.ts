import type { Viewport } from "../types/model";
import { clamp, type Box, type Pt } from "./geometry";

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 64;

export function worldToScreen(v: Viewport, p: Pt): Pt {
  return { x: p.x * v.scale + v.offsetX, y: p.y * v.scale + v.offsetY };
}

export function screenToWorld(v: Viewport, p: Pt): Pt {
  return { x: (p.x - v.offsetX) / v.scale, y: (p.y - v.offsetY) / v.scale };
}

/**
 * Zoom keeping the world point under the cursor fixed on screen.
 * `cursor` is in screen space (canvas-local pixels).
 */
export function zoomAt(v: Viewport, cursor: Pt, factor: number): Viewport {
  const newScale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
  // world point under cursor must stay put:
  //   cursor = world*scale + offset  →  offset' = cursor - world*newScale
  const worldX = (cursor.x - v.offsetX) / v.scale;
  const worldY = (cursor.y - v.offsetY) / v.scale;
  return {
    scale: newScale,
    offsetX: cursor.x - worldX * newScale,
    offsetY: cursor.y - worldY * newScale,
  };
}

/** The world-space rectangle currently visible on a canvas of given css size. */
export function visibleWorldBox(v: Viewport, cssW: number, cssH: number): Box {
  const tl = screenToWorld(v, { x: 0, y: 0 });
  const br = screenToWorld(v, { x: cssW, y: cssH });
  return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
}
