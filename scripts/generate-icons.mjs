#!/usr/bin/env node
/**
 * Regenerate icon.ico, icon.icns, and Tauri PNG set from a square master.
 *
 * Modes:
 *   npm run icons                         — pad dashboard logo, tauri icon
 *   npm run icons -- --no-pad [source]    — skip padding (pre-squircled master)
 *   npm run icons -- --brand-kit [dir]    — official brand kit (icns + iconset)
 *
 * Brand kit dir defaults to ../../Pictures/1claw-v2-brand-kit/1claw-brand-kit/appicon
 * or pass explicit path containing 1claw.icns and 1claw.iconset.zip.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const srcTauri = path.join(root, "src-tauri");
const iconsDir = path.join(srcTauri, "icons");
const masterPath = path.join(iconsDir, "1024x1024.png");
const brandDefault = path.join(
  root,
  "../../dashboard/public/logos/png/1claw-icon-dark-1024.png"
);

/** Apple iconset filename → Tauri bundle PNG name. */
const ICONSET_TO_TAURI = {
  "icon_16x16.png": "16x16.png",
  "icon_16x16@2x.png": "32x32.png",
  "icon_32x32@2x.png": "64x64.png",
  "icon_128x128.png": "128x128.png",
  "icon_128x128@2x.png": "128x128@2x.png",
  "icon_256x256.png": "256x256.png",
  "icon_512x512.png": "512x512.png",
  "icon_512x512@2x.png": "1024x1024.png",
};

const defaultBrandKitDir = path.join(
  os.homedir(),
  "Pictures/1claw-v2-brand-kit/1claw-brand-kit/appicon"
);

function parseArgs() {
  const raw = process.argv.slice(2);
  const brandKitIdx = raw.indexOf("--brand-kit");
  const brandKit =
    brandKitIdx !== -1
      ? path.resolve(raw[brandKitIdx + 1] || defaultBrandKitDir)
      : null;
  const noPad = raw.includes("--no-pad") || brandKit !== null;
  const positional = raw.filter(
    (a, i) =>
      a !== "--no-pad" &&
      a !== "--brand-kit" &&
      (brandKitIdx === -1 || (i !== brandKitIdx && i !== brandKitIdx + 1))
  );
  return { brandKit, noPad, positional };
}

function applyIconsetFromZip(zipSrc, destDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "1claw-iconset-"));
  const r = spawnSync("unzip", ["-q", zipSrc, "-d", tmp], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);

  const iconsetDir = path.join(tmp, "1claw.iconset");
  if (!fs.existsSync(iconsetDir)) {
    console.error(`Expected 1claw.iconset/ inside ${zipSrc}`);
    process.exit(1);
  }

  let masterSource = null;
  for (const [srcName, destName] of Object.entries(ICONSET_TO_TAURI)) {
    const src = path.join(iconsetDir, srcName);
    if (!fs.existsSync(src)) {
      console.warn(`Skipping missing iconset entry: ${srcName}`);
      continue;
    }
    fs.copyFileSync(src, path.join(destDir, destName));
    console.log(`  ${srcName} → ${destName}`);
    if (srcName === "icon_512x512@2x.png") masterSource = src;
  }
  return { iconsetDir, masterSource };
}

function copyBrandKitIcons(brandKitDir) {
  const icnsSrc = path.join(brandKitDir, "1claw.icns");
  const zipSrc = path.join(brandKitDir, "1claw.iconset.zip");
  const png1024 = path.join(brandKitDir, "1claw-icon-1024.png");

  if (!fs.existsSync(icnsSrc)) {
    console.error(`Brand kit missing: ${icnsSrc}`);
    process.exit(1);
  }

  fs.mkdirSync(iconsDir, { recursive: true });
  fs.copyFileSync(icnsSrc, path.join(iconsDir, "icon.icns"));
  console.log(`Copied ${icnsSrc} → icon.icns`);

  let masterSource = fs.existsSync(png1024) ? png1024 : null;
  if (fs.existsSync(zipSrc)) {
    const { masterSource: fromIconset } = applyIconsetFromZip(zipSrc, iconsDir);
    if (fromIconset) masterSource = fromIconset;
  }

  if (!masterSource || !fs.existsSync(masterSource)) {
    console.error(`No 1024 master in brand kit`);
    process.exit(1);
  }

  fs.copyFileSync(masterSource, masterPath);
  console.log(`Master 1024x1024: ${masterSource}`);
  return { brandKitDir, zipSrc: fs.existsSync(zipSrc) ? zipSrc : null };
}

const { brandKit, noPad, positional } = parseArgs();

/** @type {{ brandKitDir: string, zipSrc: string | null } | null} */
let brandKitMeta = null;

if (brandKit) {
  brandKitMeta = copyBrandKitIcons(brandKit);
} else {
  const brandSource = path.resolve(
    positional[0] || (fs.existsSync(brandDefault) ? brandDefault : masterPath)
  );

  if (!noPad) {
    const padScript = path.join(__dirname, "pad-icon-master.mjs");
    const padArgs = [padScript, brandSource, masterPath];
    const pad = spawnSync(process.execPath, padArgs, {
      cwd: root,
      stdio: "inherit",
    });
    if (pad.status !== 0) process.exit(pad.status ?? 1);
  } else {
    const padScript = path.join(__dirname, "pad-icon-master.mjs");
    const pad = spawnSync(process.execPath, [padScript, brandSource, masterPath, "--no-pad"], {
      cwd: root,
      stdio: "inherit",
    });
    if (pad.status !== 0) process.exit(pad.status ?? 1);
  }
}

const input = masterPath;
if (!fs.existsSync(input)) {
  console.error(`Master not found: ${input}`);
  process.exit(1);
}

// Regenerate icon.ico, icon.png, Square*, ios/android from master.
const r = spawnSync(
  "npx",
  ["--yes", "@tauri-apps/cli", "icon", input, "-o", iconsDir],
  { cwd: srcTauri, stdio: "inherit", shell: process.platform === "win32" }
);

if (r.status !== 0) process.exit(r.status ?? 1);

// Brand kit ships authoritative icns + per-size PNGs — restore after tauri icon.
if (brandKitMeta) {
  const icnsSrc = path.join(brandKitMeta.brandKitDir, "1claw.icns");
  fs.copyFileSync(icnsSrc, path.join(iconsDir, "icon.icns"));
  console.log("Restored brand kit icon.icns after tauri icon");
  if (brandKitMeta.zipSrc) {
    applyIconsetFromZip(brandKitMeta.zipSrc, iconsDir);
    console.log("Restored brand kit iconset PNGs after tauri icon");
  }
} else if (process.platform === "darwin") {
  // Tauri CLI may not refresh every size in tauri.conf.json; align 16/256/512 with master.
  for (const s of [16, 256, 512]) {
    spawnSync(
      "sips",
      ["-z", String(s), String(s), input, "--out", path.join(iconsDir, `${s}x${s}.png`)],
      { stdio: "inherit" }
    );
  }
}

console.log("Icon generation complete.");
