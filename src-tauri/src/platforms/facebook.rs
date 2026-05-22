use crate::error::{AppError, AppResult};
use crate::platforms::PublishResult;
use reqwest::multipart;
use serde::Deserialize;
use std::path::Path;
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
        .timeout(Duration::from_secs(600))
        .build()?)
}

#[tauri::command]
pub async fn publish_facebook(
    page_id: String,
    page_token: String,
    text: String,
    image_urls: Vec<String>,
    video_url: Option<String>,
    video_path: Option<String>,
    published: Option<bool>,
) -> AppResult<PublishResult> {
    let client = http_client()?;
    let is_published = published.unwrap_or(true);

    let local_video = video_path.as_deref().filter(|s| !s.is_empty());
    let remote_video = video_url.as_deref().filter(|s| !s.is_empty());

    let raw_id = if let Some(path) = local_video {
        post_video_local(&client, &page_id, &page_token, &text, path, is_published).await?
    } else if let Some(url) = remote_video {
        post_video_url(&client, &page_id, &page_token, &text, url, is_published).await?
    } else {
        match image_urls.len() {
            0 => post_text(&client, &page_id, &page_token, &text, is_published).await?,
            1 => {
                post_single_photo(
                    &client,
                    &page_id,
                    &page_token,
                    &text,
                    &image_urls[0],
                    is_published,
                )
                .await?
            }
            _ => {
                post_multi_photo(
                    &client,
                    &page_id,
                    &page_token,
                    &text,
                    &image_urls,
                    is_published,
                )
                .await?
            }
        }
    };

    Ok(PublishResult {
        post_id: raw_id.clone(),
        permalink: Some(format!("https://www.facebook.com/{}", raw_id)),
    })
}

fn pub_str(published: bool) -> &'static str {
    if published {
        "true"
    } else {
        "false"
    }
}

async fn post_video_url(
    client: &reqwest::Client,
    page_id: &str,
    token: &str,
    text: &str,
    video_url: &str,
    published: bool,
) -> AppResult<String> {
    let url = format!("{}/{}/videos", FB_API, page_id);
    let resp = client
        .post(&url)
        .form(&[
            ("file_url", video_url),
            ("description", text),
            ("published", pub_str(published)),
            ("access_token", token),
        ])
        .send()
        .await?;
    parse_id(resp).await
}

async fn post_video_local(
    client: &reqwest::Client,
    page_id: &str,
    token: &str,
    text: &str,
    video_path: &str,
    published: bool,
) -> AppResult<String> {
    let bytes = tokio::fs::read(video_path).await?;
    let file_name = Path::new(video_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("video.mp4")
        .to_string();
    let mime = mime_guess::from_path(video_path)
        .first_or_octet_stream()
        .essence_str()
        .to_string();

    let part = multipart::Part::bytes(bytes)
        .file_name(file_name)
        .mime_str(&mime)
        .map_err(|e| AppError::Other(format!("multipart mime: {}", e)))?;
    let form = multipart::Form::new()
        .part("source", part)
        .text("description", text.to_string())
        .text("published", pub_str(published).to_string())
        .text("access_token", token.to_string());

    let url = format!("{}/{}/videos", FB_API, page_id);
    let resp = client.post(&url).multipart(form).send().await?;
    parse_id(resp).await
}

async fn post_text(
    client: &reqwest::Client,
    page_id: &str,
    token: &str,
    text: &str,
    published: bool,
) -> AppResult<String> {
    let url = format!("{}/{}/feed", FB_API, page_id);
    let resp = client
        .post(&url)
        .form(&[
            ("message", text),
            ("published", pub_str(published)),
            ("access_token", token),
        ])
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
    published: bool,
) -> AppResult<String> {
    let url = format!("{}/{}/photos", FB_API, page_id);
    let resp = client
        .post(&url)
        .form(&[
            ("url", image_url),
            ("caption", text),
            ("published", pub_str(published)),
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
    published: bool,
) -> AppResult<String> {
    // 1) Upload each photo with published=false to get a media_fbid (carrier photos always unpublished)
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

    // 2) Create feed post with attached_media; published flag controls visibility of the post itself
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
            ("published", pub_str(published)),
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
