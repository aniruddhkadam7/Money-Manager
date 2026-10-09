// One-off: downloads each brand's logo into public/brands so the app never asks a logo service at runtime.
// Run:  node scripts/fetch-brand-logos.mjs   (needs internet; safe to re-run, skips existing files)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "public", "brands");
mkdirSync(out, { recursive: true });

const source = readFileSync(path.join(root, "lib", "finance", "brands.ts"), "utf-8");
const banks = readFileSync(path.join(root, "lib", "finance", "bank-logos.ts"), "utf-8");
const brands = [
  ...[...source.matchAll(/b\("([a-z0-9]+)",\s*"[^"]*",\s*"([^"]+)"/g)],
  ...[...banks.matchAll(/k\("([a-z0-9-]+)",\s*"[^"]*",\s*"([^"]+)"/g)],
].map((m) => ({ slug: m[1], domain: m[2] }));

const fetchLogo = async (domain) => {
  const res = await fetch(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`, { redirect: "follow" });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
};

// The service answers an unknown site with a generic globe: recognise it so it is never used as a "logo".
const globe = createHash("sha256").update((await fetchLogo("this-site-does-not-exist-abc123.example")) ?? "").digest("hex");

let ok = 0;
const missing = [];
for (const { slug, domain } of brands) {
  const file = path.join(out, `${slug}.png`);
  if (existsSync(file)) {
    ok++;
    continue;
  }
  const png = await fetchLogo(domain).catch(() => null);
  if (!png || createHash("sha256").update(png).digest("hex") === globe) {
    missing.push(slug);
    continue;
  }
  // The service sometimes answers with a JPEG or ICO; the app loads `<slug>.png`, so only real PNGs are kept.
  if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    missing.push(`${slug} (not a PNG: convert it by hand)`);
    continue;
  }
  writeFileSync(file, png);
  ok++;
}
console.log(`logos: ${ok}/${brands.length}`, missing.length ? `missing: ${missing.join(", ")}` : "");
