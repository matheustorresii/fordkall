import type { Element, Viewport } from "../types/model";
import { Emitter } from "../lib/events";

/**
 * Imperative scene state read by the RAF loop every frame. NOT React state.
 * Mutations mark the scene dirty and notify subscribers (autosave, UI mirrors).
 */
export class SceneStore {
  elements: Element[] = [];
  /** Multi-selection. Use the helpers below rather than mutating directly. */
  selectedIds = new Set<string>();
  /** Element currently being edited in the text overlay; skipped by the renderer
   * so the on-canvas copy doesn't show doubled under the textarea. */
  editingId: string | null = null;
  /** Arrow whose label is being edited; its label is hidden while the overlay is open. */
  editingLabelId: string | null = null;
  /** Shape highlighted as a binding target while drawing/dragging an arrow. */
  bindHighlightId: string | null = null;
  /** Live marquee (drag-select) rectangle in world coords, or null. */
  marqueeRect: { x: number; y: number; w: number; h: number } | null = null;
  viewport: Viewport = { scale: 1, offsetX: 0, offsetY: 0 };

  setBindHighlight(id: string | null): void {
    if (this.bindHighlightId === id) return;
    this.bindHighlightId = id;
    this.markDirty();
  }

  /** Bumped on any change; the render loop redraws when this differs. */
  private _dirty = true;
  readonly changed = new Emitter();

  load(elements: Element[], viewport: Viewport): void {
    this.elements = elements;
    this.viewport = viewport;
    this.selectedIds.clear();
    this.editingId = null;
    this.editingLabelId = null;
    this.bindHighlightId = null;
    this.marqueeRect = null;
    this.markDirty();
    this.changed.notify();
  }

  markDirty(): void {
    this._dirty = true;
  }
  get dirty(): boolean {
    return this._dirty;
  }
  clearDirty(): void {
    this._dirty = false;
  }

  setViewport(v: Viewport): void {
    this.viewport = v;
    this.markDirty();
  }

  get(id: string): Element | undefined {
    return this.elements.find((e) => e.id === id);
  }

  all(): Element[] {
    return this.elements;
  }

  add(el: Element): void {
    this.elements.push(el);
    this.afterMutate();
  }

  /** Insert at a specific index (used by undo of delete). */
  insertAt(el: Element, index: number): void {
    this.elements.splice(index, 0, el);
    this.afterMutate();
  }

  remove(id: string): number {
    const idx = this.elements.findIndex((e) => e.id === id);
    if (idx >= 0) this.elements.splice(idx, 1);
    this.selectedIds.delete(id);
    this.afterMutate();
    return idx;
  }

  /** Replace an element in place (used by update/undo). */
  replace(el: Element): void {
    const idx = this.elements.findIndex((e) => e.id === el.id);
    if (idx >= 0) this.elements[idx] = el;
    this.afterMutate();
  }

  /** The single selected id, or null when 0 or >1 are selected. */
  get singleSelection(): string | null {
    return this.selectedIds.size === 1
      ? this.selectedIds.values().next().value ?? null
      : null;
  }

  isSelected(id: string): boolean {
    return this.selectedIds.has(id);
  }

  selectedElements(): Element[] {
    return this.elements.filter((e) => this.selectedIds.has(e.id));
  }

  /** Select exactly one element (or clear when null). */
  select(id: string | null): void {
    this.selectedIds.clear();
    if (id) this.selectedIds.add(id);
    this.markDirty();
    this.changed.notify();
  }

  addToSelection(id: string): void {
    this.selectedIds.add(id);
    this.markDirty();
    this.changed.notify();
  }

  toggleSelection(id: string): void {
    if (this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
    this.markDirty();
    this.changed.notify();
  }

  selectAll(): void {
    this.selectedIds = new Set(this.elements.map((e) => e.id));
    this.markDirty();
    this.changed.notify();
  }

  clearSelection(): void {
    if (this.selectedIds.size === 0) return;
    this.selectedIds.clear();
    this.markDirty();
    this.changed.notify();
  }

  nextZIndex(): number {
    let max = 0;
    for (const e of this.elements) if (e.zIndex > max) max = e.zIndex;
    return max + 1;
  }

  private afterMutate(): void {
    this.markDirty();
    this.changed.notify();
  }
}
