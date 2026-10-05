import { StatementError, type TextItem } from "./types";

/**
 * OCR for scanned statements. It produces the same positioned text the PDF extractor does,
 * so one table parser handles both. OCR can misread digits, which is exactly why every
 * statement is reconciled against its own balances before anything is imported.
 */

interface OcrWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}
interface OcrPage {
  blocks?: Array<{ paragraphs?: Array<{ lines?: Array<{ words?: OcrWord[] }> }> }> | null;
}

export interface OcrWorkerLike {
  recognize(image: unknown, options?: object, output?: { blocks: boolean }): Promise<{ data: OcrPage }>;
  terminate(): Promise<unknown>;
}

/** Converts OCR words (image pixels, y down) into TextItems (PDF points, y up). */
export function ocrWordsToItems(data: OcrPage, pageNumber: number, scale: number, pageHeightPts: number): TextItem[] {
  const items: TextItem[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const w of line.words ?? []) {
          const text = w.text?.trim();
          if (!text || w.confidence < 25) continue;
          const h = (w.bbox.y1 - w.bbox.y0) / scale;
          items.push({
            str: text,
            x: w.bbox.x0 / scale,
            y: pageHeightPts - w.bbox.y1 / scale,
            width: (w.bbox.x1 - w.bbox.x0) / scale,
            height: Math.max(h, 4),
            page: pageNumber,
          });
        }
      }
    }
  }
  return items;
}

/** Average OCR confidence (0..100) over the words kept. */
export function ocrConfidence(data: OcrPage): number {
  const words = (data.blocks ?? []).flatMap((b) => (b.paragraphs ?? []).flatMap((p) => (p.lines ?? []).flatMap((l) => l.words ?? [])));
  if (words.length === 0) return 0;
  return words.reduce((t, w) => t + w.confidence, 0) / words.length;
}

export async function recognizePage(worker: OcrWorkerLike, image: unknown, pageNumber: number, scale: number, pageHeightPts: number) {
  try {
    const { data } = await worker.recognize(image, {}, { blocks: true });
    return { items: ocrWordsToItems(data, pageNumber, scale, pageHeightPts), confidence: ocrConfidence(data) };
  } catch (err) {
    throw new StatementError("ocr_failed", `Reading the scanned page failed (${err instanceof Error ? err.message : "unknown error"}).`);
  }
}

/** Starts a Tesseract worker (browser or Node). Language data is fetched once and cached by Tesseract. */
export async function createOcrWorker(): Promise<OcrWorkerLike> {
  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    // Statement tables are columns of text: treat the page as sparse text so columns aren't merged.
    await worker.setParameters({ tessedit_pageseg_mode: "11" as never, preserve_interword_spaces: "1" });
    return worker as unknown as OcrWorkerLike;
  } catch (err) {
    throw new StatementError("ocr_failed", `Couldn't start the text recogniser (${err instanceof Error ? err.message : "unknown error"}). Scanned statements need an internet connection the first time.`);
  }
}
