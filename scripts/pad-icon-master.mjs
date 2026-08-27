#!/usr/bin/env node
/**
 * Build a macOS-safe 1024×1024 icon master: opaque black canvas, logo inset ~10%.
 * Strips pre-baked squircle alpha (macOS applies its own mask) and scales artwork
 * to Apple's ~824px safe area (80.5% of 1024).
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
/** Apple macOS app icon artwork safe area (pt) at 1024px. */
const TARGET = 824;

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

// Flatten premultiplied squircle alpha onto opaque black.
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
    background: { r: 0, g: 0, b: 0, alpha: 1 },
  },
})
  .composite([{ input: scaled, left, top }])
  .png()
  .toFile(output);

const padPct = (((CANVAS - newW) / 2 / CANVAS) * 100).toFixed(1);
console.log(
  `Wrote ${output}\n  source: ${input}\n  trimmed: ${trimmed.width}×${trimmed.height} → scaled ${newW}×${newH} (${((newW / CANVAS) * 100).toFixed(1)}%)\n  inset: ~${padPct}% per side, opaque black canvas`
);
