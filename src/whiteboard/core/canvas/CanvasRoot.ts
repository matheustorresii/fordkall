import type { Element, StyleDefaults, Tool, Viewport } from "../types/model";
import { DEFAULT_STYLE } from "../types/model";
import { SceneStore } from "./SceneStore";
import { History } from "../commands/History";
import { draw } from "./Renderer";
import { InputController } from "./InputController";
import { MAX_SCALE, MIN_SCALE, zoomAt } from "./viewport";
import { aabb, clamp, setBoxResolver } from "./geometry";
import { setImageRedrawHandler,clearImageCache } from "./imageCache";
import { setSvgReadyHandler } from "./svgIcons";

export interface TextEditRequest {
  id: string | null; // null = new text element
  worldX: number;
  worldY: number;
  initial: string;
  fontSize: number;
  color: string;
  mono: boolean;
  autoWidth: boolean;
  boxWidth: number; // world-space wrap width when autoWidth is false
  targetKind?: "text" | "label"; // "label" edits an element's `label`, not a text element
}

export interface ContextMenuInfo {
  screenX: number;
  screenY: number;
  hasSelection: boolean;
  canGroup: boolean;
  canUngroup: boolean;
}

/**
 * Owns the <canvas>, the render loop, DPR/resize handling, and wires input.
 * Zero React inside. The React chrome talks to it through the public methods
 * and the callback properties below.
 */
export class CanvasRoot {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  readonly scene = new SceneStore();
  readonly history = new History();
  private input: InputController;

  tool: Tool = "select";
  style: StyleDefaults = { ...DEFAULT_STYLE };
  preview: Element | null = null;
  readonly: boolean = false;
  sketchOnly: boolean = false; // Fixed-surface drawing games, without editor shortcuts/pan.
  snapEnabled: boolean = true;
  iconId: string = "database"; // icon to stamp when the icon tool is active

  private dpr = Math.max(1, window.devicePixelRatio || 1);
  private cssW = 0;
  private cssH = 0;
  private raf = 0;
  private ro: ResizeObserver;

  // callbacks the React chrome subscribes to
  onChange: (() => void) | null = null; // scene mutated (autosave)
  onUiSync: (() => void) | null = null; // selection/viewport/tool changed
  onTextEdit: ((req: TextEditRequest | null) => void) | null = null;
  onToolChange: ((t: Tool) => void) | null = null; // tool changed internally
  onContextMenu: ((info: ContextMenuInfo) => void) | null = null; // right-click menu

  // Set by the text overlay so a color-swatch click can paint the current
  // text selection range (multi-color text) instead of the whole element.
  editingTextSel: { start: number; end: number } | null = null;
  getEditingTextValue: (() => string | null) | null = null;

  constructor(host: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "canvas-host";
    this.canvas.style.touchAction = "none";
    host.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;

    this.history.onChange = () => {
      this.scene.markDirty();
      this.onChange?.();
      this.onUiSync?.();
    };
    this.scene.changed.subscribe(() => this.onUiSync?.());
    setImageRedrawHandler(() => this.scene.markDirty());
    setSvgReadyHandler(() => this.scene.markDirty());
    setBoxResolver((id) => {
      const el = this.scene.get(id);
      return el ? aabb(el) : null;
    });

    this.input = new InputController(this);

    this.ro = new ResizeObserver(() => this.resize(host));
    this.ro.observe(host);
    this.resize(host);

    const tick = () => {
      if (this.scene.dirty) {
        draw(this.ctx, this.scene, this.cssW, this.cssH, this.dpr, this.preview, this.snapEnabled);
        this.scene.clearDirty();
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private resize(host: HTMLElement): void {
    const rect = host.getBoundingClientRect();
    this.cssW = rect.width;
    this.cssH = rect.height;
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
    this.scene.markDirty();
  }

  get size(): { w: number; h: number } {
    return { w: this.cssW, h: this.cssH };
  }

  loadBoard(elements: Element[], viewport: Viewport): void {
    this.history.clear();
    this.scene.load(elements, viewport);
    this.onUiSync?.();
  }

  setTool(t: Tool): void {
    this.tool = t;
    if (t !== "select") this.scene.select(null);
    this.scene.setBindHighlight(null);
    this.onToolChange?.(t);
    this.onUiSync?.();
  }

  setStyle(patch: Partial<StyleDefaults>): void {
    this.style = { ...this.style, ...patch };
    this.input.applyStyleToSelection(patch);
    this.onUiSync?.();
  }

  /** Change the routing of the selected connectors (straight/curve/elbow). */
  setRouting(mode: "straight" | "curve" | "elbow"): void {
    this.input.applyRoutingToSelection(mode);
    this.onUiSync?.();
  }

  setSnap(on: boolean): void {
    this.snapEnabled = on;
    this.scene.markDirty(); // grid dots appear/disappear immediately
  }

  /** Choose an architecture icon and arm the icon (stamp) tool. */
  setIcon(id: string): void {
    this.iconId = id;
    this.setTool("icon");
  }

  undo(): void {
    this.scene.select(null);
    this.history.undo(this.scene);
  }
  redo(): void {
    this.scene.select(null);
    this.history.redo(this.scene);
  }

  // ---- zoom controls used by the zoom pill ----
  private centerCursor(): { x: number; y: number } {
    return { x: this.cssW / 2, y: this.cssH / 2 };
  }
  zoomBy(factor: number): void {
    this.scene.setViewport(zoomAt(this.scene.viewport, this.centerCursor(), factor));
    this.onUiSync?.();
  }
  setZoom(scale: number): void {
    const v = this.scene.viewport;
    const c = this.centerCursor();
    const clamped = clamp(scale, MIN_SCALE, MAX_SCALE);
    this.scene.setViewport(zoomAt(v, c, clamped / v.scale));
    this.onUiSync?.();
  }
  resetView(): void {
    this.scene.setViewport({ scale: 1, offsetX: 0, offsetY: 0 });
    this.onUiSync?.();
  }

  /** Called by React when the text overlay is committed. */
  commitText(req: TextEditRequest, text: string): void {
    this.input.commitText(req, text);
  }

  /** Live-sync the text being edited so the on-canvas copy updates per keystroke. */
  setEditingText(text: string): void {
    this.input.setEditingText(text);
  }

  /** Toggle the selected text element into/out of code-block (monospace) mode. */
  setTextMono(on: boolean): void {
    this.input.setSelectionMono(on);
  }

  /** Delete the current selection (used by the mobile delete button). */
  deleteSelection(): void {
    this.input.deleteSelection();
  }

  duplicateSelection(): void {
    this.input.duplicateSelection();
  }

  /** Re-stack the selection (context menu). */
  reorder(mode: "front" | "back" | "forward" | "backward"): void {
    this.input.reorderSelection(mode);
  }
  group(): void {
    this.input.groupSelection();
  }
  ungroup(): void {
    this.input.ungroupSelection();
  }

  destroy(): void {
    clearImageCache();setSvgReadyHandler(()=>{});setBoxResolver(()=>null);
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.input.destroy();
    this.canvas.remove();
  }
}
