export class EditorHistory<T> {
  readonly #limit: number;
  readonly #undo: T[] = [];
  readonly #redo: T[] = [];

  constructor(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError('History limit must be a positive integer');
    }
    this.#limit = limit;
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  commit(current: T): void {
    this.#undo.push(current);
    if (this.#undo.length > this.#limit) this.#undo.shift();
    this.#redo.length = 0;
  }

  undo(current: T): T | null {
    const previous = this.#undo.pop();
    if (previous === undefined) return null;
    this.#redo.push(current);
    return previous;
  }

  redo(current: T): T | null {
    const next = this.#redo.pop();
    if (next === undefined) return null;
    this.#undo.push(current);
    return next;
  }

  clear(): void {
    this.#undo.length = 0;
    this.#redo.length = 0;
  }
}
