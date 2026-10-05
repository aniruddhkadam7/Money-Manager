import { StatementError, type TextItem } from "./types";

/** The slice of pdf.js we use. Injected so the same code runs in the browser and in Node tests. */
export interface PdfPageLike {
  view: number[];
  getTextContent(): Promise<{ items: Array<{ str?: string; transform?: number[]; width?: number; height?: number }> }>;
  getViewport(opts: { scale: number }): { width: number; height: number };
  render(opts: { canvas?: unknown; canvasContext?: unknown; viewport: unknown }): { promise: Promise<void> };
}
export interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
  destroy?(): Promise<void>;
}
export interface PdfjsLike {
  getDocument(src: Record<string, unknown>): { promise: Promise<PdfDocLike> };
}

export interface ExtractedPdf {
  doc: PdfDocLike;
  pageCount: number;
  pages: TextItem[][];
  /** Visible characters found in the text layer across all pages. */
  charCount: number;
  /** Pages with (almost) no text layer: scans or images. */
  scannedPages: number[];
}

function describeError(err: unknown): StatementError {
  const e = err as { name?: string; code?: number; message?: string };
  if (e?.name === "PasswordException") {
    return e.code === 2
      ? new StatementError("password_incorrect", "That password didn't work. Please try again.")
      : new StatementError("password_required", "This statement is password-protected. Enter its password to continue.");
  }
  return new StatementError("invalid_pdf", "This file couldn't be read as a PDF. Is it the original statement, not a photo or a renamed file?");
}

/**
 * Reads every page's text with positions. The bytes are copied because pdf.js takes ownership
 * of the buffer it is given.
 */
export async function extractPdfText(data: Uint8Array, pdfjs: PdfjsLike, password?: string): Promise<ExtractedPdf> {
  let doc: PdfDocLike;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(data),
      password,
      isEvalSupported: false,
      useSystemFonts: true,
      verbosity: 0,
    }).promise;
  } catch (err) {
    throw describeError(err);
  }

  const pages: TextItem[][] = [];
  const scannedPages: number[] = [];
  let charCount = 0;

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items: TextItem[] = [];
    for (const raw of content.items) {
      const str = raw.str ?? "";
      if (!str.trim() || !raw.transform) continue;
      items.push({
        str,
        x: raw.transform[4],
        y: raw.transform[5],
        width: raw.width ?? str.length * 4,
        height: raw.height || Math.abs(raw.transform[3]) || 8,
        page: n,
      });
      charCount += str.trim().length;
    }
    if (items.reduce((t, i) => t + i.str.trim().length, 0) < 20) scannedPages.push(n);
    pages.push(items);
  }
  return { doc, pageCount: doc.numPages, pages, charCount, scannedPages };
}
