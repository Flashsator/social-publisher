use crate::error::{AppError, AppResult};
use crate::platforms::PublishResult;
use serde::Deserialize;
use std::time::Duration;

const FB_API: &str = "https://graph.facebook.com/v21.0";

#[derive(Deserialize)]
struct PostIdResponse {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    post_id: Option<String>,
}

impl PostIdResponse {
    fn into_id(self) -> AppResult<String> {
        self.post_id
            .or(self.id)
            .ok_or_else(|| AppError::Api("FB response missing id".into()))
    }
}

fn http_client() -> AppResult<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()?)
}

#[tauri::command]
pub async fn publish_facebook(
    page_id: String,
    page_token: String,
    text: String,
    image_urls: Vec<String>,
) -> AppResult<PublishResult> {
    let client = http_client()?;

    let raw_id = match image_urls.len() {
        0 => post_text(&client, &page_id, &page_token, &text).await?,
        1 => post_single_photo(&client, &page_id, &page_token, &text, &image_urls[0]).await?,
        _ => post_multi_photo(&client, &page_id, &page_token, &text, &image_urls).await?,
    };

    Ok(PublishResult {
        post_id: raw_id.clone(),
        permalink: Some(format!("https://www.facebook.com/{}", raw_id)),
    })
}

async fn post_text(
    client: &reqwest::Client,
    page_id: &str,
    token: &str,
    text: &str,
) -> AppResult<String> {
    let url = format!("{}/{}/feed", FB_API, page_id);
    let resp = client
        .post(&url)
        .form(&[("message", text), ("access_token", token)])
        .send()
        .await?;
    parse_id(resp).await
}

async fn post_single_photo(
    client: &reqwest::Client,
    page_id: &str,
    token: &str,
    text: &str,
    image_url: &str,
) -> AppResult<String> {
    let url = format!("{}/{}/photos", FB_API, page_id);
    let resp = client
        .post(&url)
        .form(&[
            ("url", image_url),
            ("caption", text),
            ("access_token", token),
        ])
        .send()
        .await?;
    parse_id(resp).await
}

async fn post_multi_photo(
    client: &reqwest::Client,
    page_id: &str,
    token: &str,
    text: &str,
    image_urls: &[String],
) -> AppResult<String> {
    // 1) Upload each photo with published=false to get a media_fbid
    let mut media_fbids = Vec::with_capacity(image_urls.len());
    for img_url in image_urls {
        let url = format!("{}/{}/photos", FB_API, page_id);
        let resp = client
            .post(&url)
            .form(&[
                ("url", img_url.as_str()),
                ("published", "false"),
                ("access_token", token),
            ])
            .send()
            .await?;
        let id = parse_id(resp).await?;
        media_fbids.push(id);
    }

    // 2) Create feed post with attached_media
    let url = format!("{}/{}/feed", FB_API, page_id);
    let attached_media = serde_json::Value::Array(
        media_fbids
            .iter()
            .map(|id| serde_json::json!({ "media_fbid": id }))
            .collect(),
    );
    let attached_media_str = attached_media.to_string();
    let resp = client
        .post(&url)
        .form(&[
            ("message", text),
            ("attached_media", attached_media_str.as_str()),
            ("access_token", token),
        ])
        .send()
        .await?;
    parse_id(resp).await
}

async fn parse_id(resp: reqwest::Response) -> AppResult<String> {
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Api(format!("FB {}: {}", status, text)));
    }
    let parsed: PostIdResponse = resp.json().await?;
    parsed.into_id()
}
