import type { Element } from "../types/model";
import type { Command } from "./History";

export function addElement(el: Element): Command {
  return {
    label: "add",
    do: (scene) => {
      scene.add(el);
      scene.select(el.id);
    },
    undo: (scene) => scene.remove(el.id),
  };
}

export function deleteElement(el: Element, index: number): Command {
  return {
    label: "delete",
    do: (scene) => scene.remove(el.id),
    undo: (scene) => {
      scene.insertAt(el, Math.min(index, scene.elements.length));
      scene.select(el.id);
    },
  };
}

/** before/after are full element snapshots (same id). */
export function updateElement(before: Element, after: Element): Command {
  return {
    label: "update",
    do: (scene) => scene.replace(after),
    undo: (scene) => scene.replace(before),
  };
}

/** Apply a batch of updates atomically (e.g. moving a shape + its bound arrows). */
export function updateMany(
  changes: { before: Element; after: Element }[],
): Command {
  return {
    label: "update-many",
    do: (scene) => changes.forEach((c) => scene.replace(c.after)),
    undo: (scene) => changes.forEach((c) => scene.replace(c.before)),
  };
}

/** Add several elements at once and select them all (used by paste/duplicate). */
export function addElements(els: Element[]): Command {
  return {
    label: "add-many",
    do: (scene) => {
      els.forEach((el) => scene.add(el));
      scene.selectedIds = new Set(els.map((e) => e.id));
      scene.markDirty();
      scene.changed.notify();
    },
    undo: (scene) => els.forEach((el) => scene.remove(el.id)),
  };
}

/** Delete several elements at once. `entries` keeps each element's index for undo. */
export function deleteElements(entries: { el: Element; index: number }[]): Command {
  // sort by index ascending so re-insertion on undo restores original order
  const sorted = [...entries].sort((a, b) => a.index - b.index);
  return {
    label: "delete-many",
    do: (scene) => sorted.forEach((e) => scene.remove(e.el.id)),
    undo: (scene) =>
      sorted.forEach((e) =>
        scene.insertAt(e.el, Math.min(e.index, scene.elements.length)),
      ),
  };
}
