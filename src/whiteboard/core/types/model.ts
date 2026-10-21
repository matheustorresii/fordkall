// Domain contracts — see spec/03-data-model.md. Coordinates are WORLD space.

export type ElementType =
  | "rectangle"
  | "diamond"
  | "ellipse"
  | "line"
  | "arrow"
  | "freehand"
  | "text"
  | "image"
  | "icon";

export interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number; // reserved, always 0 in v1
  strokeColor: string;
  fillColor: string; // hex or "transparent"
  strokeWidth: number;
  opacity: number; // 0..1
  zIndex: number;
  seed: number; // reserved for roughjs
  rounded?: boolean; // rounded corners (rectangle & diamond)
  label?: string; // centered text label (shapes) / midpoint label (arrows)
  groupId?: string; // elements sharing a groupId select & move together
  createdAt: number;
  updatedAt: number;
}

export interface RectangleElement extends BaseElement {
  type: "rectangle";
}
export interface DiamondElement extends BaseElement {
  type: "diamond";
}
export interface EllipseElement extends BaseElement {
  type: "ellipse";
}

export interface LinePoint {
  x: number;
  y: number;
} // relative to (element.x, element.y)

export interface LineElement extends BaseElement {
  type: "line";
  points: LinePoint[];
  bend?: number; // perpendicular curve offset at the midpoint (0 = straight)
  elbow?: boolean; // orthogonal right-angle routing (overrides bend)
}

export interface Binding {
  elementId: string;
  focusX: number; // 0..1 on target AABB
  focusY: number; // 0..1 on target AABB
  gap: number;
}

export interface ArrowElement extends BaseElement {
  type: "arrow";
  points: LinePoint[];
  boundStart?: Binding;
  boundEnd?: Binding;
  bend?: number; // perpendicular curve offset at the midpoint (0 = straight)
  elbow?: boolean; // orthogonal right-angle routing (overrides bend)
}

export interface FreehandElement extends BaseElement {
  type: "freehand";
  points: LinePoint[];
  pressures?: number[];
}

/** A per-character color span into a text element's raw `text` (plain text only). */
export interface ColorRun {
  start: number; // inclusive char offset
  end: number; // exclusive char offset
  color: string; // hex
}

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  fontSize: number;
  fontFamily: string;
  mono?: boolean; // renders as a monospace "code block" with a panel background
  lang?: string; // syntax-highlight language for code blocks (when mono)
  align?: "left" | "center" | "right";
  // Per-range colors laid over `strokeColor` (plain text only; code blocks use
  // syntax highlighting). Offsets index into the raw `text`.
  colorRuns?: ColorRun[];
  // When false, `w` is a fixed wrap width and text reflows to it. When true
  // (default), the box hugs the text and only manual newlines break lines.
  autoWidth?: boolean;
}

export interface ImageElement extends BaseElement {
  type: "image";
  src: string; // data URL (base64)
  naturalW: number;
  naturalH: number;
}

export interface IconElement extends BaseElement {
  type: "icon";
  iconId: string; // key into the architecture icon set
}

export type Element =
  | RectangleElement
  | DiamondElement
  | EllipseElement
  | LineElement
  | ArrowElement
  | FreehandElement
  | TextElement
  | ImageElement
  | IconElement;

export interface StyleDefaults {
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  opacity: number;
  fontSize: number;
  mono: boolean; // default for new text elements (code-block style)
  rounded: boolean; // default rounded corners for new rectangles/diamonds
  lang: string; // default code-block language
  align: "left" | "center" | "right"; // default text alignment
}

export interface Viewport {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface BoardAppState {
  viewport: Viewport;
  defaults: StyleDefaults;
}

export interface Board {
  id: string;
  name: string;
  folderId: string | null;
  elements: Element[];
  appState: BoardAppState;
  thumbnailDataUrl?: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
  // local-only sync metadata (never serialized to the portable JSON)
  remoteSha?: string;
  baseRemoteUpdatedAt?: number;
  syncState?: "local-only" | "synced" | "remote-newer" | "conflict" | "offline";
  sharedGistId?: string;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface BoardMeta {
  id: string;
  name: string;
  folderId: string | null;
  updatedAt: number;
  thumbnailDataUrl?: string;
}

export interface LibraryIndex {
  folders: Folder[];
  boards: BoardMeta[];
}

export const SCHEMA_VERSION = 1;

export const DEFAULT_STYLE: StyleDefaults = {
  strokeColor: "#e8ecd9", // white-ish default (neon is opt-in via the palette)
  fillColor: "transparent",
  strokeWidth: 2,
  opacity: 1,
  fontSize: 20,
  mono: false,
  rounded: true,
  lang: "typescript",
  align: "left",
};

export type Tool =
  | "select"
  | "rectangle"
  | "diamond"
  | "ellipse"
  | "line"
  | "arrow"
  | "freehand"
  | "text"
  | "icon";
