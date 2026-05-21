use crate::error::{AppError, AppResult};
use crate::platforms::PublishResult;
use serde::Deserialize;
use std::time::Duration;
use tokio::time::sleep;

const TH_API: &str = "https://graph.threads.net/v1.0";
const TEXT_LIMIT: usize = 500;
const MAX_STATUS_POLLS: u32 = 30;
const POLL_INTERVAL_SECS: u64 = 2;

#[derive(Deserialize)]
struct IdResponse {
    id: String,
}

#[derive(Deserialize)]
struct StatusResponse {
    status: String,
}

fn http_client() -> AppResult<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()?)
}

#[tauri::command]
pub async fn publish_threads(
    th_user_id: String,
    access_token: String,
    text: String,
    image_urls: Vec<String>,
) -> AppResult<PublishResult> {
    let char_count = text.chars().count();
    if char_count > TEXT_LIMIT {
        return Err(AppError::Config(format!(
            "Threads text limit is {} chars; got {}",
            TEXT_LIMIT, char_count
        )));
    }

    let client = http_client()?;
    let container_id = match image_urls.len() {
        0 => create_text_container(&client, &th_user_id, &access_token, &text).await?,
        1 => create_image_container(
            &client,
            &th_user_id,
            &access_token,
            &text,
            &image_urls[0],
            false,
        )
        .await?,
        _ => create_carousel_container(&client, &th_user_id, &access_token, &text, &image_urls)
            .await?,
    };

    wait_until_finished(&client, &container_id, &access_token).await?;
    let post_id = publish_container(&client, &th_user_id, &access_token, &container_id).await?;

    Ok(PublishResult {
        post_id,
        permalink: None,
    })
}

async fn create_text_container(
    client: &reqwest::Client,
    user_id: &str,
    token: &str,
    text: &str,
) -> AppResult<String> {
    let url = format!("{}/{}/threads", TH_API, user_id);
    let resp = client
        .post(&url)
        .form(&[
            ("media_type", "TEXT"),
            ("text", text),
            ("access_token", token),
        ])
        .send()
        .await?;
    parse_id_response(resp, "text container").await
}

async fn create_image_container(
    client: &reqwest::Client,
    user_id: &str,
    token: &str,
    text: &str,
    image_url: &str,
    is_carousel_item: bool,
) -> AppResult<String> {
    let url = format!("{}/{}/threads", TH_API, user_id);
    let mut form: Vec<(&str, &str)> = vec![
        ("media_type", "IMAGE"),
        ("image_url", image_url),
        ("access_token", token),
    ];
    if is_carousel_item {
        form.push(("is_carousel_item", "true"));
    } else if !text.is_empty() {
        form.push(("text", text));
    }
    let resp = client.post(&url).form(&form).send().await?;
    parse_id_response(resp, "image container").await
}

async fn create_carousel_container(
    client: &reqwest::Client,
    user_id: &str,
    token: &str,
    text: &str,
    image_urls: &[String],
) -> AppResult<String> {
    let mut item_ids = Vec::with_capacity(image_urls.len());
    for img in image_urls {
        let id = create_image_container(client, user_id, token, "", img, true).await?;
        item_ids.push(id);
    }

    for id in &item_ids {
        wait_until_finished(client, id, token).await?;
    }

    let children = item_ids.join(",");
    let url = format!("{}/{}/threads", TH_API, user_id);
    let resp = client
        .post(&url)
        .form(&[
            ("media_type", "CAROUSEL"),
            ("children", children.as_str()),
            ("text", text),
            ("access_token", token),
        ])
        .send()
        .await?;
    parse_id_response(resp, "carousel").await
}

async fn publish_container(
    client: &reqwest::Client,
    user_id: &str,
    token: &str,
    creation_id: &str,
) -> AppResult<String> {
    let url = format!("{}/{}/threads_publish", TH_API, user_id);
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
        let url = format!("{}/{}", TH_API, container_id);
        let resp = client
            .get(&url)
            .query(&[("fields", "status"), ("access_token", token)])
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(AppError::Api(format!("Threads status {}: {}", status, text)));
        }

        let parsed: StatusResponse = resp.json().await?;
        match parsed.status.as_str() {
            "FINISHED" => return Ok(()),
            "ERROR" | "EXPIRED" => {
                return Err(AppError::Api(format!(
                    "Threads container status: {}",
                    parsed.status
                )));
            }
            _ => sleep(Duration::from_secs(POLL_INTERVAL_SECS)).await,
        }
    }
    Err(AppError::Api(
        "Threads container did not reach FINISHED status in time".into(),
    ))
}

async fn parse_id_response(resp: reqwest::Response, ctx: &str) -> AppResult<String> {
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Api(format!(
            "Threads {} {}: {}",
            ctx, status, text
        )));
    }
    let parsed: IdResponse = resp.json().await?;
    Ok(parsed.id)
}
