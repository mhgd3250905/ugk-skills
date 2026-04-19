#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_ROUTE_CACHE_VERSION = 1;
export const DEFAULT_ROUTE_CACHE_PATH =
  process.env.NANOCLAW_WEB_ACCESS_ROUTE_CACHE ||
  '/workspace/group/.cache/web-access-route-cache.json';

function buildDefaultCache() {
  return {
    version: DEFAULT_ROUTE_CACHE_VERSION,
    entries: {},
  };
}

function normalizePathname(pathname) {
  if (!pathname || pathname === '/') {
    return '/';
  }

  const normalized = pathname.replace(/\/+$/, '');
  return normalized || '/';
}

function writeJsonAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

export function resolveRouteCachePath(options = {}) {
  return options.cachePath || DEFAULT_ROUTE_CACHE_PATH;
}

export function loadRouteCache(options = {}) {
  const cachePath = resolveRouteCachePath(options);

  if (!fs.existsSync(cachePath)) {
    return buildDefaultCache();
  }

  try {
    const raw = fs.readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return buildDefaultCache();
    }

    return {
      version:
        typeof parsed.version === 'number'
          ? parsed.version
          : DEFAULT_ROUTE_CACHE_VERSION,
      entries:
        parsed.entries && typeof parsed.entries === 'object'
          ? parsed.entries
          : {},
    };
  } catch {
    return buildDefaultCache();
  }
}

export function saveRouteCache(cache, options = {}) {
  const cachePath = resolveRouteCachePath(options);
  writeJsonAtomic(cachePath, {
    version:
      typeof cache?.version === 'number'
        ? cache.version
        : DEFAULT_ROUTE_CACHE_VERSION,
    entries:
      cache?.entries && typeof cache.entries === 'object' ? cache.entries : {},
  });
}

export function buildRouteCacheKey(input) {
  const parsedUrl = new URL(input.url);
  const host = parsedUrl.hostname.toLowerCase();
  const pathname = normalizePathname(parsedUrl.pathname);
  const taskKind = (input.taskKind || 'general').trim().toLowerCase();
  return `${host}|${pathname}|${taskKind}`;
}

function getOrCreateEntry(cache, key) {
  if (!cache.entries[key] || typeof cache.entries[key] !== 'object') {
    cache.entries[key] = {};
  }
  return cache.entries[key];
}

export function recordRouteSuccess(cache, key, stage) {
  const entry = getOrCreateEntry(cache, key);
  entry.lastSuccessfulStage = stage;
  entry.lastVerifiedAt = new Date().toISOString();
  return entry;
}

export function recordRouteFailure(cache, key, stage, failureReason) {
  const entry = getOrCreateEntry(cache, key);
  entry.lastFailedStage = stage;
  entry.failureReason = failureReason;
  entry.lastVerifiedAt = new Date().toISOString();
  return entry;
}
