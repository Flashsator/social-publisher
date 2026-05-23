use crate::error::{AppError, AppResult};
use base64::{engine::general_purpose, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tiny_http::{Header, Response, Server};
use url::Url;

static OAUTH_CANCEL: AtomicBool = AtomicBool::new(false);

// Meta Threads OAuth rejects http://127.0.0.1 redirect URIs at runtime even
// when accepted in dashboard config. Threads is routed through an in-app
// WebView that intercepts navigation to this HTTPS placeholder URL — the page
// never actually loads, the code is extracted from the URL before navigation.
// Users must register this exact URL in Meta App Dashboard → Threads → Valid
// OAuth Redirect URIs.
pub const THREADS_WEBVIEW_REDIRECT_URI: &str =
    "https://example.com/social-publisher-threads-oauth/";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Platform {
    Facebook,
    Instagram,
    Threads,
    Youtube,
    Tiktok,
}

impl Platform {
    fn auth_url(&self) -> &'static str {
        match self {
            Platform::Facebook => "https://www.facebook.com/v21.0/dialog/oauth",
            Platform::Instagram => "https://www.instagram.com/oauth/authorize",
            Platform::Threads => "https://www.threads.com/oauth/authorize",
            Platform::Youtube => "https://accounts.google.com/o/oauth2/v2/auth",
            Platform::Tiktok => "https://www.tiktok.com/v2/auth/authorize/",
        }
    }

    fn scopes(&self) -> &'static str {
        match self {
            Platform::Facebook => {
                "pages_show_list,pages_manage_posts,pages_read_engagement,pages_manage_metadata"
            }
            Platform::Instagram => {
                "instagram_business_basic,instagram_business_content_publish"
            }
            Platform::Threads => "threads_basic,threads_content_publish",
            Platform::Youtube => "https://www.googleapis.com/auth/youtube.upload",
            // TikTok requires comma-separated scopes; both modes are requested up-front so the
            // user can switch between INBOX and DIRECT_POST without re-authorizing.
            Platform::Tiktok => "user.info.basic,video.upload,video.publish",
        }
    }
}

// Meta-specific URL helpers (kept private to the meta_oauth_flow path).
mod meta_endpoints {
    use super::Platform;

    pub fn short_token_url(p: Platform) -> &'static str {
        match p {
            Platform::Facebook => "https://graph.facebook.com/v21.0/oauth/access_token",
            Platform::Instagram => "https://api.instagram.com/oauth/access_token",
            Platform::Threads => "https://graph.threads.net/oauth/access_token",
            _ => unreachable!("not a meta platform"),
        }
    }

    pub fn long_lived_url(p: Platform) -> &'static str {
        match p {
            Platform::Facebook => "https://graph.facebook.com/v21.0/oauth/access_token",
            Platform::Instagram => "https://graph.instagram.com/access_token",
            Platform::Threads => "https://graph.threads.net/access_token",
            _ => unreachable!("not a meta platform"),
        }
    }

    pub fn long_lived_grant(p: Platform) -> &'static str {
        match p {
            Platform::Facebook => "fb_exchange_token",
            Platform::Instagram => "ig_exchange_token",
            Platform::Threads => "th_exchange_token",
            _ => unreachable!("not a meta platform"),
        }
    }
}

#[derive(Serialize)]
pub struct OAuthResult {
    pub access_token: String,
    pub expires_in: Option<i64>,
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_id: Option<String>,
}

#[derive(Deserialize)]
struct ShortTokenResponse {
    access_token: String,
    #[serde(default)]
    #[allow(dead_code)]
    expires_in: Option<i64>,
    #[serde(default)]
    user_id: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct LongLivedResponse {
    access_token: String,
    #[serde(default)]
    expires_in: Option<i64>,
}

#[derive(Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
    #[serde(default)]
    expires_in: Option<i64>,
    #[serde(default)]
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct TikTokTokenResponse {
    access_token: String,
    #[serde(default)]
    expires_in: Option<i64>,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    open_id: Option<String>,
}

fn random_state() -> String {
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn wait_for_callback(
    server: Server,
    expected_state: String,
    timeout: Duration,
) -> AppResult<String> {
    let deadline = Instant::now() + timeout;
    let poll = Duration::from_millis(500);
    loop {
        if OAUTH_CANCEL.load(Ordering::SeqCst) {
            return Err(AppError::OAuth("Cancelled by user".into()));
        }

        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(AppError::OAuth("Timed out waiting for callback".into()));
        }

        let wait = remaining.min(poll);
        let req = match server.recv_timeout(wait) {
            Ok(Some(r)) => r,
            Ok(None) => continue,
            Err(e) => return Err(AppError::OAuth(format!("recv: {}", e))),
        };

        let url_str = format!("http://127.0.0.1{}", req.url());
        let parsed = match Url::parse(&url_str) {
            Ok(u) => u,
            Err(_) => {
                let _ = req.respond(Response::from_string("bad url").with_status_code(400));
                continue;
            }
        };

        if parsed.path() != "/callback" {
            let _ = req.respond(Response::from_string("Not found").with_status_code(404));
            continue;
        }

        let mut code_val: Option<String> = None;
        let mut state_val: Option<String> = None;
        let mut error_val: Option<String> = None;
        for (k, v) in parsed.query_pairs() {
            match k.as_ref() {
                "code" => code_val = Some(v.into_owned()),
                "state" => state_val = Some(v.into_owned()),
                "error" | "error_description" => {
                    error_val = Some(v.into_owned());
                }
                _ => {}
            }
        }

        let body = if let Some(ref err) = error_val {
            format!(
                "<html><body style='font-family:system-ui;padding:2rem'><h2>Authorization failed</h2><p>{}</p><p>You can close this window.</p></body></html>",
                err
            )
        } else if code_val.is_some() {
            "<html><body style='font-family:system-ui;padding:2rem'><h2>Authorized ✓</h2><p>You can close this window and return to the app.</p></body></html>".to_string()
        } else {
            "<html><body>Missing authorization code</body></html>".to_string()
        };

        let html_header: Header = "Content-Type: text/html; charset=utf-8".parse().unwrap();
        let resp = Response::from_string(body).with_header(html_header);
        let _ = req.respond(resp);

        if state_val.as_deref() != Some(&expected_state) {
            return Err(AppError::OAuth("State mismatch (CSRF guard)".into()));
        }

        if let Some(code) = code_val {
            return Ok(code);
        }
        if let Some(err) = error_val {
            return Err(AppError::OAuth(err));
        }
    }
}

fn build_auth_url(platform: Platform, client_id: &str, redirect_uri: &str, state: &str) -> String {
    let scopes = platform.scopes();
    match platform {
        Platform::Youtube => format!(
            "{}?client_id={}&redirect_uri={}&scope={}&response_type=code&access_type=offline&prompt=consent&state={}",
            platform.auth_url(),
            urlencoding::encode(client_id),
            urlencoding::encode(redirect_uri),
            urlencoding::encode(scopes),
            urlencoding::encode(state),
        ),
        Platform::Tiktok => format!(
            "{}?client_key={}&redirect_uri={}&scope={}&response_type=code&state={}",
            platform.auth_url(),
            urlencoding::encode(client_id),
            urlencoding::encode(redirect_uri),
            urlencoding::encode(scopes),
            urlencoding::encode(state),
        ),
        _ => format!(
            "{}?client_id={}&redirect_uri={}&scope={}&response_type=code&state={}",
            platform.auth_url(),
            urlencoding::encode(client_id),
            urlencoding::encode(redirect_uri),
            urlencoding::encode(scopes),
            urlencoding::encode(state),
        ),
    }
}

// Fixed port so the redirect URI is stable across launches. Developers must
// whitelist `http://127.0.0.1:53682/callback` exactly once per platform app.
const OAUTH_CALLBACK_PORT: u16 = 53682;

#[tauri::command]
pub fn oauth_cancel() {
    OAUTH_CANCEL.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn oauth_flow(
    app: tauri::AppHandle,
    platform: Platform,
    client_id: String,
    client_secret: String,
) -> AppResult<OAuthResult> {
    OAUTH_CANCEL.store(false, Ordering::SeqCst);

    let entry_log = format!(
        "[oauth-entry] platform={:?} client_id_len={} client_secret_len={} client_id_first10={:?}\n",
        platform,
        client_id.len(),
        client_secret.len(),
        client_id.chars().take(10).collect::<String>()
    );
    eprintln!("{}", entry_log);
    let log_path = std::env::temp_dir().join("social-publisher-oauth.log");
    let _ = std::fs::write(&log_path, &entry_log);

    if client_id.trim().is_empty() {
        return Err(AppError::OAuth("Client ID is empty".into()));
    }
    if client_secret.trim().is_empty() {
        return Err(AppError::OAuth("Client Secret is empty".into()));
    }

    if matches!(platform, Platform::Threads) {
        return oauth_flow_threads_webview(&app, client_id, client_secret).await;
    }

    let state = random_state();

    let bind = format!("127.0.0.1:{}", OAUTH_CALLBACK_PORT);
    let server = Server::http(&bind).map_err(|e| {
        AppError::OAuth(format!(
            "Cannot bind port {} — another instance or app is using it. Close it and retry. ({})",
            OAUTH_CALLBACK_PORT, e
        ))
    })?;
    let redirect_uri = format!("http://127.0.0.1:{}/callback", OAUTH_CALLBACK_PORT);

    let auth_url = build_auth_url(platform, &client_id, &redirect_uri, &state);
    let debug_line = format!(
        "{}[oauth-url] url={}\n",
        entry_log, auth_url
    );
    eprintln!("[oauth-url] {}", auth_url);
    let _ = std::fs::write(&log_path, &debug_line);
    webbrowser::open(&auth_url)
        .map_err(|e| AppError::OAuth(format!("open browser: {}", e)))?;

    let state_clone = state.clone();
    let code = tokio::task::spawn_blocking(move || {
        wait_for_callback(server, state_clone, Duration::from_secs(300))
    })
    .await
    .map_err(|e| AppError::Other(format!("join: {}", e)))??;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()?;

    match platform {
        Platform::Youtube => youtube_exchange(&client, &client_id, &client_secret, &redirect_uri, &code).await,
        Platform::Tiktok => tiktok_exchange(&client, &client_id, &client_secret, &redirect_uri, &code).await,
        Platform::Facebook | Platform::Instagram | Platform::Threads => {
            meta_finalize(&client, platform, &client_id, &client_secret, &redirect_uri, &code).await
        }
    }
}

async fn oauth_flow_threads_webview(
    app: &tauri::AppHandle,
    client_id: String,
    client_secret: String,
) -> AppResult<OAuthResult> {
    let state = random_state();
    let auth_url = build_auth_url(
        Platform::Threads,
        &client_id,
        THREADS_WEBVIEW_REDIRECT_URI,
        &state,
    );

    let log_path = std::env::temp_dir().join("social-publisher-oauth.log");
    let log_line = format!(
        "[oauth-threads-webview] url={}\n[oauth-threads-webview] redirect_uri={}\n",
        auth_url, THREADS_WEBVIEW_REDIRECT_URI
    );
    eprintln!("{}", log_line);
    let _ = std::fs::write(&log_path, &log_line);

    let parsed_url = Url::parse(&auth_url)
        .map_err(|e| AppError::OAuth(format!("invalid auth URL: {}", e)))?;

    let captured: Arc<Mutex<Option<Result<String, String>>>> = Arc::new(Mutex::new(None));
    let expected_prefix = THREADS_WEBVIEW_REDIRECT_URI.to_string();
    let expected_state = state.clone();

    let extract_from_url = move |url: &Url,
                                 expected_state: &str|
          -> Option<Result<String, String>> {
        let mut code_val: Option<String> = None;
        let mut state_val: Option<String> = None;
        let mut error_val: Option<String> = None;
        for (k, v) in url.query_pairs() {
            match k.as_ref() {
                "code" => code_val = Some(v.into_owned()),
                "state" => state_val = Some(v.into_owned()),
                "error" | "error_description" => error_val = Some(v.into_owned()),
                _ => {}
            }
        }
        if code_val.is_none() && error_val.is_none() {
            return None;
        }
        Some(if let Some(err) = error_val {
            Err(err)
        } else if state_val.as_deref() != Some(expected_state) {
            Err("State mismatch (CSRF guard)".into())
        } else if let Some(code) = code_val {
            Ok(code)
        } else {
            Err("Missing authorization code".into())
        })
    };

    let captured_for_nav = captured.clone();
    let prefix_for_nav = expected_prefix.clone();
    let state_for_nav = expected_state.clone();
    let extract_for_nav = extract_from_url.clone();

    let captured_for_load = captured.clone();
    let prefix_for_load = expected_prefix.clone();
    let state_for_load = expected_state.clone();
    let extract_for_load = extract_from_url;

    let label = format!("oauth-threads-{}", rand::random::<u32>());
    let window = tauri::WebviewWindowBuilder::new(
        app,
        &label,
        tauri::WebviewUrl::External(parsed_url),
    )
    .title("Authorize Threads")
    .inner_size(520.0, 760.0)
    .on_navigation(move |nav_url| {
        if !nav_url.as_str().starts_with(&prefix_for_nav) {
            return true;
        }
        if let Some(result) = extract_for_nav(nav_url, &state_for_nav) {
            if let Ok(mut guard) = captured_for_nav.lock() {
                *guard = Some(result);
            }
        }
        false
    })
    .on_page_load(move |_window, payload| {
        let url = payload.url();
        if !url.as_str().starts_with(&prefix_for_load) {
            return;
        }
        if let Some(result) = extract_for_load(url, &state_for_load) {
            if let Ok(mut guard) = captured_for_load.lock() {
                if guard.is_none() {
                    *guard = Some(result);
                }
            }
        }
    })
    .build()
    .map_err(|e| AppError::OAuth(format!("create webview: {}", e)))?;

    let user_closed = Arc::new(AtomicBool::new(false));
    let user_closed_clone = user_closed.clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
        ) {
            user_closed_clone.store(true, Ordering::SeqCst);
        }
    });

    let timeout = Duration::from_secs(300);
    let deadline = Instant::now() + timeout;
    let code = loop {
        if OAUTH_CANCEL.load(Ordering::SeqCst) {
            let _ = window.close();
            return Err(AppError::OAuth("Cancelled by user".into()));
        }
        if user_closed.load(Ordering::SeqCst) {
            return Err(AppError::OAuth("Window closed by user".into()));
        }
        if Instant::now() > deadline {
            let _ = window.close();
            return Err(AppError::OAuth("Timed out waiting for callback".into()));
        }
        let taken = captured.lock().ok().and_then(|mut g| g.take());
        if let Some(r) = taken {
            let _ = window.close();
            break r.map_err(AppError::OAuth)?;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()?;

    meta_finalize(
        &client,
        Platform::Threads,
        &client_id,
        &client_secret,
        THREADS_WEBVIEW_REDIRECT_URI,
        &code,
    )
    .await
}

async fn meta_finalize(
    client: &reqwest::Client,
    platform: Platform,
    client_id: &str,
    client_secret: &str,
    redirect_uri: &str,
    code: &str,
) -> AppResult<OAuthResult> {
    let short = exchange_short_token(client, platform, client_id, client_secret, redirect_uri, code).await?;
    let long = exchange_long_lived(client, platform, client_id, client_secret, &short.access_token).await?;
    let user_id = short.user_id.map(|v| match v {
        serde_json::Value::String(s) => s,
        serde_json::Value::Number(n) => n.to_string(),
        other => other.to_string(),
    });
    Ok(OAuthResult {
        access_token: long.access_token,
        expires_in: long.expires_in,
        user_id,
        refresh_token: None,
        open_id: None,
    })
}

async fn youtube_exchange(
    client: &reqwest::Client,
    client_id: &str,
    client_secret: &str,
    redirect_uri: &str,
    code: &str,
) -> AppResult<OAuthResult> {
    let resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("code", code),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri),
        ])
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::OAuth(format!("YT token {}: {}", status, text)));
    }
    let parsed: GoogleTokenResponse = resp.json().await?;
    Ok(OAuthResult {
        access_token: parsed.access_token,
        expires_in: parsed.expires_in,
        user_id: None,
        refresh_token: parsed.refresh_token,
        open_id: None,
    })
}

async fn tiktok_exchange(
    client: &reqwest::Client,
    client_key: &str,
    client_secret: &str,
    redirect_uri: &str,
    code: &str,
) -> AppResult<OAuthResult> {
    let resp = client
        .post("https://open.tiktokapis.com/v2/oauth/token/")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[
            ("client_key", client_key),
            ("client_secret", client_secret),
            ("code", code),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri),
        ])
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::OAuth(format!("TT token {}: {}", status, text)));
    }
    let parsed: TikTokTokenResponse = resp.json().await?;
    Ok(OAuthResult {
        access_token: parsed.access_token,
        expires_in: parsed.expires_in,
        user_id: parsed.open_id.clone(),
        refresh_token: parsed.refresh_token,
        open_id: parsed.open_id,
    })
}

async fn exchange_short_token(
    client: &reqwest::Client,
    platform: Platform,
    client_id: &str,
    client_secret: &str,
    redirect_uri: &str,
    code: &str,
) -> AppResult<ShortTokenResponse> {
    let url = meta_endpoints::short_token_url(platform);
    let resp = match platform {
        Platform::Facebook => {
            client
                .get(url)
                .query(&[
                    ("client_id", client_id),
                    ("client_secret", client_secret),
                    ("redirect_uri", redirect_uri),
                    ("code", code),
                ])
                .send()
                .await?
        }
        Platform::Instagram | Platform::Threads => {
            let params = [
                ("client_id", client_id),
                ("client_secret", client_secret),
                ("grant_type", "authorization_code"),
                ("redirect_uri", redirect_uri),
                ("code", code),
            ];
            client.post(url).form(&params).send().await?
        }
        _ => unreachable!(),
    };

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::OAuth(format!("token exchange {}: {}", status, text)));
    }

    let parsed: ShortTokenResponse = resp.json().await?;
    Ok(parsed)
}

async fn exchange_long_lived(
    client: &reqwest::Client,
    platform: Platform,
    client_id: &str,
    client_secret: &str,
    short_token: &str,
) -> AppResult<LongLivedResponse> {
    let url = meta_endpoints::long_lived_url(platform);
    let grant = meta_endpoints::long_lived_grant(platform);

    let resp = match platform {
        Platform::Facebook => {
            client
                .get(url)
                .query(&[
                    ("grant_type", grant),
                    ("client_id", client_id),
                    ("client_secret", client_secret),
                    ("fb_exchange_token", short_token),
                ])
                .send()
                .await?
        }
        Platform::Instagram | Platform::Threads => {
            client
                .get(url)
                .query(&[
                    ("grant_type", grant),
                    ("client_secret", client_secret),
                    ("access_token", short_token),
                ])
                .send()
                .await?
        }
        _ => unreachable!(),
    };

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::OAuth(format!(
            "long-lived exchange {}: {}",
            status, text
        )));
    }

    let parsed: LongLivedResponse = resp.json().await?;
    Ok(parsed)
}

/// Refresh helpers — callers (publish_*) use these to get a fresh access token
/// from the stored refresh_token before uploading.

#[derive(Serialize)]
pub struct YoutubeVerifyResult {
    pub channel_id: String,
    pub channel_title: String,
}

#[derive(Deserialize)]
struct YtChannelListResponse {
    #[serde(default)]
    items: Vec<YtChannelItem>,
}

#[derive(Deserialize)]
struct YtChannelItem {
    id: String,
    snippet: YtChannelSnippet,
}

#[derive(Deserialize)]
struct YtChannelSnippet {
    title: String,
}

#[tauri::command]
pub async fn youtube_verify(
    client_id: String,
    client_secret: String,
    refresh_token: String,
) -> AppResult<YoutubeVerifyResult> {
    if client_id.trim().is_empty() {
        return Err(AppError::Config("YouTube client_id is empty".into()));
    }
    if client_secret.trim().is_empty() {
        return Err(AppError::Config("YouTube client_secret is empty".into()));
    }
    if refresh_token.trim().is_empty() {
        return Err(AppError::Config(
            "尚未授權 YouTube：請先按「連接 OAuth」完成 Google 登入流程。".into(),
        ));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;
    let access_token =
        youtube_refresh_access_token(&client, &client_id, &client_secret, &refresh_token).await?;

    let resp = client
        .get("https://www.googleapis.com/youtube/v3/channels")
        .query(&[("part", "snippet"), ("mine", "true")])
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Api(format!("YT verify {}: {}", status, text)));
    }

    let parsed: YtChannelListResponse = resp.json().await?;
    let item = parsed.items.into_iter().next().ok_or_else(|| {
        AppError::Api("YT verify: no channel returned for this account".into())
    })?;
    Ok(YoutubeVerifyResult {
        channel_id: item.id,
        channel_title: item.snippet.title,
    })
}

pub async fn youtube_refresh_access_token(
    client: &reqwest::Client,
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
) -> AppResult<String> {
    let resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::OAuth(format!("YT refresh {}: {}", status, text)));
    }
    let parsed: GoogleTokenResponse = resp.json().await?;
    Ok(parsed.access_token)
}

pub async fn tiktok_refresh_access_token(
    client: &reqwest::Client,
    client_key: &str,
    client_secret: &str,
    refresh_token: &str,
) -> AppResult<String> {
    let resp = client
        .post("https://open.tiktokapis.com/v2/oauth/token/")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[
            ("client_key", client_key),
            ("client_secret", client_secret),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::OAuth(format!("TT refresh {}: {}", status, text)));
    }
    let parsed: TikTokTokenResponse = resp.json().await?;
    Ok(parsed.access_token)
}

#[derive(Serialize, Deserialize)]
pub struct FbPage {
    pub id: String,
    pub name: String,
    pub access_token: String,
}

#[derive(Deserialize)]
struct FbPagesResponse {
    data: Vec<FbPage>,
}

#[tauri::command]
pub async fn facebook_list_pages(user_token: String) -> AppResult<Vec<FbPage>> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;
    let resp = client
        .get("https://graph.facebook.com/v21.0/me/accounts")
        .query(&[("access_token", user_token.as_str()), ("fields", "id,name,access_token")])
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Api(format!("/me/accounts {}: {}", status, text)));
    }

    let parsed: FbPagesResponse = resp.json().await?;
    Ok(parsed.data)
}

#[derive(Deserialize)]
struct IgMeResponse {
    id: String,
    #[serde(default)]
    #[allow(dead_code)]
    username: Option<String>,
}

#[tauri::command]
pub async fn instagram_resolve_user(access_token: String) -> AppResult<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;
    let resp = client
        .get("https://graph.instagram.com/v21.0/me")
        .query(&[
            ("fields", "id,username"),
            ("access_token", access_token.as_str()),
        ])
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Api(format!("/me {}: {}", status, text)));
    }

    let parsed: IgMeResponse = resp.json().await?;
    Ok(parsed.id)
}

#[tauri::command]
pub async fn threads_resolve_user(access_token: String) -> AppResult<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;
    let resp = client
        .get("https://graph.threads.net/v1.0/me")
        .query(&[
            ("fields", "id,username"),
            ("access_token", access_token.as_str()),
        ])
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Api(format!("/me {}: {}", status, text)));
    }

    let parsed: IgMeResponse = resp.json().await?;
    Ok(parsed.id)
}

#[derive(Deserialize)]
struct FbMeResponse {
    id: String,
    #[serde(default)]
    #[allow(dead_code)]
    name: Option<String>,
}

#[tauri::command]
pub async fn facebook_resolve_page(page_token: String) -> AppResult<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;
    let resp = client
        .get("https://graph.facebook.com/v21.0/me")
        .query(&[("fields", "id,name"), ("access_token", page_token.as_str())])
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Api(format!("/me {}: {}", status, text)));
    }

    let parsed: FbMeResponse = resp.json().await?;
    Ok(parsed.id)
}

#[derive(Deserialize)]
struct DebugTokenEnvelope {
    data: DebugTokenData,
}

#[derive(Deserialize, Default)]
struct DebugTokenData {
    #[serde(default)]
    expires_at: i64,
    #[serde(default)]
    #[allow(dead_code)]
    is_valid: bool,
}

async fn debug_token_at(base: &str, token: &str) -> AppResult<i64> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;
    let url = format!("{}/debug_token", base);
    let resp = client
        .get(&url)
        .query(&[("input_token", token), ("access_token", token)])
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Api(format!("/debug_token {}: {}", status, text)));
    }
    let parsed: DebugTokenEnvelope = resp.json().await?;
    Ok(parsed.data.expires_at)
}

#[tauri::command]
pub async fn facebook_debug_token(token: String) -> AppResult<i64> {
    debug_token_at("https://graph.facebook.com/v21.0", &token).await
}

#[derive(Serialize)]
pub struct FbTokenInspect {
    pub token_type: String,
    pub scopes: Vec<String>,
    pub granular_scopes: Vec<String>,
    pub expires_at: i64,
    pub is_valid: bool,
    pub user_id: Option<String>,
    pub profile_id: Option<String>,
}

#[derive(Deserialize)]
struct InspectEnvelope {
    data: InspectData,
}

#[derive(Deserialize, Default)]
struct InspectData {
    #[serde(default, rename = "type")]
    token_type: String,
    #[serde(default)]
    scopes: Vec<String>,
    #[serde(default)]
    granular_scopes: Vec<GranularScope>,
    #[serde(default)]
    expires_at: i64,
    #[serde(default)]
    is_valid: bool,
    #[serde(default)]
    user_id: Option<String>,
    #[serde(default)]
    profile_id: Option<String>,
}

#[derive(Deserialize, Default)]
struct GranularScope {
    #[serde(default)]
    scope: String,
}

#[tauri::command]
pub async fn facebook_inspect_token(token: String) -> AppResult<FbTokenInspect> {
    if token.trim().is_empty() {
        return Err(AppError::Config("Token 為空。".into()));
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;
    let url = "https://graph.facebook.com/v21.0/debug_token";
    let resp = client
        .get(url)
        .query(&[
            ("input_token", token.as_str()),
            ("access_token", token.as_str()),
        ])
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Api(format!("/debug_token {}: {}", status, text)));
    }
    let parsed: InspectEnvelope = resp.json().await?;
    let d = parsed.data;
    Ok(FbTokenInspect {
        token_type: d.token_type,
        scopes: d.scopes,
        granular_scopes: d.granular_scopes.into_iter().map(|g| g.scope).collect(),
        expires_at: d.expires_at,
        is_valid: d.is_valid,
        user_id: d.user_id,
        profile_id: d.profile_id,
    })
}

#[tauri::command]
pub async fn instagram_debug_token(token: String) -> AppResult<i64> {
    debug_token_at("https://graph.facebook.com/v21.0", &token).await
}

#[tauri::command]
pub async fn threads_debug_token(token: String) -> AppResult<i64> {
    debug_token_at("https://graph.threads.net/v1.0", &token).await
}

#[derive(Deserialize)]
struct RefreshTokenResponse {
    access_token: String,
    #[serde(default)]
    expires_in: i64,
}

#[tauri::command]
pub async fn instagram_refresh_token(access_token: String) -> AppResult<(String, i64)> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;
    let resp = client
        .get("https://graph.instagram.com/refresh_access_token")
        .query(&[
            ("grant_type", "ig_refresh_token"),
            ("access_token", access_token.as_str()),
        ])
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Api(format!(
            "/refresh_access_token {}: {}",
            status, text
        )));
    }
    let parsed: RefreshTokenResponse = resp.json().await?;
    Ok((parsed.access_token, parsed.expires_in))
}

#[tauri::command]
pub async fn threads_refresh_token(access_token: String) -> AppResult<(String, i64)> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;
    let resp = client
        .get("https://graph.threads.net/refresh_access_token")
        .query(&[
            ("grant_type", "th_refresh_token"),
            ("access_token", access_token.as_str()),
        ])
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Api(format!(
            "/refresh_access_token {}: {}",
            status, text
        )));
    }
    let parsed: RefreshTokenResponse = resp.json().await?;
    Ok((parsed.access_token, parsed.expires_in))
}
