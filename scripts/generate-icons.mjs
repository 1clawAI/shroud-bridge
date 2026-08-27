#!/usr/bin/env node
/**
 * Regenerate icon.ico, icon.icns, and Tauri PNG set from a square master (default: src-tauri/icons/1024x1024.png).
 * Applies macOS safe-area padding before generation unless --no-pad is passed.
 * Run from package root: npm run icons [path-to-brand-source.png]
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const srcTauri = path.join(root, "src-tauri");
const iconsDir = path.join(srcTauri, "icons");
const masterPath = path.join(iconsDir, "1024x1024.png");
const brandDefault = path.join(
  root,
  "../../dashboard/public/logos/png/1claw-icon-dark-1024.png"
);

const args = process.argv.slice(2).filter((a) => a !== "--no-pad");
const noPad = process.argv.includes("--no-pad");
const brandSource = path.resolve(
  args[0] || (fs.existsSync(brandDefault) ? brandDefault : masterPath)
);

if (!noPad) {
  const padScript = path.join(__dirname, "pad-icon-master.mjs");
  const pad = spawnSync(process.execPath, [padScript, brandSource, masterPath], {
    cwd: root,
    stdio: "inherit",
  });
  if (pad.status !== 0) process.exit(pad.status ?? 1);
}

const input = masterPath;
if (!fs.existsSync(input)) {
  console.error(`Master not found: ${input}`);
  process.exit(1);
}

const r = spawnSync(
  "npx",
  ["--yes", "@tauri-apps/cli", "icon", input, "-o", iconsDir],
  { cwd: srcTauri, stdio: "inherit", shell: process.platform === "win32" }
);

if (r.status !== 0) process.exit(r.status ?? 1);

// Tauri CLI may not refresh every size in tauri.conf.json; on macOS, align 16/256/512 with the 1024 master.
if (process.platform === "darwin") {
  const master = masterPath;
  for (const s of [16, 256, 512]) {
    spawnSync(
      "sips",
      ["-z", String(s), String(s), master, "--out", path.join(iconsDir, `${s}x${s}.png`)],
      { stdio: "inherit" }
    );
  }
}
