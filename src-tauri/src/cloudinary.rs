use crate::error::{AppError, AppResult};
use reqwest::multipart::{Form, Part};
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Deserialize)]
struct CloudinaryResponse {
    secure_url: String,
    public_id: String,
}

#[derive(Serialize)]
pub struct UploadResult {
    pub url: String,
    pub public_id: String,
}

#[tauri::command]
pub async fn cloudinary_upload(
    cloud_name: String,
    api_key: String,
    api_secret: String,
    file_path: String,
) -> AppResult<UploadResult> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(AppError::Config(format!("File not found: {}", file_path)));
    }

    let bytes = tokio::fs::read(path).await?;
    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("upload")
        .to_string();

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
        .to_string();

    // Cloudinary signature: SHA1 of "timestamp=<ts>" + api_secret
    let to_sign = format!("timestamp={}{}", timestamp, api_secret);
    let mut hasher = Sha1::new();
    hasher.update(to_sign.as_bytes());
    let signature = hex::encode(hasher.finalize());

    let mime = mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string();
    let part = Part::bytes(bytes)
        .file_name(filename)
        .mime_str(&mime)
        .map_err(|e| AppError::Other(e.to_string()))?;

    let form = Form::new()
        .text("api_key", api_key)
        .text("timestamp", timestamp)
        .text("signature", signature)
        .part("file", part);

    let url = format!(
        "https://api.cloudinary.com/v1_1/{}/image/upload",
        cloud_name
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()?;

    let resp = client.post(&url).multipart(form).send().await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Api(format!("Cloudinary {}: {}", status, text)));
    }

    let parsed: CloudinaryResponse = resp.json().await?;
    Ok(UploadResult {
        url: parsed.secure_url,
        public_id: parsed.public_id,
    })
}
