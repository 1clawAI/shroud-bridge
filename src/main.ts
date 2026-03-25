import { invoke } from "@tauri-apps/api/core";
import "./style.css";

const DEFAULT_API = "https://api.1claw.xyz";
const DEFAULT_SHROUD = "https://shroud.1claw.xyz";
const DEFAULT_PORT = "11434";

const STORAGE_KEY = "shroud-bridge.v1";

interface Saved {
    agentKey?: string;
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

function saveForm(s: Saved) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

const saved = loadSaved();

document.querySelector("#app")!.innerHTML = `
  <h1><span class="accent">Shroud</span> Bridge</h1>
  <p class="sub">Experimental — runs the Shroud LLM proxy in-process (no Node.js required).</p>

  <label for="agent-key">Agent credentials</label>
  <input id="agent-key" type="password" autocomplete="off" placeholder="uuid:ocv_… or key-only ocv_…" />

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

  <div class="actions">
    <button class="primary" id="btn-start" type="button">Start proxy</button>
    <button class="secondary" id="btn-stop" type="button">Stop</button>
  </div>

  <div id="status" class="status" hidden></div>

  <p class="hint">
    Point your editor’s OpenAI-compatible <strong>Base URL</strong> at <code id="hint-url">http://127.0.0.1:${DEFAULT_PORT}/v1</code>
    (use any placeholder API key in the UI). Enable Shroud on the agent in the 1Claw dashboard.
    <a href="https://docs.1claw.xyz/docs/guides/ide-shroud-setup" target="_blank" rel="noopener">Docs</a>
  </p>
`;

const el = {
    agentKey: document.getElementById("agent-key") as HTMLInputElement,
    port: document.getElementById("port") as HTMLInputElement,
    apiUrl: document.getElementById("api-url") as HTMLInputElement,
    shroudUrl: document.getElementById("shroud-url") as HTMLInputElement,
    btnStart: document.getElementById("btn-start") as HTMLButtonElement,
    btnStop: document.getElementById("btn-stop") as HTMLButtonElement,
    status: document.getElementById("status") as HTMLDivElement,
    hintUrl: document.getElementById("hint-url") as HTMLSpanElement,
};

el.agentKey.value = saved.agentKey ?? "";
el.port.value = saved.port ?? DEFAULT_PORT;
el.apiUrl.value = saved.apiUrl ?? DEFAULT_API;
el.shroudUrl.value = saved.shroudUrl ?? DEFAULT_SHROUD;

function persist() {
    saveForm({
        agentKey: el.agentKey.value.trim(),
        port: el.port.value.trim(),
        apiUrl: el.apiUrl.value.trim(),
        shroudUrl: el.shroudUrl.value.trim(),
    });
}

function showStatus(text: string, kind: "running" | "error" | "neutral") {
    el.status.hidden = false;
    el.status.textContent = text;
    el.status.className = "status" + (kind === "neutral" ? "" : ` ${kind}`);
}

el.btnStart.addEventListener("click", async () => {
    persist();
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
        el.hintUrl.textContent = `${base}/v1`;
        showStatus(`Proxy running — Base URL: ${base}/v1`, "running");
    } catch (e) {
        showStatus(String(e), "error");
    } finally {
        el.btnStart.disabled = false;
    }
});

el.btnStop.addEventListener("click", async () => {
    try {
        await invoke("stop_proxy");
        showStatus("Proxy stopped.", "neutral");
    } catch (e) {
        showStatus(String(e), "error");
    }
});
