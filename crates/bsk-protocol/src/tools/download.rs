//! `tool.download_config` / `tool.download_events` — configure and inspect downloads.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct DownloadConfigParams {
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_id: Option<i64>,
    pub download_path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct DownloadConfigResult {
    pub tab_id: i64,
    /// Cursor to pass to `download events --since` after configuration.
    pub next_since: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct DownloadEventsParams {
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(range(min = 1))]
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum DownloadEntryKind {
    WillBegin,
    Progress,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct DownloadEntry {
    pub sequence: u64,
    pub kind: DownloadEntryKind,
    pub guid: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggested_filename: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub received_bytes: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_bytes: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct DownloadEventsResult {
    pub tab_id: i64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub entries: Vec<DownloadEntry>,
    pub next_since: u64,
    #[serde(default)]
    pub truncated: bool,
}
