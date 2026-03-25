import { invoke } from "@tauri-apps/api/core";
import "./style.css";
import { parseShroudBridgeImport } from "./import";

const DEFAULT_API = "https://api.1claw.xyz";
const DEFAULT_SHROUD = "https://shroud.1claw.xyz";
const DEFAULT_PORT = "11434";
const STORAGE_KEY = "shroud-bridge.v1";

interface Saved {
    port?: string;
    apiUrl?: string;
    shroudUrl?: string;
}

function loadSaved(): Saved {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        return JSON.parse(raw) as Saved;
    } catch {
        return {};
    }
}

function saveUrls(s: Saved) {
    const prev = loadSaved();
    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
            ...prev,
            port: s.port ?? prev.port,
            apiUrl: s.apiUrl ?? prev.apiUrl,
            shroudUrl: s.shroudUrl ?? prev.shroudUrl,
        }),
    );
}

const saved = loadSaved();

document.querySelector("#app")!.innerHTML = `
  <h1><span class="accent">Shroud</span> Bridge</h1>
  <p class="sub">Experimental — local OpenAI-compatible proxy to 1Claw Shroud (in-process, no Node.js).</p>

  <div class="panel">
    <h2 class="panel-title">Credentials</h2>
    <p class="panel-desc">Agent API key (<code>uuid:ocv_…</code> or key-only <code>ocv_…</code>). Stored in the OS keychain when you save — not in this form file.</p>
    <label for="agent-key">Agent credentials</label>
    <input id="agent-key" type="password" autocomplete="off" placeholder="uuid:ocv_… or ocv_…" />
    <div class="row-actions">
      <button class="secondary sm" id="btn-save-key" type="button">Save to keychain</button>
      <button class="secondary sm" id="btn-clear-key" type="button">Clear keychain</button>
    </div>
  </div>

  <div class="panel">
    <h2 class="panel-title">Connection</h2>
    <div class="row">
      <div>
        <label for="port">Local port</label>
        <input id="port" type="text" inputmode="numeric" />
      </div>
      <div>
        <label for="api-url">Vault API URL</label>
        <input id="api-url" type="url" />
      </div>
    </div>
    <label for="shroud-url">Shroud URL</label>
    <input id="shroud-url" type="url" />
    <div class="row-actions">
      <button class="secondary" id="btn-test" type="button">Test Vault exchange</button>
    </div>
  </div>

  <div class="panel">
    <h2 class="panel-title">Proxy</h2>
    <div class="actions">
      <button class="primary" id="btn-start" type="button">Start proxy</button>
      <button class="secondary" id="btn-stop" type="button">Stop</button>
    </div>
    <div id="status" class="status" hidden></div>
    <p class="hint">
      Editor <strong>Base URL</strong>: <code id="hint-url">http://127.0.0.1:${DEFAULT_PORT}/v1</code>
      — use any placeholder API key in the IDE. <a href="https://docs.1claw.xyz/docs/guides/ide-shroud-setup" target="_blank" rel="noopener">Docs</a>
    </p>
    <p class="hint tray-hint">
      Closing the window keeps the proxy running. Use the tray menu → <strong>Show Shroud Bridge</strong> or <strong>Quit Shroud Bridge</strong>.
    </p>
  </div>

  <div class="panel">
    <h2 class="panel-title">IDE helpers</h2>
    <p class="panel-desc">Env vars for Cursor, VS Code, Continue, Cline, etc. (OpenAI-compatible client)</p>
    <pre class="code-block" id="env-block"></pre>
    <div class="row-actions wrap">
      <button class="secondary sm" id="btn-copy-env" type="button">Copy env block</button>
      <button class="secondary sm" id="btn-open-cursor" type="button">Open Cursor (macOS/Win)</button>
      <button class="secondary sm" id="btn-open-vscode" type="button">Open VS Code (macOS/Win)</button>
    </div>
  </div>

  <details class="advanced">
    <summary>Advanced</summary>
    <p class="panel-desc">Deep link: complete setup in the browser, then use <strong>Open in Shroud Bridge</strong> on the 1Claw dashboard (<code>shroudbridge://import#…</code>).</p>
    <p class="panel-desc">If the keychain is unavailable (some Linux setups), credentials stay only in the field until you close the app.</p>
  </details>
`;

const el = {
    agentKey: document.getElementById("agent-key") as HTMLInputElement,
    port: document.getElementById("port") as HTMLInputElement,
    apiUrl: document.getElementById("api-url") as HTMLInputElement,
    shroudUrl: document.getElementById("shroud-url") as HTMLInputElement,
    btnStart: document.getElementById("btn-start") as HTMLButtonElement,
    btnStop: document.getElementById("btn-stop") as HTMLButtonElement,
    btnTest: document.getElementById("btn-test") as HTMLButtonElement,
    btnSaveKey: document.getElementById("btn-save-key") as HTMLButtonElement,
    btnClearKey: document.getElementById("btn-clear-key") as HTMLButtonElement,
    btnCopyEnv: document.getElementById("btn-copy-env") as HTMLButtonElement,
    btnOpenCursor: document.getElementById("btn-open-cursor") as HTMLButtonElement,
    btnOpenVscode: document.getElementById("btn-open-vscode") as HTMLButtonElement,
    status: document.getElementById("status") as HTMLDivElement,
    hintUrl: document.getElementById("hint-url") as HTMLElement,
    envBlock: document.getElementById("env-block") as HTMLPreElement,
};

el.port.value = saved.port ?? DEFAULT_PORT;
el.apiUrl.value = saved.apiUrl ?? DEFAULT_API;
el.shroudUrl.value = saved.shroudUrl ?? DEFAULT_SHROUD;

function envSnippet(base: string): string {
    return `# Shroud Bridge — OpenAI-compatible endpoint
OPENAI_API_BASE=${base}/v1
OPENAI_BASE_URL=${base}/v1
# Many clients accept either variable; use a non-empty dummy key if the UI requires one:
OPENAI_API_KEY=shroud-bridge-local`;
}

function updateEnvBlock() {
    const port = parseInt(el.port.value.trim(), 10);
    const base =
        Number.isFinite(port) && port > 0
            ? `http://127.0.0.1:${port}`
            : `http://127.0.0.1:${DEFAULT_PORT}`;
    el.envBlock.textContent = envSnippet(base);
}

el.port.addEventListener("input", updateEnvBlock);
updateEnvBlock();

function showStatus(text: string, kind: "running" | "error" | "neutral") {
    el.status.hidden = false;
    el.status.textContent = text;
    el.status.className = "status" + (kind === "neutral" ? "" : ` ${kind}`);
}

async function refreshProxyStatus() {
    try {
        const s = await invoke<{ running: boolean; baseUrl: string | null }>("proxy_status");
        if (s.running && s.baseUrl) {
            el.hintUrl.textContent = `${s.baseUrl}/v1`;
            showStatus(`Proxy running — Base URL: ${s.baseUrl}/v1`, "running");
            updateEnvBlock();
        }
    } catch {
        /* ignore */
    }
}

void (async () => {
    try {
        const fromKeychain = await invoke<string | null>("credential_load");
        if (fromKeychain) el.agentKey.value = fromKeychain;
    } catch {
        /* keychain unavailable */
    }
    await refreshProxyStatus();
})();

function persistUrls() {
    saveUrls({
        port: el.port.value.trim(),
        apiUrl: el.apiUrl.value.trim(),
        shroudUrl: el.shroudUrl.value.trim(),
    });
    updateEnvBlock();
}

el.apiUrl.addEventListener("change", persistUrls);
el.shroudUrl.addEventListener("change", persistUrls);
el.port.addEventListener("change", persistUrls);

function applyImportUrl(url: string) {
    const p = parseShroudBridgeImport(url);
    if (!p) {
        showStatus("Could not read Shroud Bridge link (invalid payload).", "error");
        return;
    }
    el.agentKey.value = p.agentKey;
    if (p.apiUrl) el.apiUrl.value = p.apiUrl;
    if (p.shroudUrl) el.shroudUrl.value = p.shroudUrl;
    if (p.port != null && p.port > 0) el.port.value = String(p.port);
    persistUrls();
    showStatus("Imported settings from browser — review and Start proxy, or Save to keychain.", "neutral");
}

void (async () => {
    try {
        const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
        const initial = await getCurrent();
        if (initial?.length) applyImportUrl(initial[0]);
        await onOpenUrl((urls) => {
            for (const u of urls) applyImportUrl(u);
        });
    } catch {
        /* dev server / web */
    }
})();

el.btnSaveKey.addEventListener("click", async () => {
    const agentKey = el.agentKey.value.trim();
    if (!agentKey) {
        showStatus("Enter agent credentials before saving to keychain.", "error");
        return;
    }
    try {
        await invoke("credential_save", { agentKey });
        showStatus("Saved credentials to OS keychain.", "running");
    } catch (e) {
        showStatus(String(e), "error");
    }
});

el.btnClearKey.addEventListener("click", async () => {
    try {
        await invoke("credential_clear");
        el.agentKey.value = "";
        showStatus("Keychain entry cleared.", "neutral");
    } catch (e) {
        showStatus(String(e), "error");
    }
});

el.btnTest.addEventListener("click", async () => {
    const agentKey = el.agentKey.value.trim();
    if (!agentKey) {
        showStatus("Enter agent credentials first.", "error");
        return;
    }
    el.btnTest.disabled = true;
    try {
        await invoke("test_agent_exchange", {
            apiUrl: el.apiUrl.value.trim() || DEFAULT_API,
            agentKey,
        });
        showStatus("Vault accepted credentials (agent token exchange OK).", "running");
    } catch (e) {
        showStatus(String(e), "error");
    } finally {
        el.btnTest.disabled = false;
    }
});

el.btnStart.addEventListener("click", async () => {
    persistUrls();
    const agentKey = el.agentKey.value.trim();
    if (!agentKey) {
        showStatus("Enter agent credentials (uuid:ocv_… or ocv_…).", "error");
        return;
    }
    const port = parseInt(el.port.value.trim(), 10);
    if (Number.isNaN(port) || port < 0 || port > 65535) {
        showStatus("Invalid port (0–65535).", "error");
        return;
    }
    el.btnStart.disabled = true;
    try {
        const base = await invoke<string>("start_proxy", {
            agentKey,
            port,
            apiUrl: el.apiUrl.value.trim() || DEFAULT_API,
            shroudUrl: el.shroudUrl.value.trim() || DEFAULT_SHROUD,
        });
        const m = base.match(/:(\d+)$/);
        if (m) {
            el.port.value = m[1];
            persistUrls();
        }
        el.hintUrl.textContent = `${base}/v1`;
        showStatus(`Proxy running — Base URL: ${base}/v1`, "running");
        updateEnvBlock();
    } catch (e) {
        showStatus(String(e), "error");
    } finally {
        el.btnStart.disabled = false;
    }
});

el.btnStop.addEventListener("click", async () => {
    try {
        await invoke("stop_proxy");
        el.hintUrl.textContent = `http://127.0.0.1:${el.port.value.trim() || DEFAULT_PORT}/v1`;
        showStatus("Proxy stopped.", "neutral");
        updateEnvBlock();
    } catch (e) {
        showStatus(String(e), "error");
    }
});

el.btnCopyEnv.addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(el.envBlock.textContent || "");
        showStatus("Env block copied to clipboard.", "running");
    } catch {
        showStatus("Clipboard unavailable.", "error");
    }
});

el.btnOpenCursor.addEventListener("click", async () => {
    try {
        await invoke("open_gui_app", { appName: "Cursor" });
    } catch (e) {
        showStatus(String(e), "error");
    }
});

el.btnOpenVscode.addEventListener("click", async () => {
    try {
        await invoke("open_gui_app", { appName: "Visual Studio Code" });
    } catch (e) {
        showStatus(String(e), "error");
    }
});
