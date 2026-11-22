import type { ProjectFileStore } from '@engine/project-storage';

const DATABASE_NAME = 'choreon-editor-recovery';
const DATABASE_VERSION = 1;
const FILES_STORE = 'project-files';

/** IndexedDB-backed project files used for crash/reload recovery in the current browser. */
export class EditorRecoveryStore implements ProjectFileStore {
  #database: Promise<IDBDatabase> | null = null;

  async readFile(path: string): Promise<Uint8Array> {
    const database = await this.#open();
    return new Promise((resolve, reject) => {
      const request = database
        .transaction(FILES_STORE, 'readonly')
        .objectStore(FILES_STORE)
        .get(path);
      request.onsuccess = () => {
        const value = request.result;
        if (!(value instanceof ArrayBuffer)) {
          reject(new Error(`Recovery file not found: ${path}`));
          return;
        }
        resolve(new Uint8Array(value));
      };
      request.onerror = () => reject(request.error ?? new Error('Could not read recovery data'));
    });
  }

  async writeFile(
    path: string,
    data: Uint8Array,
    options: { readonly immutable?: boolean } = {},
  ): Promise<void> {
    const database = await this.#open();
    if (options.immutable) {
      try {
        const current = await this.readFile(path);
        if (
          current.length === data.length &&
          current.every((value, index) => value === data[index])
        )
          return;
        throw new Error(`Recovery asset is immutable: ${path}`);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith('Recovery file not found:'))
          throw error;
      }
    }
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(FILES_STORE, 'readwrite');
      transaction.objectStore(FILES_STORE).put(data.slice().buffer, path);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Could not persist recovery data'));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Recovery write was aborted'));
    });
  }

  #open(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined')
      return Promise.reject(new Error('IndexedDB is unavailable'));
    this.#database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(FILES_STORE))
          request.result.createObjectStore(FILES_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not open recovery storage'));
    });
    return this.#database;
  }
}
