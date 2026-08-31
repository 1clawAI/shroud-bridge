mod credentials;
mod llm_proxy;

use std::sync::Mutex;

use serde::Serialize;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WindowEvent};
use tokio::sync::oneshot;

fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn tray_icon_embedded() -> tauri::Result<Image<'static>> {
    Image::from_bytes(include_bytes!("../icons/32x32.png"))
}

struct ProxyStateInner {
    shutdown_tx: Option<oneshot::Sender<()>>,
}

pub struct ProxyState {
    inner: Mutex<ProxyStateInner>,
    /// Last successful proxy base, e.g. `http://127.0.0.1:11434`
    bound_base: Mutex<Option<String>>,
}

impl Default for ProxyState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(ProxyStateInner { shutdown_tx: None }),
            bound_base: Mutex::new(None),
        }
    }
}

impl ProxyState {
    pub fn stop(&self) -> Result<(), String> {
        let mut g = self.inner.lock().map_err(|e| e.to_string())?;
        if let Some(tx) = g.shutdown_tx.take() {
            let _ = tx.send(());
        }
        let mut b = self.bound_base.lock().map_err(|e| e.to_string())?;
        *b = None;
        Ok(())
    }

    fn set_bound_base(&self, base: String) -> Result<(), String> {
        let mut b = self.bound_base.lock().map_err(|e| e.to_string())?;
        *b = Some(base);
        Ok(())
    }

    pub fn get_bound_base(&self) -> Result<Option<String>, String> {
        let b = self.bound_base.lock().map_err(|e| e.to_string())?;
        Ok(b.clone())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyStatusResponse {
    pub running: bool,
    pub base_url: Option<String>,
}

#[tauri::command]
fn credential_save(agent_key: String) -> Result<(), String> {
    credentials::save(&agent_key)
}

#[tauri::command]
fn credential_load() -> Result<Option<String>, String> {
    credentials::load()
}

#[tauri::command]
fn credential_clear() -> Result<(), String> {
    credentials::clear()
}

/// SEC-002: Only allow network calls to known 1Claw hosts (or localhost for dev).
fn validate_url_host(url: &str) -> Result<(), String> {
    const ALLOWED_HOSTS: &[&str] = &[
        "api.1claw.co",
        "shroud.1claw.co",
        // Legacy domain: still answers, so keep accepting it until retired.
        "api.1claw.xyz",
        "shroud.1claw.xyz",
        "localhost",
        "127.0.0.1",
    ];
    let parsed = url::Url::parse(url).map_err(|e| format!("Invalid URL: {e}"))?;
    let host = parsed.host_str().unwrap_or("");
    if !ALLOWED_HOSTS.contains(&host) {
        return Err(format!(
            "Security: URL host '{}' is not in the allowed hosts list. Only api.1claw.co, shroud.1claw.co (and their .xyz predecessors), and localhost are permitted.",
            host
        ));
    }
    Ok(())
}

/// SEC-003: Generate a random bearer token for local proxy auth.
fn generate_local_token() -> String {
    use std::fmt::Write;
    let mut buf = [0u8; 32];
    getrandom::fill(&mut buf).expect("getrandom failed");
    let mut hex = String::with_capacity(64);
    for byte in &buf {
        let _ = write!(hex, "{byte:02x}");
    }
    hex
}

#[tauri::command]
async fn test_agent_exchange(api_url: String, agent_key: String) -> Result<(), String> {
    if agent_key.trim().is_empty() {
        return Err("Agent credentials are required.".into());
    }
    validate_url_host(api_url.trim())?;
    llm_proxy::resolve_shroud_agent_key(api_url.trim(), agent_key.trim()).await?;
    Ok(())
}

#[tauri::command]
fn proxy_status(state: tauri::State<'_, ProxyState>) -> Result<ProxyStatusResponse, String> {
    let base = state.get_bound_base()?;
    Ok(ProxyStatusResponse {
        running: base.is_some(),
        base_url: base,
    })
}

/// Best-effort: open a GUI app by name (macOS `open -a`).
#[tauri::command]
fn open_gui_app(app_name: String) -> Result<(), String> {
    let name = app_name.trim();
    if name.is_empty() {
        return Err("App name is required.".into());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-a", name])
            .spawn()
            .map_err(|e| format!("Could not open {name}: {e}"))?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", name])
            .spawn()
            .map_err(|e| format!("Could not start {name}: {e}"))?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = name;
        Err("Opening apps from the bridge is only wired for macOS and Windows.".into())
    }
}

#[tauri::command]
async fn start_proxy(
    state: tauri::State<'_, ProxyState>,
    agent_key: String,
    port: u32,
    api_url: String,
    shroud_url: String,
) -> Result<String, String> {
    if agent_key.trim().is_empty() {
        return Err("Agent credentials are required.".into());
    }
    validate_url_host(api_url.trim())?;
    validate_url_host(shroud_url.trim())?;

    state.stop()?;

    let resolved =
        llm_proxy::resolve_shroud_agent_key(api_url.trim(), agent_key.trim()).await?;

    let (listener, bound_port, _used_fallback) =
        llm_proxy::try_bind_port(port).await?;

    let client = llm_proxy::build_client()?;
    let local_auth_token = generate_local_token();
    let serve_state = std::sync::Arc::new(llm_proxy::ProxyServeState {
        agent_key: resolved,
        provider_override: None,
        shroud_url: shroud_url.trim().to_string(),
        client,
        local_auth_token: local_auth_token.clone(),
    });

    let (shutdown_tx, shutdown_rx) = oneshot::channel();

    {
        let mut g = state.inner.lock().map_err(|e| e.to_string())?;
        g.shutdown_tx = Some(shutdown_tx);
    }

    let base = format!("http://127.0.0.1:{bound_port}");
    state.set_bound_base(base.clone())?;

    let listener_owned = listener;
    tauri::async_runtime::spawn(async move {
        llm_proxy::run_server(listener_owned, serve_state, shutdown_rx).await;
    });

    // Return base URL + local auth token so the UI can pass it to configured clients
    Ok(format!("{}|{}", base, local_auth_token))
}

#[tauri::command]
async fn stop_proxy(state: tauri::State<'_, ProxyState>) -> Result<(), String> {
    state.stop()
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show_i = MenuItem::with_id(app, "show", "Show Shroud Bridge", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit Shroud Bridge", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show_i, &sep, &quit_i])?;

    let icon = tray_icon_embedded()?;

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("Shroud Bridge — local proxy to 1Claw Shroud")
        .on_menu_event(|app, event| {
            match event.id.as_ref() {
                "show" => show_main_window(app),
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .manage(ProxyState::default());

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {}));
    }

    builder
        .setup(|app| {
            setup_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            start_proxy,
            stop_proxy,
            credential_save,
            credential_load,
            credential_clear,
            test_agent_exchange,
            proxy_status,
            open_gui_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(proxy) = app_handle.try_state::<ProxyState>() {
                    let _ = proxy.stop();
                }
            }
        });
}
