import type { ImportedAsset } from '@engine/assets';
import { GlbImporter, type GlbAsset } from '@engine/gltf-importer';

type ImportRequest = {
  readonly requestId: number;
  readonly uri: string;
  readonly settings: Readonly<Record<string, string | number | boolean>>;
  readonly source: ArrayBuffer;
};

type ImportResponse =
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

const workerScope = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<ImportRequest>) => void): void;
  postMessage(message: ImportResponse, transfer?: Transferable[]): void;
};

function collectTransferableBuffers(value: unknown): Set<ArrayBuffer> {
  const buffers = new Set<ArrayBuffer>();
  const visited = new Set<object>();
  const visit = (current: unknown): void => {
    if (current instanceof ArrayBuffer) {
      buffers.add(current);
      return;
    }
    if (ArrayBuffer.isView(current)) {
      if (current.buffer instanceof ArrayBuffer) buffers.add(current.buffer);
      return;
    }
    if (typeof current !== 'object' || current === null || visited.has(current)) return;
    visited.add(current);
    for (const nested of Object.values(current)) visit(nested);
  };
  visit(value);
  return buffers;
}

workerScope.addEventListener('message', async (event) => {
  const request = event.data;
  try {
    const result = await new GlbImporter().import(request.source, {
      uri: request.uri,
      settings: request.settings,
      signal: new AbortController().signal,
    });
    const transferables = collectTransferableBuffers(result);
    transferables.add(request.source);
    workerScope.postMessage(
      { type: 'success', requestId: request.requestId, result, source: request.source },
      [...transferables],
    );
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    workerScope.postMessage({
      type: 'failure',
      requestId: request.requestId,
      error: {
        name: error.name,
        message: error.message,
        ...(code ? { code } : {}),
      },
    });
  }
});
