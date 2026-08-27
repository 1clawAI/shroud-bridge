#!/usr/bin/env node
/**
 * Build a macOS-safe 1024×1024 icon master on a transparent canvas.
 *
 * macOS Dock applies its own squircle mask at runtime. Icons must have
 * transparent corners (not an opaque square) and artwork scaled to roughly
 * 50–58% of the canvas — matching neighbors like Cursor (~50% color bbox).
 *
 * Strips any pre-baked squircle alpha from the brand source, extracts the
 * round logo artwork, scales it down, and centers it on transparency.
 *
 * Usage: node scripts/pad-icon-master.mjs [source.png] [output.png]
 */
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const iconsDir = path.join(root, "src-tauri", "icons");

const CANVAS = 1024;
/** Target max dimension for logo artwork (~54% of canvas; Cursor ≈ 50%). */
const TARGET = 560;

const defaultSource = path.join(
  root,
  "../../dashboard/public/logos/png/1claw-icon-dark-1024.png"
);
const fallbackSource = path.join(iconsDir, "1024x1024.png");
const input = path.resolve(
  process.argv[2] ||
    (fs.existsSync(defaultSource) ? defaultSource : fallbackSource)
);
const output = path.resolve(process.argv[3] || path.join(iconsDir, "1024x1024.png"));

if (!fs.existsSync(input)) {
  console.error(`Source not found: ${input}`);
  process.exit(1);
}

// Flatten premultiplied squircle alpha onto opaque black so trim finds logo bounds.
const flattened = await sharp(input).flatten({ background: { r: 0, g: 0, b: 0 } }).png().toBuffer();

// Trim near-black fringe; threshold ignores anti-aliased squircle edge pixels.
const trimmedBuf = await sharp(flattened).trim({ threshold: 12 }).png().toBuffer();
const trimmed = await sharp(trimmedBuf).metadata();

const scale = Math.min(TARGET / trimmed.width, TARGET / trimmed.height);
const newW = Math.max(1, Math.round(trimmed.width * scale));
const newH = Math.max(1, Math.round(trimmed.height * scale));

const scaled = await sharp(trimmedBuf)
  .resize(newW, newH, { fit: "inside", kernel: sharp.kernel.lanczos3 })
  .png()
  .toBuffer();

const left = Math.round((CANVAS - newW) / 2);
const top = Math.round((CANVAS - newH) / 2);

await sharp({
  create: {
    width: CANVAS,
    height: CANVAS,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([{ input: scaled, left, top }])
  .png()
  .toFile(output);

const padPct = (((CANVAS - newW) / 2 / CANVAS) * 100).toFixed(1);
console.log(
  `Wrote ${output}\n  source: ${input}\n  trimmed: ${trimmed.width}×${trimmed.height} → scaled ${newW}×${newH} (${((newW / CANVAS) * 100).toFixed(1)}%)\n  inset: ~${padPct}% per side, transparent canvas (macOS applies squircle)`
);
