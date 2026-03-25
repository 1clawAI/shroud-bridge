mod llm_proxy;

use std::sync::Mutex;

use tauri::Manager;
use tokio::sync::oneshot;

struct ProxyStateInner {
    /// When dropped after `send(())`, the Axum server shuts down.
    shutdown_tx: Option<oneshot::Sender<()>>,
}

pub struct ProxyState {
    inner: Mutex<ProxyStateInner>,
}

impl Default for ProxyState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(ProxyStateInner {
                shutdown_tx: None,
            }),
        }
    }
}

impl ProxyState {
    pub fn stop(&self) -> Result<(), String> {
        let mut g = self.inner.lock().map_err(|e| e.to_string())?;
        if let Some(tx) = g.shutdown_tx.take() {
            let _ = tx.send(());
        }
        Ok(())
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

    state.stop()?;

    let resolved =
        llm_proxy::resolve_shroud_agent_key(api_url.trim(), agent_key.trim()).await?;

    let (listener, bound_port, _used_fallback) =
        llm_proxy::try_bind_port(port).await?;

    let client = llm_proxy::build_client()?;
    let serve_state = std::sync::Arc::new(llm_proxy::ProxyServeState {
        agent_key: resolved,
        provider_override: None,
        shroud_url: shroud_url.trim().to_string(),
        client,
    });

    let (shutdown_tx, shutdown_rx) = oneshot::channel();

    {
        let mut g = state.inner.lock().map_err(|e| e.to_string())?;
        g.shutdown_tx = Some(shutdown_tx);
    }

    let listener_owned = listener;
    tauri::async_runtime::spawn(async move {
        llm_proxy::run_server(listener_owned, serve_state, shutdown_rx).await;
    });

    Ok(format!("http://127.0.0.1:{bound_port}"))
}

#[tauri::command]
async fn stop_proxy(state: tauri::State<'_, ProxyState>) -> Result<(), String> {
    state.stop()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ProxyState::default())
        .invoke_handler(tauri::generate_handler![start_proxy, stop_proxy])
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
