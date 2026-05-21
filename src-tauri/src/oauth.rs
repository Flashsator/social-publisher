use crate::error::{AppError, AppResult};
use base64::{engine::general_purpose, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tiny_http::{Header, Response, Server};
use url::Url;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Platform {
    Facebook,
    Instagram,
    Threads,
}

impl Platform {
    fn auth_url(&self) -> &'static str {
        match self {
            Platform::Facebook => "https://www.facebook.com/v21.0/dialog/oauth",
            Platform::Instagram => "https://www.instagram.com/oauth/authorize",
            Platform::Threads => "https://threads.net/oauth/authorize",
        }
    }

    fn short_token_url(&self) -> &'static str {
        match self {
            Platform::Facebook => "https://graph.facebook.com/v21.0/oauth/access_token",
            Platform::Instagram => "https://api.instagram.com/oauth/access_token",
            Platform::Threads => "https://graph.threads.net/oauth/access_token",
        }
    }

    fn long_lived_url(&self) -> &'static str {
        match self {
            Platform::Facebook => "https://graph.facebook.com/v21.0/oauth/access_token",
            Platform::Instagram => "https://graph.instagram.com/access_token",
            Platform::Threads => "https://graph.threads.net/access_token",
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
        }
    }

    fn long_lived_grant(&self) -> &'static str {
        match self {
            Platform::Facebook => "fb_exchange_token",
            Platform::Instagram => "ig_exchange_token",
            Platform::Threads => "th_exchange_token",
        }
    }
}

#[derive(Serialize)]
pub struct OAuthResult {
    pub access_token: String,
    pub expires_in: Option<i64>,
    pub user_id: Option<String>,
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
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(AppError::OAuth("Timed out waiting for callback".into()));
        }

        let req = match server.recv_timeout(remaining) {
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

#[tauri::command]
pub async fn oauth_flow(
    platform: Platform,
    client_id: String,
    client_secret: String,
) -> AppResult<OAuthResult> {
    let state = random_state();

    let server = Server::http("127.0.0.1:0")
        .map_err(|e| AppError::OAuth(format!("listener: {}", e)))?;
    let port = server
        .server_addr()
        .to_ip()
        .ok_or_else(|| AppError::OAuth("no port".into()))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{}/callback", port);

    let auth_url = format!(
        "{}?client_id={}&redirect_uri={}&scope={}&response_type=code&state={}",
        platform.auth_url(),
        urlencoding::encode(&client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(platform.scopes()),
        urlencoding::encode(&state),
    );

    webbrowser::open(&auth_url)
        .map_err(|e| AppError::OAuth(format!("open browser: {}", e)))?;

    // Block on the listener inside a blocking task so we don't block the async runtime.
    let state_clone = state.clone();
    let code = tokio::task::spawn_blocking(move || {
        wait_for_callback(server, state_clone, Duration::from_secs(300))
    })
    .await
    .map_err(|e| AppError::Other(format!("join: {}", e)))??;

    // 1) Exchange code -> short-lived token
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()?;

    let short = exchange_short_token(
        &client,
        platform,
        &client_id,
        &client_secret,
        &redirect_uri,
        &code,
    )
    .await?;

    // 2) Exchange short-lived -> long-lived (60d for IG/Threads, ~60d for FB)
    let long = exchange_long_lived(&client, platform, &client_id, &client_secret, &short.access_token)
        .await?;

    let user_id = short.user_id.map(|v| match v {
        serde_json::Value::String(s) => s,
        serde_json::Value::Number(n) => n.to_string(),
        other => other.to_string(),
    });

    Ok(OAuthResult {
        access_token: long.access_token,
        expires_in: long.expires_in,
        user_id,
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
    let url = platform.short_token_url();
    let resp = match platform {
        Platform::Facebook => {
            // FB uses GET with query params
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
            // IG / Threads use POST form-encoded
            let params = [
                ("client_id", client_id),
                ("client_secret", client_secret),
                ("grant_type", "authorization_code"),
                ("redirect_uri", redirect_uri),
                ("code", code),
            ];
            client.post(url).form(&params).send().await?
        }
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
    let url = platform.long_lived_url();
    let grant = platform.long_lived_grant();

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

/// After FB user-token OAuth, fetch the list of Pages the user manages
/// (each carries its own permanent Page-scoped access token derived from the
/// long-lived user token).
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

/// After IG OAuth, resolve the IG user ID from the access token via /me.
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
