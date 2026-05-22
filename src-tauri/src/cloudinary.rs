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

#[derive(Deserialize)]
struct CloudinaryUsage {
    #[serde(default)]
    plan: String,
    #[serde(default)]
    credits: serde_json::Value,
}

#[derive(Serialize)]
pub struct VerifyResult {
    pub plan: String,
    pub credits_used: Option<f64>,
    pub credits_limit: Option<f64>,
}

#[tauri::command]
pub async fn cloudinary_delete(
    cloud_name: String,
    api_key: String,
    api_secret: String,
    public_id: String,
    kind: Option<String>,
) -> AppResult<()> {
    if cloud_name.is_empty() || api_key.is_empty() || api_secret.is_empty() || public_id.is_empty()
    {
        return Err(AppError::Config(
            "cloud_name, api_key, api_secret, public_id are required".into(),
        ));
    }
    let resource_type = match kind.as_deref() {
        Some("video") => "video",
        _ => "image",
    };
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
        .to_string();
    let to_sign = format!(
        "public_id={}&timestamp={}{}",
        public_id, timestamp, api_secret
    );
    let mut hasher = Sha1::new();
    hasher.update(to_sign.as_bytes());
    let signature = hex::encode(hasher.finalize());

    let url = format!(
        "https://api.cloudinary.com/v1_1/{}/{}/destroy",
        cloud_name, resource_type
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()?;
    let form = [
        ("api_key", api_key.as_str()),
        ("timestamp", timestamp.as_str()),
        ("signature", signature.as_str()),
        ("public_id", public_id.as_str()),
    ];
    let resp = client.post(&url).form(&form).send().await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Api(format!(
            "Cloudinary destroy {}: {}",
            status, text
        )));
    }
    Ok(())
}

#[tauri::command]
pub async fn cloudinary_verify(
    cloud_name: String,
    api_key: String,
    api_secret: String,
) -> AppResult<VerifyResult> {
    if cloud_name.is_empty() || api_key.is_empty() || api_secret.is_empty() {
        return Err(AppError::Config("Cloud name, API key and secret are required".into()));
    }
    let url = format!("https://api.cloudinary.com/v1_1/{}/usage", cloud_name);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;
    let resp = client
        .get(&url)
        .basic_auth(&api_key, Some(&api_secret))
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Api(format!("Cloudinary /usage {}: {}", status, text)));
    }
    let parsed: CloudinaryUsage = resp.json().await?;
    let (used, limit) = match &parsed.credits {
        serde_json::Value::Object(map) => (
            map.get("usage").and_then(|v| v.as_f64()),
            map.get("limit").and_then(|v| v.as_f64()),
        ),
        serde_json::Value::Number(n) => (n.as_f64(), None),
        _ => (None, None),
    };
    Ok(VerifyResult {
        plan: parsed.plan,
        credits_used: used,
        credits_limit: limit,
    })
}

#[tauri::command]
pub async fn cloudinary_upload(
    cloud_name: String,
    api_key: String,
    api_secret: String,
    file_path: String,
    kind: Option<String>,
) -> AppResult<UploadResult> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(AppError::Config(format!("File not found: {}", file_path)));
    }

    let resource_type = match kind.as_deref() {
        Some("video") => "video",
        _ => "image",
    };

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
        "https://api.cloudinary.com/v1_1/{}/{}/upload",
        cloud_name, resource_type
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
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
