import type { ExtractedPdf, PdfjsLike } from "./pdf";
import { createOcrWorker, recognizePage } from "./ocr";
import { ensureStreamIteration } from "./stream-iteration";
import type { TextItem } from "./types";

/**
 * Loads pdf.js in the browser. The worker file is copied to /public/pdfjs at install time.
 * The legacy build carries fallbacks for browser features only months old (Map.getOrInsertComputed,
 * Math.sumPrecise, Promise.try...); the modern build fails on phones without them, older iPhones above all.
 */
export async function loadPdfjs(): Promise<PdfjsLike> {
  ensureStreamIteration();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  return pdfjs as unknown as PdfjsLike;
}

/** Render scale for OCR: about 160 dpi, enough for clean bank print without huge images. */
const OCR_SCALE = 2.2;

/**
 * Reads scanned pages entirely on this device: each page is drawn to a canvas and recognised by
 * Tesseract running in a web worker. (Tesseract downloads its English language data once.)
 */
export async function browserOcr(pdf: ExtractedPdf, onPage: (done: number, total: number) => void): Promise<Map<number, TextItem[]>> {
  const worker = await createOcrWorker();
  const out = new Map<number, TextItem[]>();
  try {
    const total = pdf.scannedPages.length;
    let done = 0;
    onPage(0, total);
    for (const n of pdf.scannedPages) {
      const page = await pdf.doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: OCR_SCALE });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("This browser can't draw the page for reading.");
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const { items } = await recognizePage(worker, canvas, n, OCR_SCALE, base.height);
      out.set(n, items);
      canvas.width = canvas.height = 0;
      onPage(++done, total);
    }
  } finally {
    await worker.terminate();
  }
  return out;
}

/** Reads a photo or screenshot of a statement on this device. Small images are enlarged first; OCR needs readable text. */
export async function browserOcrImage(data: Uint8Array): Promise<TextItem[]> {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)]));
  const scale = bitmap.width < 1600 ? 2 : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't draw the image for reading.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const worker = await createOcrWorker();
  try {
    const { items } = await recognizePage(worker, canvas, 1, scale, bitmap.height);
    return items;
  } finally {
    await worker.terminate();
    bitmap.close();
  }
}
