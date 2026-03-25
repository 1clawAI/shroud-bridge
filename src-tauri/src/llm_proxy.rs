//! In-process port of `packages/cli/src/commands/proxy.ts` — local OpenAI-shaped HTTP → Shroud HTTPS.
//! Keep behavior aligned with the CLI when changing either side.

use std::io;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderName, HeaderValue, Method, Request, Response, StatusCode, Uri};
use axum::routing::any;
use axum::Router;
use bytes::Bytes;
use futures_util::StreamExt;
use http_body_util::BodyExt;
use serde::Deserialize;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

const MAX_PORT_TRIES: u32 = 32;

#[derive(Clone)]
pub struct ProxyServeState {
    pub agent_key: String,
    pub provider_override: Option<String>,
    pub shroud_url: String,
    pub client: reqwest::Client,
}

#[derive(Deserialize)]
struct AgentTokenBody {
    agent_id: Option<String>,
}

/// `uuid:ocv_...` passthrough, or key-only `ocv_...` via Vault token exchange.
pub async fn resolve_shroud_agent_key(api_url: &str, input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.contains(':') {
        return Ok(trimmed.to_string());
    }
    if !trimmed.starts_with("ocv_") {
        return Err(
            "Credentials must be agent_id:ocv_... or a standalone agent API key (ocv_...)."
                .into(),
        );
    }

    let base = api_url.trim_end_matches('/');
    let url = format!("{base}/v1/auth/agent-token");
    let client = reqwest::Client::builder()
        .use_rustls_tls()
        .user_agent("Shroud-Bridge/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "api_key": trimmed }))
        .send()
        .await
        .map_err(|e| format!("agent-token request failed: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("agent-token failed ({status}): {text}"));
    }

    let body: AgentTokenBody = res.json().await.map_err(|e| e.to_string())?;
    let agent_id = body
        .agent_id
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Token exchange succeeded but response had no agent_id.".to_string())?;

    Ok(format!("{agent_id}:{trimmed}"))
}

fn detect_provider(model: &str) -> &'static str {
    let lower = model.to_lowercase();
    let pairs: &[(&str, &str)] = &[
        ("gpt-", "openai"),
        ("o1", "openai"),
        ("o3", "openai"),
        ("o4", "openai"),
        ("chatgpt-", "openai"),
        ("claude-", "anthropic"),
        ("gemini-", "google"),
        ("mistral-", "mistral"),
        ("command-", "cohere"),
        ("openrouter/", "openrouter"),
    ];
    for (prefix, provider) in pairs {
        if lower.starts_with(prefix) {
            return provider;
        }
    }
    "openai"
}

fn skip_response_header(name: &HeaderName) -> bool {
    matches!(
        name.as_str(),
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailers"
            | "transfer-encoding"
            | "upgrade"
    )
}

pub async fn try_bind_port(preferred: u32) -> Result<(TcpListener, u16, bool), String> {
    if preferred == 0 {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| e.to_string())?;
        let port = listener
            .local_addr()
            .map_err(|e| e.to_string())?
            .port();
        return Ok((listener, port, false));
    }
    if preferred > 65535 {
        return Err("Invalid port (use 0–65535).".into());
    }
    let preferred = preferred as u16;
    for offset in 0..MAX_PORT_TRIES {
        let p = preferred as u32 + offset;
        if p > 65535 {
            break;
        }
        let port = p as u16;
        match TcpListener::bind(("127.0.0.1", port)).await {
            Ok(listener) => return Ok((listener, port, offset != 0)),
            Err(e) if e.kind() == io::ErrorKind::AddrInUse && offset + 1 < MAX_PORT_TRIES => {
                continue;
            }
            Err(e) if e.kind() == io::ErrorKind::AddrInUse => {
                return Err(format!(
                    "Ports {}–{} are all in use. Stop the other process or pick another port.",
                    preferred,
                    preferred as u32 + MAX_PORT_TRIES - 1
                ));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("Could not bind to a local port.".into())
}

fn cors_preflight() -> Response<Body> {
    Response::builder()
        .status(StatusCode::NO_CONTENT)
        .header("Access-Control-Allow-Origin", "*")
        .header(
            "Access-Control-Allow-Methods",
            "GET, POST, OPTIONS",
        )
        .header(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization",
        )
        .body(Body::empty())
        .unwrap()
}

fn health() -> Response<Body> {
    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "application/json")
        .body(Body::from(r#"{"status":"ok","proxy":"1claw"}"#))
        .unwrap()
}

fn models() -> Response<Body> {
    const JSON: &str = r#"{"object":"list","data":[
{"id":"gpt-4o","object":"model","owned_by":"openai"},
{"id":"gpt-4o-mini","object":"model","owned_by":"openai"},
{"id":"gpt-4.1","object":"model","owned_by":"openai"},
{"id":"gpt-4.1-mini","object":"model","owned_by":"openai"},
{"id":"o3-mini","object":"model","owned_by":"openai"},
{"id":"claude-sonnet-4-20250514","object":"model","owned_by":"anthropic"},
{"id":"claude-3.5-sonnet-20241022","object":"model","owned_by":"anthropic"},
{"id":"gemini-2.5-flash","object":"model","owned_by":"google"},
{"id":"gemini-2.5-pro","object":"model","owned_by":"google"}
]}"#;
    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "application/json")
        .body(Body::from(JSON))
        .unwrap()
}

async fn forward_upstream(
    state: &ProxyServeState,
    method: Method,
    uri: Uri,
    body: Bytes,
) -> Result<Response<Body>, String> {
    let path = uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("/");
    let base = state.shroud_url.trim_end_matches('/');
    let url = format!("{base}{path}");

    let mut provider = state
        .provider_override
        .clone()
        .unwrap_or_default();
    let mut model = String::new();

    if !body.is_empty() {
        if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&body) {
            if let Some(m) = v.get("model").and_then(|x| x.as_str()) {
                model = m.to_string();
                if provider.is_empty() {
                    provider = detect_provider(m).to_string();
                }
            }
        }
    }

    if provider.is_empty()
        && (path.contains("/v1/messages") || path.ends_with("/messages"))
    {
        provider = "anthropic".to_string();
    }
    if provider.is_empty() {
        provider = "openai".to_string();
    }

    let mut req = state
        .client
        .request(method, url)
        .header("X-Shroud-Agent-Key", &state.agent_key)
        .header("X-Shroud-Provider", &provider)
        .header("Content-Type", "application/json");

    if !model.is_empty() {
        req = req.header("X-Shroud-Model", &model);
    }

    let upstream = if body.is_empty() {
        req.send()
    } else {
        req.body(body).send()
    }
    .await
    .map_err(|e| format!("Shroud unreachable: {e}"))?;

    let status = upstream.status();
    let headers = upstream.headers().clone();
    let stream = upstream
        .bytes_stream()
        .map(|r| r.map_err(|e| io::Error::other(e.to_string())));
    let body = Body::from_stream(stream);

    let mut builder = Response::builder().status(
        StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
    );
    for (k, v) in headers.iter() {
        if skip_response_header(k) {
            continue;
        }
        if let Ok(name) = HeaderName::from_bytes(k.as_str().as_bytes()) {
            if let Ok(val) = HeaderValue::from_bytes(v.as_bytes()) {
                builder = builder.header(name, val);
            }
        }
    }
    builder
        .body(body)
        .map_err(|e| e.to_string())
}

async fn dispatch(
    State(state): State<Arc<ProxyServeState>>,
    req: Request<Body>,
) -> Response<Body> {
    let (parts, body) = req.into_parts();
    let method = parts.method;
    let uri = parts.uri;

    if method == Method::OPTIONS {
        return cors_preflight();
    }

    let path = uri.path();
    if path == "/health" || path == "/v1/health" {
        return health();
    }
    if path == "/v1/models" || path == "/models" {
        return models();
    }

    let body_bytes = match body.collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(e) => {
            return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header("Content-Type", "application/json")
                .body(Body::from(format!(
                    r#"{{"error":{{"message":"proxy read error: {e}","type":"proxy_error"}}}}"#
                )))
                .unwrap();
        }
    };

    match forward_upstream(&state, method, uri, body_bytes).await {
        Ok(r) => r,
        Err(msg) => Response::builder()
            .status(StatusCode::BAD_GATEWAY)
            .header("Content-Type", "application/json")
            .body(Body::from(
                serde_json::json!({ "error": { "message": msg, "type": "proxy_error" } })
                    .to_string(),
            ))
            .unwrap(),
    }
}

pub async fn run_server(
    listener: TcpListener,
    state: Arc<ProxyServeState>,
    shutdown: oneshot::Receiver<()>,
) {
    let app = Router::new()
        .fallback(any(dispatch))
        .with_state(state);

    let _ = axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = shutdown.await;
        })
        .await;
}

pub fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .use_rustls_tls()
        .user_agent("Shroud-Bridge/0.1")
        .build()
        .map_err(|e| e.to_string())
}
