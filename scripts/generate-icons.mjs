#!/usr/bin/env node
/**
 * Regenerate icon.ico, icon.icns, and Tauri PNG set from a square master (default: src-tauri/icons/1024x1024.png).
 * Run from package root: pnpm run icons [path-to-source.png]
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const srcTauri = path.join(root, "src-tauri");
const iconsDir = path.join(srcTauri, "icons");
const defaultSrc = path.join(iconsDir, "1024x1024.png");
const input = path.resolve(process.argv[2] || defaultSrc);

if (!fs.existsSync(input)) {
  console.error(`Source not found: ${input}`);
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
  const master = fs.existsSync(defaultSrc) ? defaultSrc : input;
  for (const s of [16, 256, 512]) {
    spawnSync(
      "sips",
      ["-z", String(s), String(s), master, "--out", path.join(iconsDir, `${s}x${s}.png`)],
      { stdio: "inherit" }
    );
  }
}
