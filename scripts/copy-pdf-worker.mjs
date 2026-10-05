// Copies pdf.js's worker next to the app so the browser can load it from /pdfjs/.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";

const src = "node_modules/pdfjs-dist/build/pdf.worker.min.mjs";
if (!existsSync(src)) {
  console.warn("pdf.js worker not found; skipping copy");
  process.exit(0);
}
mkdirSync("public/pdfjs", { recursive: true });
copyFileSync(src, "public/pdfjs/pdf.worker.min.mjs");
console.log("pdf.js worker copied to public/pdfjs");
