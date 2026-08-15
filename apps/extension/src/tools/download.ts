import { ChromiumCdp } from "@/browser-driver/chromium-cdp";
import type { SessionManager } from "@/session-manager/manager";
import type {
  DownloadConfigParams,
  DownloadConfigResult,
  DownloadEventsParams,
  DownloadEventsResult,
  RpcError,
} from "@/transport/types";
import {
  type ChromeTabsApi,
  chromeTabsApi,
  isRpcError,
  lookupSession,
  resolveTargetTab,
} from "./shared";

export interface DownloadCdpRunner {
  trackSessionTab?(sessionId: string, tabId: number): void;
  configureDownloads(tabId: number, path: string): Promise<number>;
  downloadEntriesSince(tabId: number, since: number | undefined, limit: number): DownloadEventsResult;
}

interface DownloadDeps { cdp: DownloadCdpRunner; tabsApi: ChromeTabsApi; }
function defaultDeps(): DownloadDeps { return { cdp: new ChromiumCdp(), tabsApi: chromeTabsApi }; }

export async function handleDownloadConfig(
  manager: SessionManager,
  params: DownloadConfigParams,
  deps: DownloadDeps = defaultDeps(),
  signal?: AbortSignal,
): Promise<DownloadConfigResult | RpcError> {
  if (signal?.aborted) return { code: "cancelled", message: "download config aborted" };
  const ctxOrErr = lookupSession(manager, params, "download config");
  if (isRpcError(ctxOrErr)) return ctxOrErr;
  const path = params.download_path?.trim();
  if (!path) return { code: "invalid_params", message: "download_path must not be empty" };
  const target = await resolveTargetTab(manager, ctxOrErr, params.tab_id, deps.tabsApi);
  if (isRpcError(target)) return target;
  try {
    deps.cdp.trackSessionTab?.(ctxOrErr.sessionId, target.tabId);
    const cursor = await deps.cdp.configureDownloads(target.tabId, path);
    return { tab_id: target.tabId, next_since: cursor };
  } catch (err) {
    return { code: "cdp_failed", message: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleDownloadEvents(
  manager: SessionManager,
  params: DownloadEventsParams,
  deps: DownloadDeps = defaultDeps(),
  signal?: AbortSignal,
): Promise<DownloadEventsResult | RpcError> {
  if (signal?.aborted) return { code: "cancelled", message: "download events aborted" };
  const ctxOrErr = lookupSession(manager, params, "download events");
  if (isRpcError(ctxOrErr)) return ctxOrErr;
  const target = await resolveTargetTab(manager, ctxOrErr, params.tab_id, deps.tabsApi);
  if (isRpcError(target)) return target;
  const limit = params.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return { code: "invalid_params", message: "limit must be between 1 and 200" };
  }
  try {
    deps.cdp.trackSessionTab?.(ctxOrErr.sessionId, target.tabId);
    return deps.cdp.downloadEntriesSince(target.tabId, params.since, limit);
  } catch (err) {
    return { code: "cdp_failed", message: err instanceof Error ? err.message : String(err) };
  }
}
