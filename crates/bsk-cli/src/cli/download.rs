//! `bsk download` — configure and inspect Chromium downloads.

use std::path::PathBuf;
use std::time::Duration;

use anyhow::Context;
use bsk_protocol::Method;
use bsk_protocol::tools::{
    DownloadConfigParams, DownloadConfigResult, DownloadEntry, DownloadEntryKind,
    DownloadEventsParams, DownloadEventsResult,
};
use clap::{Args, Subcommand};

use crate::cli::TOOL_IPC_TIMEOUT;
use crate::cli::ensure_daemon::ensure_daemon;
use crate::cli::error::{CliError, Format};

#[derive(Debug, Clone, Subcommand)]
pub enum DownloadCmd {
    /// Allow downloads and route them to a directory; enables CDP download events.
    Config(DownloadConfigArgs),
    /// Read buffered Browser.downloadWillBegin / Browser.downloadProgress events.
    Events(DownloadEventsArgs),
}

#[derive(Debug, Clone, Args)]
pub struct DownloadConfigArgs {
    #[arg(long)]
    pub session: String,
    #[arg(long = "tab-id")]
    pub tab_id: Option<i64>,
    #[arg(long = "dir")]
    pub download_path: String,
}

#[derive(Debug, Clone, Args)]
pub struct DownloadEventsArgs {
    #[arg(long)]
    pub session: String,
    #[arg(long = "tab-id")]
    pub tab_id: Option<i64>,
    #[arg(long)]
    pub since: Option<u64>,
    #[arg(long, value_parser = clap::value_parser!(u32).range(1..=200))]
    pub limit: Option<u32>,
}

pub fn dispatch(cmd: DownloadCmd, format: Format) -> Result<(), CliError> {
    match cmd {
        DownloadCmd::Config(args) => config(args, format),
        DownloadCmd::Events(args) => events(args, format),
    }
}

fn config(args: DownloadConfigArgs, format: Format) -> Result<(), CliError> {
    let info = ensure_daemon().context("ensure daemon is running")?;
    let params = DownloadConfigParams {
        session_id: args.session,
        tab_id: args.tab_id,
        download_path: args.download_path,
    };
    let reply: DownloadConfigResult = crate::cli::business_rpc::call(
        info.sock_path,
        "download config",
        Method::ToolDownloadConfig,
        Some(params),
        TOOL_IPC_TIMEOUT,
    )?;
    render_config(&reply, format)
}

fn events(args: DownloadEventsArgs, format: Format) -> Result<(), CliError> {
    let info = ensure_daemon().context("ensure daemon is running")?;
    let params = DownloadEventsParams {
        session_id: args.session,
        tab_id: args.tab_id,
        since: args.since,
        limit: args.limit,
    };
    // Reading an in-memory buffer is fast; retain the normal tool timeout.
    let reply: DownloadEventsResult = crate::cli::business_rpc::call(
        info.sock_path,
        "download events",
        Method::ToolDownloadEvents,
        Some(params),
        TOOL_IPC_TIMEOUT.max(Duration::from_secs(5)),
    )?;
    render_events(&reply, format)
}

fn render_config(reply: &DownloadConfigResult, format: Format) -> Result<(), CliError> {
    match format {
        Format::Json => println!("{}", serde_json::to_string_pretty(reply).map_err(|e| CliError::Local(e.into()))?),
        Format::Human => println!("downloads enabled on tab {} (cursor={})", reply.tab_id, reply.next_since),
    }
    Ok(())
}

fn render_events(reply: &DownloadEventsResult, format: Format) -> Result<(), CliError> {
    match format {
        Format::Json => println!("{}", serde_json::to_string_pretty(reply).map_err(|e| CliError::Local(e.into()))?),
        Format::Human => {
            if reply.entries.is_empty() {
                println!("(no download activity captured)");
            } else {
                for e in &reply.entries { println!("{}", render_entry(e)); }
            }
        }
    }
    Ok(())
}

fn render_entry(e: &DownloadEntry) -> String {
    match e.kind {
        DownloadEntryKind::WillBegin => format!(
            "#{} BEGIN {} {}",
            e.sequence,
            e.suggested_filename.as_deref().unwrap_or("(unnamed)"),
            e.url.as_deref().unwrap_or("")
        ),
        DownloadEntryKind::Progress => format!(
            "#{} {} {} {}/{}",
            e.sequence,
            e.state.as_deref().unwrap_or("in_progress"),
            e.guid,
            e.received_bytes.unwrap_or(0.0),
            e.total_bytes.unwrap_or(0.0)
        ),
    }
}
