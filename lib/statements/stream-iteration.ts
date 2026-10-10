/**
 * pdf.js 6 reads each page's text with `for await (const part of readableStream)`. iPhone Safari's streams
 * can't be looped over that way ("undefined is not a function (near '...t of e...')"), so every PDF failed
 * to read there. This adds the standard `values()` / `Symbol.asyncIterator` to ReadableStream where they're
 * missing; browsers that have them are left alone.
 */
type IterableProto = {
  getReader(): ReadableStreamDefaultReader<unknown>;
  values?: unknown;
  [Symbol.asyncIterator]?: unknown;
};

export function ensureStreamIteration(proto: IterableProto | undefined = globalThis.ReadableStream?.prototype as IterableProto | undefined): void {
  if (!proto || typeof proto[Symbol.asyncIterator] === "function") return;

  function values(this: IterableProto, { preventCancel = false }: { preventCancel?: boolean } = {}): AsyncIterableIterator<unknown> {
    const reader = this.getReader();
    return {
      async next() {
        try {
          const result = await reader.read();
          if (result.done) reader.releaseLock();
          return result as IteratorResult<unknown>;
        } catch (err) {
          reader.releaseLock();
          throw err;
        }
      },
      // Leaving the loop early (break, throw) cancels the stream, as the standard says.
      async return(value?: unknown) {
        if (!preventCancel) {
          const cancelled = reader.cancel(value);
          reader.releaseLock();
          await cancelled;
        } else {
          reader.releaseLock();
        }
        return { done: true, value };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  Object.defineProperty(proto, "values", { value: values, writable: true, configurable: true });
  Object.defineProperty(proto, Symbol.asyncIterator, { value: values, writable: true, configurable: true });
}
