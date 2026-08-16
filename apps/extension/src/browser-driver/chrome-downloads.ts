import type { DownloadEntry, DownloadEventsResult } from "@/transport/types";

/** Minimal chrome.downloads surface used by ChromeDownloads, injectable for tests. */
export interface ChromeDownloadsApi {
  onCreated: {
    addListener(callback: (item: chrome.downloads.DownloadItem) => void): void;
    removeListener(callback: (item: chrome.downloads.DownloadItem) => void): void;
  };
  onChanged: {
    addListener(callback: (delta: chrome.downloads.DownloadDelta) => void): void;
    removeListener(callback: (delta: chrome.downloads.DownloadDelta) => void): void;
  };
}

const MAX_DOWNLOAD_BUFFER = 200;

type DownloadEntrySeed = Omit<DownloadEntry, "sequence">;

function suggestedFileName(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || undefined;
}

function readBufferedDownloads(
  buffer: DownloadEntry[],
  currentSequence: number,
  since: number | undefined,
  limit: number,
): { entries: DownloadEntry[]; nextSince: number; truncated: boolean } {
  const hasCursor = typeof since === "number";
  const cursor = hasCursor ? since : 0;
  const candidates = buffer.filter((entry) => entry.sequence > cursor);
  const limited = hasCursor ? candidates.slice(0, limit) : candidates.slice(-limit);
  const oldestSequence = buffer[0]?.sequence ?? currentSequence + 1;
  const droppedEntries =
    currentSequence > buffer.length && (!hasCursor || cursor < oldestSequence - 1);
  return {
    entries: limited,
    nextSince: limited.at(-1)?.sequence ?? Math.max(cursor, currentSequence),
    truncated: droppedEntries || candidates.length > limited.length,
  };
}

/**
 * Tracks Chrome downloads with chrome.downloads events instead of tab-level
 * CDP Browser.setDownloadBehavior, which is not supported by chrome.debugger.
 */
export class ChromeDownloads {
  private readonly api: ChromeDownloadsApi;
  private readonly downloadBuffers = new Map<number, DownloadEntry[]>();
  private readonly downloadSequences = new Map<number, number>();
  private readonly downloadTabMap = new Map<number, number>();
  private readonly downloadPaths = new Map<number, string>();
  private createdSubscription: { dispose(): void } | null = null;
  private changedSubscription: { dispose(): void } | null = null;

  constructor(api: ChromeDownloadsApi = chrome.downloads) {
    this.api = api;
    this.bindHandlers();
  }

  /** Store the requested directory; path relocation is intentionally Phase 2. */
  configureDownloads(tabId: number, downloadPath: string): Promise<number> {
    this.downloadPaths.set(tabId, downloadPath);
    return Promise.resolve(this.downloadSequences.get(tabId) ?? 0);
  }

  /** Buffered download events with sequence greater than `since`. */
  downloadEntriesSince(tabId: number, since: number | undefined, limit: number): DownloadEventsResult {
    const buffer = this.downloadBuffers.get(tabId) ?? [];
    const currentSequence = this.downloadSequences.get(tabId) ?? 0;
    const { entries, nextSince, truncated } = readBufferedDownloads(
      buffer,
      currentSequence,
      since,
      limit,
    );
    return { tab_id: tabId, entries, next_since: nextSince, truncated };
  }

  clearDownloadState(tabId: number): void {
    this.downloadBuffers.delete(tabId);
    this.downloadSequences.delete(tabId);
    this.downloadPaths.delete(tabId);
    for (const [downloadId, mappedTabId] of this.downloadTabMap) {
      if (mappedTabId === tabId) this.downloadTabMap.delete(downloadId);
    }
  }

  clearAll(): void {
    this.downloadBuffers.clear();
    this.downloadSequences.clear();
    this.downloadTabMap.clear();
    this.downloadPaths.clear();
  }

  dispose(): void {
    this.createdSubscription?.dispose();
    this.createdSubscription = null;
    this.changedSubscription?.dispose();
    this.changedSubscription = null;
  }

  private bindHandlers(): void {
    const onCreated = (item: chrome.downloads.DownloadItem): void => {
      const tabId = item.tabId;
      if (typeof tabId !== "number") return;
      this.downloadTabMap.set(item.id, tabId);
      this.appendEntry(tabId, {
        kind: "will_begin",
        guid: String(item.id),
        url: item.url,
        suggested_filename: suggestedFileName(item.filename),
      });
    };
    const onChanged = (delta: chrome.downloads.DownloadDelta): void => {
      const tabId = this.downloadTabMap.get(delta.id);
      if (typeof tabId !== "number") return;
      this.appendEntry(tabId, {
        kind: "progress",
        guid: String(delta.id),
        state: delta.state?.current,
        received_bytes: delta.received?.current,
        total_bytes: delta.totalBytes?.current,
        file_path: delta.filename?.current,
      });
    };
    this.api.onCreated.addListener(onCreated);
    this.api.onChanged.addListener(onChanged);
    this.createdSubscription = {
      dispose: () => this.api.onCreated.removeListener(onCreated),
    };
    this.changedSubscription = {
      dispose: () => this.api.onChanged.removeListener(onChanged),
    };
  }

  private appendEntry(tabId: number, entry: DownloadEntrySeed): void {
    const sequence = (this.downloadSequences.get(tabId) ?? 0) + 1;
    this.downloadSequences.set(tabId, sequence);
    const buffer = this.downloadBuffers.get(tabId) ?? [];
    buffer.push({ ...entry, sequence });
    if (buffer.length > MAX_DOWNLOAD_BUFFER) buffer.shift();
    this.downloadBuffers.set(tabId, buffer);
  }
}
