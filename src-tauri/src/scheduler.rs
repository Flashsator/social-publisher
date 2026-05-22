use crate::error::{AppError, AppResult};
use crate::platforms::{self, PublishResult};
use crate::vault;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleStatus {
    Pending,
    Running,
    Done,
    Failed,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledMedia {
    pub kind: String,
    pub local_path: String,
    #[serde(default)]
    pub remote_url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlatformOutcome {
    pub platform: String,
    pub ok: bool,
    pub message: String,
    pub permalink: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledPost {
    pub id: String,
    pub scheduled_at: i64,
    pub created_at: i64,
    pub status: ScheduleStatus,
    pub compose_mode: String,
    pub text: String,
    pub video_title: String,
    pub media: Vec<ScheduledMedia>,
    pub platforms: Vec<String>,
    pub post_privacy: String,
    pub tt_mode: String,
    pub tt_source: String,
    #[serde(default)]
    pub results: Vec<PlatformOutcome>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub started_at: Option<i64>,
    #[serde(default)]
    pub finished_at: Option<i64>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleInput {
    pub scheduled_at: i64,
    pub compose_mode: String,
    pub text: String,
    pub video_title: String,
    pub media: Vec<ScheduledMedia>,
    pub platforms: Vec<String>,
    pub post_privacy: String,
    pub tt_mode: String,
    pub tt_source: String,
}

pub struct SchedulerState {
    pub posts: Mutex<Vec<ScheduledPost>>,
    pub file_path: PathBuf,
}

const MIN_LEAD_SECS: i64 = 60;
const TICK_SECS: u64 = 30;

fn now_ts() -> i64 {
    Utc::now().timestamp()
}

fn resolve_file_path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(format!("app_data_dir: {}", e)))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("schedule.json"))
}

fn load_from_file(path: &Path) -> AppResult<Vec<ScheduledPost>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = std::fs::read(path)?;
    if bytes.is_empty() {
        return Ok(Vec::new());
    }
    let posts: Vec<ScheduledPost> = serde_json::from_slice(&bytes)?;
    Ok(posts)
}

fn save_to_file(path: &Path, posts: &[ScheduledPost]) -> AppResult<()> {
    let bytes = serde_json::to_vec_pretty(posts)?;
    std::fs::write(path, bytes)?;
    Ok(())
}

fn derive_yt_privacy(post_privacy: &str) -> String {
    if post_privacy == "public" {
        "public".into()
    } else {
        "private".into()
    }
}

fn derive_tt_privacy(post_privacy: &str) -> String {
    if post_privacy == "public" {
        "PUBLIC_TO_EVERYONE".into()
    } else {
        "SELF_ONLY".into()
    }
}

fn apply_input(post: &mut ScheduledPost, input: ScheduleInput) {
    post.scheduled_at = input.scheduled_at;
    post.compose_mode = input.compose_mode;
    post.text = input.text;
    post.video_title = input.video_title;
    post.media = input.media;
    post.platforms = input.platforms;
    post.post_privacy = input.post_privacy;
    post.tt_mode = input.tt_mode;
    post.tt_source = input.tt_source;
}

pub fn init_state(app: &AppHandle) -> AppResult<SchedulerState> {
    let file_path = resolve_file_path(app)?;
    let posts = load_from_file(&file_path)?;
    Ok(SchedulerState {
        posts: Mutex::new(posts),
        file_path,
    })
}

pub fn spawn_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(TICK_SECS));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            interval.tick().await;
            let _ = tick_once(&app).await;
        }
    });
}

async fn tick_once(app: &AppHandle) -> AppResult<()> {
    let state: State<SchedulerState> = app.state();
    let now = now_ts();
    let due_ids: Vec<String> = {
        let guard = state.posts.lock().await;
        guard
            .iter()
            .filter(|p| p.status == ScheduleStatus::Pending && p.scheduled_at <= now)
            .map(|p| p.id.clone())
            .collect()
    };
    for id in due_ids {
        let post = {
            let mut g = state.posts.lock().await;
            let Some(p) = g.iter_mut().find(|p| p.id == id) else {
                continue;
            };
            if p.status != ScheduleStatus::Pending {
                continue;
            }
            p.status = ScheduleStatus::Running;
            p.started_at = Some(now_ts());
            let snap = p.clone();
            let _ = save_to_file(&state.file_path, &g);
            snap
        };
        let outcomes = execute(&post).await;
        let mut g = state.posts.lock().await;
        if let Some(p) = g.iter_mut().find(|p| p.id == id) {
            p.finished_at = Some(now_ts());
            p.status = if !outcomes.is_empty() && outcomes.iter().all(|o| o.ok) {
                ScheduleStatus::Done
            } else {
                ScheduleStatus::Failed
            };
            p.results = outcomes;
            p.error = None;
        }
        let _ = save_to_file(&state.file_path, &g);
    }
    Ok(())
}

fn item_needs_remote(post: &ScheduledPost, m: &ScheduledMedia) -> bool {
    if m.remote_url.is_some() {
        return false;
    }
    if m.kind == "image" {
        post.platforms
            .iter()
            .any(|p| matches!(p.as_str(), "facebook" | "instagram" | "threads"))
    } else {
        post.platforms.iter().any(|p| match p.as_str() {
            "instagram" | "threads" => true,
            "tiktok" => post.tt_source == "pull_from_url",
            _ => false,
        })
    }
}

fn error_outcomes(post: &ScheduledPost, msg: &str) -> Vec<PlatformOutcome> {
    post.platforms
        .iter()
        .map(|p| PlatformOutcome {
            platform: p.clone(),
            ok: false,
            message: msg.to_string(),
            permalink: None,
        })
        .collect()
}

async fn publish_all(post: &ScheduledPost, media: &[ScheduledMedia]) -> Vec<PlatformOutcome> {
    let mut out = Vec::new();
    let images: Vec<String> = media
        .iter()
        .filter(|m| m.kind == "image")
        .filter_map(|m| m.remote_url.clone())
        .collect();
    let video = media.iter().find(|m| m.kind == "video");

    for platform in &post.platforms {
        let result: AppResult<PublishResult> = match platform.as_str() {
            "facebook" => fb_run(post, &images, video).await,
            "instagram" => ig_run(post, &images, video).await,
            "threads" => th_run(post, &images, video).await,
            "youtube" => yt_run(post, video).await,
            "tiktok" => tt_run(post, video).await,
            other => Err(AppError::Config(format!("unknown platform: {}", other))),
        };
        out.push(match result {
            Ok(r) => PlatformOutcome {
                platform: platform.clone(),
                ok: true,
                message: format!("Posted ({})", r.post_id),
                permalink: r.permalink,
            },
            Err(e) => PlatformOutcome {
                platform: platform.clone(),
                ok: false,
                message: e.to_string(),
                permalink: None,
            },
        });
    }
    out
}

async fn execute(post: &ScheduledPost) -> Vec<PlatformOutcome> {
    let needs_upload = post.media.iter().any(|m| item_needs_remote(post, m));
    if !needs_upload {
        return publish_all(post, &post.media).await;
    }

    let cn = match vault::vault_get("cl_cloud_name".into()) {
        Ok(Some(v)) if !v.is_empty() => v,
        _ => return error_outcomes(post, "Cloudinary cloud_name 未設定"),
    };
    let ak = match vault::vault_get("cl_api_key".into()) {
        Ok(Some(v)) if !v.is_empty() => v,
        _ => return error_outcomes(post, "Cloudinary api_key 未設定"),
    };
    let sk = match vault::vault_get("cl_api_secret".into()) {
        Ok(Some(v)) if !v.is_empty() => v,
        _ => return error_outcomes(post, "Cloudinary api_secret 未設定"),
    };

    let mut media = post.media.clone();
    let mut uploaded: Vec<(String, String)> = Vec::new();
    for m in media.iter_mut() {
        if !item_needs_remote(post, m) {
            continue;
        }
        match crate::cloudinary::cloudinary_upload(
            cn.clone(),
            ak.clone(),
            sk.clone(),
            m.local_path.clone(),
            Some(m.kind.clone()),
        )
        .await
        {
            Ok(r) => {
                m.remote_url = Some(r.url);
                uploaded.push((r.public_id, m.kind.clone()));
            }
            Err(e) => {
                for (pid, kind) in &uploaded {
                    let _ = crate::cloudinary::cloudinary_delete(
                        cn.clone(),
                        ak.clone(),
                        sk.clone(),
                        pid.clone(),
                        Some(kind.clone()),
                    )
                    .await;
                }
                return error_outcomes(post, &format!("Cloudinary 上傳失敗: {}", e));
            }
        }
    }

    let outcomes = publish_all(post, &media).await;

    for (pid, kind) in uploaded {
        let _ = crate::cloudinary::cloudinary_delete(
            cn.clone(),
            ak.clone(),
            sk.clone(),
            pid,
            Some(kind),
        )
        .await;
    }

    outcomes
}

fn need(key: &str) -> AppResult<String> {
    vault::vault_get(key.into())?
        .ok_or_else(|| AppError::Config(format!("{} not configured", key)))
}

async fn fb_run(
    p: &ScheduledPost,
    images: &[String],
    video: Option<&ScheduledMedia>,
) -> AppResult<PublishResult> {
    let page_id = need("fb_page_id")?;
    let page_token = need("fb_page_token")?;
    platforms::facebook::publish_facebook(
        page_id,
        page_token,
        p.text.clone(),
        images.to_vec(),
        None,
        video.map(|v| v.local_path.clone()),
        Some(p.post_privacy == "public"),
    )
    .await
}

async fn ig_run(
    p: &ScheduledPost,
    images: &[String],
    video: Option<&ScheduledMedia>,
) -> AppResult<PublishResult> {
    let ig_user_id = need("ig_user_id")?;
    let token = need("ig_token")?;
    platforms::instagram::publish_instagram(
        ig_user_id,
        token,
        p.text.clone(),
        images.to_vec(),
        video.and_then(|v| v.remote_url.clone()),
    )
    .await
}

async fn th_run(
    p: &ScheduledPost,
    images: &[String],
    video: Option<&ScheduledMedia>,
) -> AppResult<PublishResult> {
    let th_user_id = need("th_user_id")?;
    let token = need("th_token")?;
    platforms::threads::publish_threads(
        th_user_id,
        token,
        p.text.clone(),
        images.to_vec(),
        video.and_then(|v| v.remote_url.clone()),
    )
    .await
}

async fn yt_run(p: &ScheduledPost, video: Option<&ScheduledMedia>) -> AppResult<PublishResult> {
    let video = video.ok_or_else(|| AppError::Config("YouTube requires a video".into()))?;
    if p.video_title.trim().is_empty() {
        return Err(AppError::Config(
            "Video title is required for YouTube".into(),
        ));
    }
    let client_id = need("yt_client_id")?;
    let client_secret = need("yt_client_secret")?;
    let refresh_token = need("yt_refresh_token")?;
    platforms::youtube::publish_youtube(
        client_id,
        client_secret,
        refresh_token,
        p.video_title.trim().to_string(),
        p.text.clone(),
        derive_yt_privacy(&p.post_privacy),
        video.local_path.clone(),
    )
    .await
}

async fn tt_run(p: &ScheduledPost, video: Option<&ScheduledMedia>) -> AppResult<PublishResult> {
    let video = video.ok_or_else(|| AppError::Config("TikTok requires a video".into()))?;
    let client_id = need("tt_client_id")?;
    let client_secret = need("tt_client_secret")?;
    let refresh_token = need("tt_refresh_token")?;
    let is_direct = p.tt_mode == "direct_post";
    let title = if is_direct {
        let candidate = p.video_title.trim();
        let final_title = if candidate.is_empty() {
            p.text.clone()
        } else {
            candidate.to_string()
        };
        Some(final_title)
    } else {
        None
    };
    let privacy = if is_direct {
        Some(derive_tt_privacy(&p.post_privacy))
    } else {
        None
    };
    let (video_url, video_path) = if p.tt_source == "pull_from_url" {
        (video.remote_url.clone(), None)
    } else {
        (None, Some(video.local_path.clone()))
    };
    if p.tt_source == "pull_from_url" && video_url.is_none() {
        return Err(AppError::Config(
            "TikTok PULL_FROM_URL requires a remote URL".into(),
        ));
    }
    platforms::tiktok::publish_tiktok(
        client_id,
        client_secret,
        refresh_token,
        p.tt_mode.clone(),
        p.tt_source.clone(),
        video_url,
        video_path,
        title,
        privacy,
    )
    .await
}

#[tauri::command]
pub async fn schedule_list(
    state: State<'_, SchedulerState>,
) -> AppResult<Vec<ScheduledPost>> {
    let mut out = state.posts.lock().await.clone();
    out.sort_by_key(|p| p.scheduled_at);
    Ok(out)
}

#[tauri::command]
pub async fn schedule_create(
    state: State<'_, SchedulerState>,
    input: ScheduleInput,
) -> AppResult<ScheduledPost> {
    if input.scheduled_at < now_ts() + MIN_LEAD_SECS {
        return Err(AppError::Config(format!(
            "scheduled_at must be at least {} seconds in the future",
            MIN_LEAD_SECS
        )));
    }
    let post = ScheduledPost {
        id: Uuid::new_v4().to_string(),
        scheduled_at: input.scheduled_at,
        created_at: now_ts(),
        status: ScheduleStatus::Pending,
        compose_mode: input.compose_mode.clone(),
        text: input.text.clone(),
        video_title: input.video_title.clone(),
        media: input.media.clone(),
        platforms: input.platforms.clone(),
        post_privacy: input.post_privacy.clone(),
        tt_mode: input.tt_mode.clone(),
        tt_source: input.tt_source.clone(),
        results: vec![],
        error: None,
        started_at: None,
        finished_at: None,
    };
    let mut guard = state.posts.lock().await;
    guard.push(post.clone());
    save_to_file(&state.file_path, &guard)?;
    Ok(post)
}

#[tauri::command]
pub async fn schedule_update(
    state: State<'_, SchedulerState>,
    id: String,
    input: ScheduleInput,
) -> AppResult<ScheduledPost> {
    if input.scheduled_at < now_ts() + MIN_LEAD_SECS {
        return Err(AppError::Config(format!(
            "scheduled_at must be at least {} seconds in the future",
            MIN_LEAD_SECS
        )));
    }
    let mut guard = state.posts.lock().await;
    let post = guard
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| AppError::Config(format!("schedule {} not found", id)))?;
    if matches!(post.status, ScheduleStatus::Running | ScheduleStatus::Done) {
        return Err(AppError::Config(
            "only pending or failed schedules can be edited".into(),
        ));
    }
    apply_input(post, input);
    post.status = ScheduleStatus::Pending;
    post.error = None;
    post.results.clear();
    post.started_at = None;
    post.finished_at = None;
    let updated = post.clone();
    save_to_file(&state.file_path, &guard)?;
    Ok(updated)
}

#[tauri::command]
pub async fn schedule_delete(
    state: State<'_, SchedulerState>,
    id: String,
) -> AppResult<()> {
    let mut guard = state.posts.lock().await;
    guard.retain(|p| p.id != id);
    save_to_file(&state.file_path, &guard)?;
    Ok(())
}
