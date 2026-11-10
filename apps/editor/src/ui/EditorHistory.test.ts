import { describe, expect, it } from 'vitest';
import { EditorHistory } from './EditorHistory.js';

describe('EditorHistory', () => {
  it('undoes and redoes snapshots in order', () => {
    const history = new EditorHistory<number[]>(10);
    const initial = [1];
    const second = [1, 2];
    const third = [1, 2, 3];

    history.commit(initial);
    history.commit(second);

    expect(history.undo(third)).toEqual(second);
    expect(history.undo(second)).toEqual(initial);
    expect(history.canUndo).toBe(false);
    expect(history.redo(initial)).toEqual(second);
    expect(history.redo(second)).toEqual(third);
    expect(history.canRedo).toBe(false);
  });

  it('clears redo history after a new edit', () => {
    const history = new EditorHistory<number[]>(10);
    history.commit([1]);
    expect(history.undo([1, 2])).toEqual([1]);
    history.commit([1, 3]);
    expect(history.redo([1, 3])).toBeNull();
  });

  it('keeps only the configured number of undo snapshots', () => {
    const history = new EditorHistory<number[]>(2);
    history.commit([0]);
    history.commit([1]);
    history.commit([2]);

    expect(history.undo([3])).toEqual([2]);
    expect(history.undo([2])).toEqual([1]);
    expect(history.undo([1])).toBeNull();
  });

  it('validates its history limit', () => {
    expect(() => new EditorHistory(0)).toThrow(RangeError);
  });
});
