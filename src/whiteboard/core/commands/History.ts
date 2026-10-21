import type { SceneStore } from "../canvas/SceneStore";

export interface Command {
  label: string;
  do(scene: SceneStore): void;
  undo(scene: SceneStore): void;
}

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private limit = 200;

  /** Notified after any execute/undo/redo so callers can autosave/refresh. */
  onChange: (() => void) | null = null;

  execute(scene: SceneStore, cmd: Command): void {
    cmd.do(scene);
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.onChange?.();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(scene: SceneStore): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo(scene);
    this.redoStack.push(cmd);
    this.onChange?.();
  }

  redo(scene: SceneStore): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.do(scene);
    this.undoStack.push(cmd);
    this.onChange?.();
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
