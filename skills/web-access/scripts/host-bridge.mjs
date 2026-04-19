#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

import { getDefaultLocalBrowser } from './local-cdp-browser.mjs';

export function resolveDefaultIpcDir(options = {}) {
  const env = options.env || process.env;
  const existsSync = options.existsSync || fs.existsSync;
  const cwd = options.cwd || process.cwd();

  if (env.NANOCLAW_BROWSER_BRIDGE_DIR) {
    return env.NANOCLAW_BROWSER_BRIDGE_DIR;
  }

  if (existsSync('/app')) {
    return '/app/.data/browser-ipc';
  }

  return path.join(cwd, '.data', 'browser-ipc');
}

const DEFAULT_IPC_DIR = resolveDefaultIpcDir();
const DEFAULT_IPC_TIMEOUT_MS = 1000;
const HOST_BRIDGE_READY_IPC_TIMEOUT_MS = 30000;
const DIRECT_LOCAL_BROWSER_PROVIDERS = new Set(['direct_cdp', 'direct', 'sidecar']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filePath);
}

function trimMetaValue(value, maxLength = 200) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return undefined;
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 3)}...`;
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') {
    return undefined;
  }

  const sanitized = {
    stage: trimMetaValue(meta.stage, 32),
    url: trimMetaValue(meta.url, 240),
    taskKind: trimMetaValue(meta.taskKind, 80),
    query: trimMetaValue(meta.query, 200),
    operation: trimMetaValue(meta.operation, 80),
    note: trimMetaValue(meta.note, 160),
    agentScope: trimMetaValue(meta.agentScope, 120),
  };

  return Object.values(sanitized).some((value) => typeof value === 'string')
    ? sanitized
    : undefined;
}

function shouldUseLocalFallbackForPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const status = payload.status;
  if (
    status &&
    typeof status === 'object' &&
    status.enabled !== false &&
    status.connected === false
  ) {
    return true;
  }

  const error = typeof payload.error === 'string' ? payload.error : '';
  return (
    error === 'chrome_cdp_unreachable' ||
    error === 'cdp_ws_connect_failed' ||
    error === 'cdp_ws_connect_timeout' ||
    error === 'local_cdp_start_timeout' ||
    error.startsWith('cdp_http_') ||
    error.startsWith('cdp_command_timeout:')
  );
}

async function runLocalFallback(command, options) {
  const localBrowser = options.localBrowser || getDefaultLocalBrowser();
  return await localBrowser.handleCommand(command, {
    meta: sanitizeMeta(options.meta),
  });
}

function hasHostBridgeReadyFile(ipcDir) {
  return fs.existsSync(path.join(ipcDir, 'host-bridge-ready.json'));
}

function shouldPreferDirectLocalBrowser(options = {}) {
  const env = options.env || process.env;
  const provider = String(env.WEB_ACCESS_BROWSER_PROVIDER || '').trim().toLowerCase();
  return DIRECT_LOCAL_BROWSER_PROVIDERS.has(provider);
}

export function resolveIpcTimeoutMs(options = {}, ipcDir = DEFAULT_IPC_DIR) {
  if (options.ipcTimeoutMs || options.timeoutMs) {
    return options.ipcTimeoutMs || options.timeoutMs;
  }

  return hasHostBridgeReadyFile(ipcDir)
    ? HOST_BRIDGE_READY_IPC_TIMEOUT_MS
    : DEFAULT_IPC_TIMEOUT_MS;
}

export async function requestHostBrowser(command, options = {}) {
  const canUseLocalFallback =
    options.localBrowser !== null && options.disableLocalFallback !== true;
  if (canUseLocalFallback && shouldPreferDirectLocalBrowser(options)) {
    return await runLocalFallback(command, options);
  }

  const ipcDir = options.ipcDir || DEFAULT_IPC_DIR;
  const timeoutMs = resolveIpcTimeoutMs(options, ipcDir);
  const requestsDir = path.join(ipcDir, 'browser-requests');
  const responsesDir = path.join(ipcDir, 'browser-responses');
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const requestPath = path.join(requestsDir, `${requestId}.json`);
  const responsePath = path.join(responsesDir, `${requestId}.json`);

  try {
    writeJsonAtomic(requestPath, {
      requestId,
      command,
      meta: sanitizeMeta(options.meta),
    });
  } catch (error) {
    if (canUseLocalFallback) {
      return await runLocalFallback(command, options);
    }
    throw error;
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(responsePath)) {
      const payload = JSON.parse(fs.readFileSync(responsePath, 'utf-8'));
      fs.rmSync(responsePath, { force: true });
      if (canUseLocalFallback && shouldUseLocalFallbackForPayload(payload)) {
        return await runLocalFallback(command, options);
      }
      return payload;
    }
    await sleep(150);
  }

  if (canUseLocalFallback) {
    return await runLocalFallback(command, options);
  }

  throw new Error(`host_browser_timeout:${command.action}`);
}

export async function ensureHostBrowserBridge(options = {}) {
  const result = await requestHostBrowser({ action: 'status' }, {
    ...options,
    timeoutMs: options.timeoutMs,
    ipcTimeoutMs: options.ipcTimeoutMs,
  });

  if (!result.ok) {
    throw new Error(result.error || 'host_browser_status_failed');
  }

  if (!result.status?.enabled) {
    throw new Error('bridge_disabled');
  }

  if (!result.status?.connected) {
    throw new Error(result.status?.error || 'chrome_cdp_unreachable');
  }

  return result.status;
}
