use crate::error::{AppError, AppResult};
use crate::oauth;
use crate::platforms::PublishResult;
use base64::{engine::general_purpose, Engine};
use rand::RngCore;
use serde::Deserialize;
use std::time::Duration;

const UPLOAD_URL: &str =
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status";

#[derive(Deserialize)]
struct VideoResource {
    id: String,
}

fn http_client() -> AppResult<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()?)
}

fn random_boundary() -> String {
    let mut bytes = [0u8; 18];
    rand::thread_rng().fill_bytes(&mut bytes);
    format!("yt-{}", general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

fn normalize_privacy(input: &str) -> AppResult<&'static str> {
    match input.to_ascii_lowercase().as_str() {
        "public" => Ok("public"),
        "unlisted" => Ok("unlisted"),
        "private" => Ok("private"),
        other => Err(AppError::Config(format!(
            "Invalid YT privacyStatus: {}",
            other
        ))),
    }
}

#[tauri::command]
pub async fn publish_youtube(
    client_id: String,
    client_secret: String,
    refresh_token: String,
    title: String,
    description: String,
    privacy: String,
    video_path: String,
) -> AppResult<PublishResult> {
    if title.trim().is_empty() {
        return Err(AppError::Config("YouTube title is required".into()));
    }
    let privacy_status = normalize_privacy(&privacy)?;

    let client = http_client()?;
    let access_token =
        oauth::youtube_refresh_access_token(&client, &client_id, &client_secret, &refresh_token)
            .await?;

    let video_bytes = tokio::fs::read(&video_path).await?;
    let metadata = serde_json::json!({
        "snippet": {
            "title": title,
            "description": description,
            "categoryId": "22",
        },
        "status": {
            "privacyStatus": privacy_status,
            "selfDeclaredMadeForKids": false,
        }
    });
    let metadata_str = serde_json::to_string(&metadata)?;
    let mime = mime_guess::from_path(&video_path)
        .first_or_octet_stream()
        .essence_str()
        .to_string();

    let boundary = random_boundary();
    let mut body: Vec<u8> = Vec::with_capacity(video_bytes.len() + 1024);
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Type: application/json; charset=UTF-8\r\n\r\n");
    body.extend_from_slice(metadata_str.as_bytes());
    body.extend_from_slice(b"\r\n");
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(format!("Content-Type: {}\r\n\r\n", mime).as_bytes());
    body.extend_from_slice(&video_bytes);
    body.extend_from_slice(b"\r\n");
    body.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());

    let resp = client
        .post(UPLOAD_URL)
        .header("Authorization", format!("Bearer {}", access_token))
        .header(
            "Content-Type",
            format!("multipart/related; boundary={}", boundary),
        )
        .body(body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Api(format!("YT upload {}: {}", status, text)));
    }

    let parsed: VideoResource = resp.json().await?;
    let permalink = format!("https://youtube.com/watch?v={}", parsed.id);
    Ok(PublishResult {
        post_id: parsed.id,
        permalink: Some(permalink),
    })
}
