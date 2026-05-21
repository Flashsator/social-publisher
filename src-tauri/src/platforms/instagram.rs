use crate::error::{AppError, AppResult};
use crate::platforms::PublishResult;
use serde::Deserialize;
use std::time::Duration;
use tokio::time::sleep;

const IG_API: &str = "https://graph.instagram.com/v21.0";
const MAX_STATUS_POLLS: u32 = 30;
const POLL_INTERVAL_SECS: u64 = 2;

#[derive(Deserialize)]
struct IdResponse {
    id: String,
}

#[derive(Deserialize)]
struct StatusResponse {
    status_code: String,
}

fn http_client() -> AppResult<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()?)
}

#[tauri::command]
pub async fn publish_instagram(
    ig_user_id: String,
    access_token: String,
    text: String,
    image_urls: Vec<String>,
) -> AppResult<PublishResult> {
    if image_urls.is_empty() {
        return Err(AppError::Config(
            "Instagram requires at least one image; text-only is not supported".into(),
        ));
    }

    let client = http_client()?;
    let container_id = if image_urls.len() == 1 {
        create_single_container(&client, &ig_user_id, &access_token, &text, &image_urls[0])
            .await?
    } else {
        create_carousel_container(&client, &ig_user_id, &access_token, &text, &image_urls).await?
    };

    wait_until_finished(&client, &container_id, &access_token).await?;
    let post_id = publish_container(&client, &ig_user_id, &access_token, &container_id).await?;

    Ok(PublishResult {
        post_id,
        permalink: None,
    })
}

async fn create_single_container(
    client: &reqwest::Client,
    ig_user_id: &str,
    token: &str,
    caption: &str,
    image_url: &str,
) -> AppResult<String> {
    let url = format!("{}/{}/media", IG_API, ig_user_id);
    let resp = client
        .post(&url)
        .form(&[
            ("image_url", image_url),
            ("caption", caption),
            ("access_token", token),
        ])
        .send()
        .await?;
    parse_id_response(resp, "media").await
}

async fn create_carousel_container(
    client: &reqwest::Client,
    ig_user_id: &str,
    token: &str,
    caption: &str,
    image_urls: &[String],
) -> AppResult<String> {
    // 1) Create item containers (sequentially to avoid burst rate-limit)
    let mut item_ids = Vec::with_capacity(image_urls.len());
    for img in image_urls {
        let url = format!("{}/{}/media", IG_API, ig_user_id);
        let resp = client
            .post(&url)
            .form(&[
                ("image_url", img.as_str()),
                ("is_carousel_item", "true"),
                ("access_token", token),
            ])
            .send()
            .await?;
        let id = parse_id_response(resp, "media item").await?;
        item_ids.push(id);
    }

    // 2) Wait for all item containers to be FINISHED before building parent
    for id in &item_ids {
        wait_until_finished(client, id, token).await?;
    }

    // 3) Create parent carousel container
    let children = item_ids.join(",");
    let url = format!("{}/{}/media", IG_API, ig_user_id);
    let resp = client
        .post(&url)
        .form(&[
            ("media_type", "CAROUSEL"),
            ("children", children.as_str()),
            ("caption", caption),
            ("access_token", token),
        ])
        .send()
        .await?;
    parse_id_response(resp, "carousel").await
}

async fn publish_container(
    client: &reqwest::Client,
    ig_user_id: &str,
    token: &str,
    creation_id: &str,
) -> AppResult<String> {
    let url = format!("{}/{}/media_publish", IG_API, ig_user_id);
    let resp = client
        .post(&url)
        .form(&[("creation_id", creation_id), ("access_token", token)])
        .send()
        .await?;
    parse_id_response(resp, "publish").await
}

async fn wait_until_finished(
    client: &reqwest::Client,
    container_id: &str,
    token: &str,
) -> AppResult<()> {
    for _ in 0..MAX_STATUS_POLLS {
        let url = format!("{}/{}", IG_API, container_id);
        let resp = client
            .get(&url)
            .query(&[("fields", "status_code"), ("access_token", token)])
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(AppError::Api(format!("IG status {}: {}", status, text)));
        }

        let parsed: StatusResponse = resp.json().await?;
        match parsed.status_code.as_str() {
            "FINISHED" => return Ok(()),
            "ERROR" | "EXPIRED" => {
                return Err(AppError::Api(format!(
                    "IG container status: {}",
                    parsed.status_code
                )));
            }
            _ => sleep(Duration::from_secs(POLL_INTERVAL_SECS)).await,
        }
    }
    Err(AppError::Api(
        "IG container did not reach FINISHED status in time".into(),
    ))
}

async fn parse_id_response(resp: reqwest::Response, ctx: &str) -> AppResult<String> {
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Api(format!("IG {} {}: {}", ctx, status, text)));
    }
    let parsed: IdResponse = resp.json().await?;
    Ok(parsed.id)
}
