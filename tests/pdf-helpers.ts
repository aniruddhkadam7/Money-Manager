import { readFileSync } from "node:fs";
import path from "node:path";
import { extractPdfText, type PdfjsLike } from "@/lib/statements/pdf";
import { parseStatementItems } from "@/lib/statements/table-parser";

export const FIXTURES = path.resolve(__dirname, "fixtures");

export const fixture = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));
export const expected = JSON.parse(readFileSync(path.join(FIXTURES, "expected.json"), "utf-8")) as {
  sept: { opening: number; closing: number; rows: ExpectedRow[] };
  overlap: { opening: number; closing: number; rows: ExpectedRow[] };
  password: string;
};
export interface ExpectedRow {
  date: string;
  narration: string;
  debit: number;
  credit: number;
  balance: number;
}

let pdfjsPromise: Promise<PdfjsLike> | null = null;
/** pdf.js's Node-friendly build. */
export function nodePdfjs(): Promise<PdfjsLike> {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => m as unknown as PdfjsLike);
  return pdfjsPromise;
}

export async function parseFixture(name: string, password?: string) {
  const extracted = await extractPdfText(fixture(name), await nodePdfjs(), password);
  return { extracted, parsed: parseStatementItems(extracted.pages, { ocr: false }) };
}
