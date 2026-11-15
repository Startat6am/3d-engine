import type { AssetImportContext, AssetImporter, ImportedAsset } from '@engine/assets';
import type { GlbAsset } from '@engine/gltf-importer';

type WorkerResponse =
  | {
      readonly type: 'success';
      readonly requestId: number;
      readonly result: ImportedAsset<GlbAsset>;
      readonly source: ArrayBuffer;
    }
  | {
      readonly type: 'failure';
      readonly requestId: number;
      readonly error: { readonly name: string; readonly message: string; readonly code?: string };
    };

let nextRequestId = 1;

/** Runs GLB decoding off the UI thread and transfers the source buffer back after success. */
export class WorkerGlbImporter implements AssetImporter<GlbAsset> {
  readonly id = 'engine.gltf.glb';
  readonly version = '0.1.0';
  readonly extensions = ['glb'] as const;

  import(source: ArrayBuffer, context: AssetImportContext): Promise<ImportedAsset<GlbAsset>> {
    if (!context.onSourceRestored) {
      return Promise.reject(new Error('Worker GLB import requires a source-restoration callback'));
    }
    if (context.signal.aborted) return Promise.reject(new Error('GLB import was aborted'));

    const worker = new Worker(new URL('./glb-import.worker.ts', import.meta.url), {
      type: 'module',
    });
    const requestId = nextRequestId++;

    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        context.signal.removeEventListener('abort', onAbort);
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('messageerror', onMessageError);
        worker.removeEventListener('error', onError);
        worker.terminate();
      };
      const rejectOnce = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onAbort = () => rejectOnce(new Error('GLB import was aborted'));
      const onMessageError = () =>
        rejectOnce(new Error('GLB import worker returned an unreadable message'));
      const onError = (event: ErrorEvent) =>
        rejectOnce(new Error(event.message || 'GLB import worker failed'));
      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        const response = event.data;
        if (response.requestId !== requestId) return;
        if (response.type === 'failure') {
          const error = new Error(response.error.message);
          error.name = response.error.name;
          if (response.error.code) Object.assign(error, { code: response.error.code });
          rejectOnce(error);
          return;
        }
        try {
          context.onSourceRestored?.(response.source);
        } catch (cause) {
          rejectOnce(cause instanceof Error ? cause : new Error(String(cause)));
          return;
        }
        if (settled) return;
        settled = true;
        cleanup();
        resolve(response.result);
      };

      worker.addEventListener('message', onMessage);
      worker.addEventListener('messageerror', onMessageError);
      worker.addEventListener('error', onError);
      context.signal.addEventListener('abort', onAbort, { once: true });
      if (context.signal.aborted) {
        onAbort();
        return;
      }
      try {
        worker.postMessage(
          {
            requestId,
            uri: context.uri,
            settings: context.settings,
            source,
          },
          [source],
        );
      } catch (cause) {
        rejectOnce(cause instanceof Error ? cause : new Error(String(cause)));
      }
    });
  }
}
