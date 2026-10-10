import { afterEach, describe, expect, it } from "vitest";
import { ensureStreamIteration } from "@/lib/statements/stream-iteration";

// Node's streams can be looped over already; take that away to behave like iPhone Safari.
const proto = ReadableStream.prototype as unknown as Record<PropertyKey, unknown>;
const native = { values: proto.values, iterator: proto[Symbol.asyncIterator] };
afterEach(() => {
  Object.defineProperty(proto, "values", { value: native.values, writable: true, configurable: true });
  Object.defineProperty(proto, Symbol.asyncIterator, { value: native.iterator, writable: true, configurable: true });
});
const likeSafari = () => {
  delete proto.values;
  delete proto[Symbol.asyncIterator];
};
const streamOf = (parts: string[], onCancel?: () => void) =>
  new ReadableStream<string>({
    start(c) {
      parts.forEach((p) => c.enqueue(p));
      c.close();
    },
    cancel: onCancel,
  });

describe("ensureStreamIteration", () => {
  it("lets `for await` read a stream where the browser can't", async () => {
    likeSafari();
    ensureStreamIteration();
    const got: string[] = [];
    for await (const part of streamOf(["a", "b", "c"]) as unknown as AsyncIterable<string>) got.push(part);
    expect(got).toEqual(["a", "b", "c"]);
  });

  it("cancels the stream when the loop stops early, and frees it", async () => {
    likeSafari();
    ensureStreamIteration();
    let cancelled = false;
    const stream = streamOf(["a", "b"], () => (cancelled = true));
    for await (const part of stream as unknown as AsyncIterable<string>) if (part === "a") break;
    expect(cancelled).toBe(true);
    expect(stream.locked).toBe(false);
  });

  it("leaves a browser that can already do it alone", () => {
    ensureStreamIteration();
    expect(proto[Symbol.asyncIterator]).toBe(native.iterator);
  });
});
