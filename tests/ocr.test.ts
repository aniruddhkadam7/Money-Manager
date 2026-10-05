import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createOcrWorker, ocrWordsToItems, recognizePage, type OcrWorkerLike } from "@/lib/statements/ocr";
import { reconcile } from "@/lib/statements/reconcile";
import { parseStatementItems } from "@/lib/statements/table-parser";
import { expected, FIXTURES } from "./pdf-helpers";

const SCALE = 2.2; // the fixture's render scale
const PAGE_H = 842;

describe("ocr coordinates", () => {
  it("converts image pixels (y down) into PDF points (y up)", () => {
    const items = ocrWordsToItems(
      { blocks: [{ paragraphs: [{ lines: [{ words: [{ text: "Hello", confidence: 90, bbox: { x0: 220, y0: 440, x1: 440, y1: 462 } }] }] }] }] },
      3,
      SCALE,
      PAGE_H,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ str: "Hello", page: 3 });
    expect(items[0].x).toBeCloseTo(100, 5);
    expect(items[0].y).toBeCloseTo(PAGE_H - 462 / SCALE, 5);
    expect(items[0].width).toBeCloseTo(100, 5);
  });

  it("drops very low-confidence noise and empty words", () => {
    const items = ocrWordsToItems(
      { blocks: [{ paragraphs: [{ lines: [{ words: [
        { text: "   ", confidence: 99, bbox: { x0: 0, y0: 0, x1: 5, y1: 5 } },
        { text: "###", confidence: 10, bbox: { x0: 0, y0: 0, x1: 5, y1: 5 } },
        { text: "ok", confidence: 80, bbox: { x0: 0, y0: 0, x1: 5, y1: 5 } },
      ] }] }] }] },
      1, 1, 100,
    );
    expect(items.map((i) => i.str)).toEqual(["ok"]);
  });
});

describe("reading a scanned statement with real OCR", () => {
  let worker: OcrWorkerLike | null = null;
  afterAll(async () => {
    await worker?.terminate();
  });

  it("recovers the transactions, and the statement's own balances catch any misread digit", async () => {
    worker = await createOcrWorker();
    const pages = [];
    for (const n of [1, 2]) {
      const image = readFileSync(path.join(FIXTURES, `scanned_p${n}.jpg`));
      const { items, confidence } = await recognizePage(worker, image, n, SCALE, PAGE_H);
      expect(items.length, `page ${n} words`).toBeGreaterThan(40);
      expect(confidence).toBeGreaterThan(60);
      pages.push(items);
    }
    const parsed = parseStatementItems(pages, { ocr: true });
    expect(parsed.ocr).toBe(true);

    // How much of the statement did OCR read exactly right?
    const want = expected.sept.rows;
    const exact = parsed.rows.filter((r) => want.some((w) => w.date === r.date && w.balance === r.balanceMinor && w.debit === r.debitMinor && w.credit === r.creditMinor));
    console.log(`OCR read ${parsed.rows.length}/${want.length} rows, ${exact.length} exactly right`);
    expect(parsed.rows.length).toBeGreaterThanOrEqual(want.length - 2);
    expect(exact.length).toBeGreaterThanOrEqual(Math.floor(want.length * 0.7));

    // The safety net: whatever OCR got wrong must not pass reconciliation silently.
    const recon = reconcile(parsed);
    if (exact.length === want.length && parsed.rows.length === want.length) expect(recon.ok).toBe(true);
    else expect(recon.ok).toBe(false);
  }, 180_000);
});
