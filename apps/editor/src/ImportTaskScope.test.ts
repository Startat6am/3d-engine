import { describe, expect, it } from 'vitest';
import { ImportTaskScope } from './ImportTaskScope.js';

describe('ImportTaskScope', () => {
  it('tracks and releases controllers without cancelling unrelated tasks', () => {
    const scope = new ImportTaskScope();
    const first = new AbortController();
    const second = new AbortController();

    scope.add(first);
    scope.add(second);
    expect(scope.activeCount).toBe(2);

    scope.release(first);
    expect(scope.activeCount).toBe(1);
    expect(first.signal.aborted).toBe(false);
    expect(second.signal.aborted).toBe(false);
  });

  it('aborts every remaining task when the owning editor is disposed', () => {
    const scope = new ImportTaskScope();
    const first = new AbortController();
    const second = new AbortController();

    scope.add(first);
    scope.add(second);
    scope.abortAll('Editor unmounted');

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(first.signal.reason).toBe('Editor unmounted');
    expect(scope.activeCount).toBe(0);
  });

  it('allows a scope to be reused after aborting its current tasks', () => {
    const scope = new ImportTaskScope();
    const first = new AbortController();
    scope.add(first);
    scope.abortAll();

    const next = new AbortController();
    scope.add(next);
    expect(first.signal.aborted).toBe(true);
    expect(next.signal.aborted).toBe(false);
    expect(scope.activeCount).toBe(1);
  });
});
