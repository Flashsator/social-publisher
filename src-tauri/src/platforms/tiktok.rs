use crate::error::{AppError, AppResult};
use crate::oauth;
use crate::platforms::PublishResult;
use serde::Deserialize;
use std::time::Duration;

const INBOX_INIT: &str = "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/";
const DIRECT_INIT: &str = "https://open.tiktokapis.com/v2/post/publish/video/init/";

// TikTok single-chunk FILE_UPLOAD limit (max chunk size).
const SINGLE_CHUNK_MAX: usize = 64 * 1024 * 1024;

#[derive(Deserialize)]
struct InitResponse {
    #[serde(default)]
    data: Option<InitData>,
    #[serde(default)]
    error: Option<InitError>,
}

#[derive(Deserialize)]
struct InitData {
    #[serde(default)]
    publish_id: Option<String>,
    #[serde(default)]
    upload_url: Option<String>,
}

#[derive(Deserialize)]
struct InitError {
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

fn http_client() -> AppResult<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()?)
}

fn normalize_privacy(input: &str) -> AppResult<&'static str> {
    match input.to_ascii_uppercase().as_str() {
        "PUBLIC_TO_EVERYONE" => Ok("PUBLIC_TO_EVERYONE"),
        "MUTUAL_FOLLOW_FRIENDS" => Ok("MUTUAL_FOLLOW_FRIENDS"),
        "FOLLOWER_OF_CREATOR" => Ok("FOLLOWER_OF_CREATOR"),
        "SELF_ONLY" => Ok("SELF_ONLY"),
        other => Err(AppError::Config(format!(
            "Invalid TT privacy_level: {}",
            other
        ))),
    }
}

#[tauri::command]
pub async fn publish_tiktok(
    client_id: String,
    client_secret: String,
    refresh_token: String,
    mode: String,
    source: String,
    video_url: Option<String>,
    video_path: Option<String>,
    title: Option<String>,
    privacy_level: Option<String>,
) -> AppResult<PublishResult> {
    let client = http_client()?;
    let access_token =
        oauth::tiktok_refresh_access_token(&client, &client_id, &client_secret, &refresh_token)
            .await?;

    let endpoint = match mode.to_ascii_lowercase().as_str() {
        "inbox" => INBOX_INIT,
        "direct_post" | "direct" => DIRECT_INIT,
        other => {
            return Err(AppError::Config(format!(
                "Invalid TikTok mode: {} (expected 'inbox' or 'direct_post')",
                other
            )));
        }
    };

    let post_info = if endpoint == DIRECT_INIT {
        let privacy = normalize_privacy(privacy_level.as_deref().unwrap_or("SELF_ONLY"))?;
        let title_str = title.as_deref().unwrap_or("").to_string();
        Some(serde_json::json!({
            "title": title_str,
            "privacy_level": privacy,
            "disable_duet": false,
            "disable_comment": false,
            "disable_stitch": false,
        }))
    } else {
        None
    };

    match source.to_ascii_lowercase().as_str() {
        "pull_from_url" | "pull" => {
            let url = video_url
                .as_deref()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| AppError::Config("TikTok PULL_FROM_URL requires video_url".into()))?;
            let publish_id =
                init_pull_from_url(&client, &access_token, endpoint, post_info, url).await?;
            Ok(PublishResult {
                post_id: publish_id,
                permalink: None,
            })
        }
        "file_upload" | "file" => {
            let path = video_path
                .as_deref()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| {
                    AppError::Config("TikTok FILE_UPLOAD requires video_path".into())
                })?;
            let publish_id =
                upload_via_file(&client, &access_token, endpoint, post_info, path).await?;
            Ok(PublishResult {
                post_id: publish_id,
                permalink: None,
            })
        }
        other => Err(AppError::Config(format!(
            "Invalid TikTok source: {} (expected 'file_upload' or 'pull_from_url')",
            other
        ))),
    }
}

async fn init_pull_from_url(
    client: &reqwest::Client,
    access_token: &str,
    endpoint: &str,
    post_info: Option<serde_json::Value>,
    video_url: &str,
) -> AppResult<String> {
    let source_info = serde_json::json!({
        "source": "PULL_FROM_URL",
        "video_url": video_url,
    });
    let payload = build_payload(post_info, source_info);

    let resp = client
        .post(endpoint)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "application/json; charset=UTF-8")
        .json(&payload)
        .send()
        .await?;
    let data = parse_init(resp, "TT init").await?;
    data.publish_id
        .ok_or_else(|| AppError::Api("TT response missing publish_id".into()))
}

async fn upload_via_file(
    client: &reqwest::Client,
    access_token: &str,
    endpoint: &str,
    post_info: Option<serde_json::Value>,
    video_path: &str,
) -> AppResult<String> {
    let bytes = tokio::fs::read(video_path).await?;
    let size = bytes.len();
    if size == 0 {
        return Err(AppError::Config("Video file is empty".into()));
    }
    if size > SINGLE_CHUNK_MAX {
        return Err(AppError::Config(format!(
            "TikTok FILE_UPLOAD single-chunk limit is 64 MiB; got {} bytes. Use PULL_FROM_URL for larger files.",
            size
        )));
    }

    let source_info = serde_json::json!({
        "source": "FILE_UPLOAD",
        "video_size": size,
        "chunk_size": size,
        "total_chunk_count": 1,
    });
    let payload = build_payload(post_info, source_info);

    let resp = client
        .post(endpoint)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "application/json; charset=UTF-8")
        .json(&payload)
        .send()
        .await?;
    let data = parse_init(resp, "TT init").await?;
    let upload_url = data
        .upload_url
        .ok_or_else(|| AppError::Api("TT init missing upload_url".into()))?;
    let publish_id = data
        .publish_id
        .ok_or_else(|| AppError::Api("TT init missing publish_id".into()))?;

    let mime = mime_guess::from_path(video_path)
        .first_or_octet_stream()
        .essence_str()
        .to_string();
    let put_resp = client
        .put(&upload_url)
        .header("Content-Type", mime)
        .header(
            "Content-Range",
            format!("bytes 0-{}/{}", size - 1, size),
        )
        .body(bytes)
        .send()
        .await?;

    if !put_resp.status().is_success() {
        let status = put_resp.status();
        let text = put_resp.text().await.unwrap_or_default();
        return Err(AppError::Api(format!("TT upload {}: {}", status, text)));
    }

    Ok(publish_id)
}

fn build_payload(
    post_info: Option<serde_json::Value>,
    source_info: serde_json::Value,
) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    if let Some(pi) = post_info {
        map.insert("post_info".to_string(), pi);
    }
    map.insert("source_info".to_string(), source_info);
    serde_json::Value::Object(map)
}

async fn parse_init(resp: reqwest::Response, ctx: &str) -> AppResult<InitData> {
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Api(format!("{} {}: {}", ctx, status, text)));
    }
    let parsed: InitResponse = resp.json().await?;
    if let Some(err) = parsed.error.as_ref() {
        let code = err.code.as_deref().unwrap_or("");
        if !code.is_empty() && code != "ok" {
            let msg = err.message.as_deref().unwrap_or("unknown");
            return Err(AppError::Api(format!("TT error [{}]: {}", code, msg)));
        }
    }
    parsed
        .data
        .ok_or_else(|| AppError::Api("TT response missing data".into()))
}
