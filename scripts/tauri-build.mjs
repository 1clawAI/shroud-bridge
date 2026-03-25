#!/usr/bin/env node
/**
 * Tauri CLI treats CI=1 as enabling --ci, which breaks when CI is the string "1".
 * Clear CI so local and hosted builds behave the same.
 */
import { spawnSync } from "node:child_process";

const env = { ...process.env };
delete env.CI;

const r = spawnSync("npx", ["tauri", "build"], {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
});

process.exit(r.status ?? 1);
