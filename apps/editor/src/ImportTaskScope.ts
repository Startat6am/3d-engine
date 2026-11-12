/** Owns in-flight editor import controllers and aborts them with the editor lifecycle. */
export class ImportTaskScope {
  readonly #controllers = new Set<AbortController>();

  add(controller: AbortController): void {
    this.#controllers.add(controller);
  }

  release(controller: AbortController): void {
    this.#controllers.delete(controller);
  }

  abortAll(reason: unknown = 'Import scope disposed'): void {
    for (const controller of this.#controllers) controller.abort(reason);
    this.#controllers.clear();
  }

  get activeCount(): number {
    return this.#controllers.size;
  }
}
