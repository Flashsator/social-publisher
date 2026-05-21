pub mod facebook;
pub mod instagram;
pub mod threads;

use serde::Serialize;

#[derive(Serialize, Debug, Clone)]
pub struct PublishResult {
    pub post_id: String,
    pub permalink: Option<String>,
}
