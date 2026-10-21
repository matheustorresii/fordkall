import type { Element } from "../types/model";
import { aabb, type Box } from "./geometry";

export type HandleId = "nw" | "ne" | "se" | "sw";

export interface Handle {
  id: HandleId;
  x: number; // world
  y: number;
}

export const HANDLE_SCREEN_SIZE = 8; // px on screen (constant regardless of zoom)

export function selectionBox(el: Element): Box {
  return aabb(el);
}

export function cornerHandles(el: Element): Handle[] {
  const b = aabb(el);
  return [
    { id: "nw", x: b.x, y: b.y },
    { id: "ne", x: b.x + b.w, y: b.y },
    { id: "se", x: b.x + b.w, y: b.y + b.h },
    { id: "sw", x: b.x, y: b.y + b.h },
  ];
}

/** The corner opposite a given handle (kept fixed while resizing). */
export function oppositeCorner(el: Element, h: HandleId): { x: number; y: number } {
  const b = aabb(el);
  switch (h) {
    case "nw":
      return { x: b.x + b.w, y: b.y + b.h };
    case "ne":
      return { x: b.x, y: b.y + b.h };
    case "se":
      return { x: b.x, y: b.y };
    case "sw":
      return { x: b.x + b.w, y: b.y };
  }
}
