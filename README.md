# Shroud Bridge

Desktop app (Tauri) that runs a local OpenAI-compatible proxy to [Shroud](https://shroud.1claw.xyz). Point Cursor, Continue, or any client that speaks the OpenAI API at `http://127.0.0.1:...` and your LLM requests go through Shroud's inspection pipeline before they hit the upstream provider.

No Node.js required on the user's machine. The proxy runs in Rust inside the Tauri shell (`src-tauri/src/llm_proxy.rs`). The [`1claw proxy`](https://docs.1claw.xyz) CLI command does the same thing if you prefer terminal-only setup.

You need a 1Claw agent with Shroud enabled and `ocv_` credentials (or `uuid:ocv_...`). Network access to your Vault API and Shroud URLs.

- **License:** MIT (see `LICENSE`)

## Public repository

Source of truth: **[github.com/1clawAI/shroud-bridge](https://github.com/1clawAI/shroud-bridge)**.

### Clone standalone

```bash
git clone https://github.com/1clawAI/shroud-bridge.git
cd shroud-bridge
npm install
npm run dev
```

Production bundle:

```bash
npm run build
```

Installers appear under `src-tauri/target/release/bundle/` (`.app` / `.dmg` on macOS, `.msi` / `.exe` on Windows, `.deb` / `.AppImage` on Linux depending on Tauri defaults).

## 1claw monorepo (submodule)

The main repo vendors this package at `packages/shroud-bridge`:

```bash
git clone --recurse-submodules https://github.com/1clawAI/1claw.git
cd 1claw/packages/shroud-bridge
npm install
npm run dev
```

## CI

The monorepo runs [`.github/workflows/shroud-bridge.yml`](https://github.com/1clawAI/1claw/blob/main/.github/workflows/shroud-bridge.yml) on **Ubuntu**, **Windows**, and **macOS** when `packages/shroud-bridge/` changes.

## Security notes

- Agent credentials are stored in **browser localStorage** inside the webview (optional persistence). Treat the machine as trusted.
- For production hardening, prefer OS keychain integration and/or short-lived tokens in a future version.

## Limitations (v0.1)

- **Parity:** When changing proxy behavior, update **`src-tauri/src/llm_proxy.rs`** and the CLI **`proxy`** command together (or add shared contract tests).

## Platform v0.56+ (guardrail governance)

Shroud adds shadow/enforce execution guardrails, address screening, and tx escalation to HITL in **v0.56**. This desktop proxy forwards to Shroud unchanged — configure per-agent policies in the 1Claw dashboard.

## Docs

- [IDE & Shroud setup](https://docs.1claw.xyz/docs/guides/ide-shroud-setup)
- [Shroud guide](https://docs.1claw.xyz/docs/guides/shroud)
