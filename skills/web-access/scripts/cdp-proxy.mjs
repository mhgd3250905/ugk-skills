#!/usr/bin/env node

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { URL, pathToFileURL } from 'node:url';

import { requestHostBrowser } from './host-bridge.mjs';

const PORT = Number(process.env.CDP_PROXY_PORT || 3456);

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload, null, 2));
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }
  return body;
}

function requireTargetId(targetId) {
  if (!targetId) {
    throw new Error('missing_target');
  }
  return targetId;
}

function trimMetaValue(value, maxLength = 200) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return undefined;
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 3)}...`;
}

function readMetaValue(parsed, req, queryKey, headerName, maxLength) {
  const queryValue = parsed.searchParams.get(queryKey);
  const headerValue = req.headers[headerName];
  const value =
    typeof queryValue === 'string' && queryValue.length > 0
      ? queryValue
      : typeof headerValue === 'string'
        ? headerValue
        : Array.isArray(headerValue)
          ? headerValue[0]
          : undefined;
  return trimMetaValue(value, maxLength);
}

const PROXY_QUERY_KEYS = new Set([
  'url',
  'target',
  'metaStage',
  'metaUrl',
  'metaTaskKind',
  'metaQuery',
  'metaOperation',
  'metaNote',
  'metaAgentScope',
]);

function appendQueryEntries(url, entries) {
  if (!url || entries.length === 0) return url;

  const hashIndex = url.indexOf('#');
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  const suffix = new URLSearchParams(entries).toString();
  if (!suffix) return url;

  const joiner = base.includes('?') ? '&' : '?';
  return `${base}${joiner}${suffix}${hash}`;
}

export function readNestedUrlParam(parsed, queryKey = 'url') {
  const primaryValue = parsed.searchParams.get(queryKey) || undefined;
  if (!primaryValue) return undefined;

  const nestedEntries = [];
  for (const [key, value] of parsed.searchParams.entries()) {
    if (key === queryKey) continue;
    if (PROXY_QUERY_KEYS.has(key)) continue;
    nestedEntries.push([key, value]);
  }

  return appendQueryEntries(primaryValue, nestedEntries);
}

function buildRequestMeta(parsed, req, defaults = {}) {
  const meta = {
    stage: readMetaValue(parsed, req, 'metaStage', 'x-nanoclaw-stage', 32),
    url:
      readMetaValue(parsed, req, 'metaUrl', 'x-nanoclaw-url', 240) ||
      defaults.url,
    taskKind: readMetaValue(
      parsed,
      req,
      'metaTaskKind',
      'x-nanoclaw-task-kind',
      80,
    ),
    query: readMetaValue(parsed, req, 'metaQuery', 'x-nanoclaw-query', 200),
    operation:
      readMetaValue(
        parsed,
        req,
        'metaOperation',
        'x-nanoclaw-operation',
        80,
      ) || defaults.operation,
    note: readMetaValue(parsed, req, 'metaNote', 'x-nanoclaw-note', 160),
    agentScope: readMetaValue(
      parsed,
      req,
      'metaAgentScope',
      'x-nanoclaw-agent-scope',
      120,
    ),
  };

  return Object.values(meta).some((value) => typeof value === 'string')
    ? meta
    : undefined;
}

function readTargetParam(parsed, req) {
  const queryValue = parsed.searchParams.get('target');
  if (queryValue) return queryValue;

  const headerValue = req.headers['x-nanoclaw-target-id'];
  if (typeof headerValue === 'string' && headerValue.trim()) {
    return headerValue.trim();
  }
  if (Array.isArray(headerValue) && headerValue[0]?.trim()) {
    return headerValue[0].trim();
  }

  return undefined;
}

function isDirectExecution() {
  return (
    Boolean(process.argv[1]) &&
    import.meta.url === pathToFileURL(process.argv[1]).href
  );
}

export function createProxyServer() {
  return http.createServer(async (req, res) => {
    const parsed = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
    const pathname = parsed.pathname;
    const targetId = parsed.searchParams.get('target') || '';

    try {
      if (pathname === '/health') {
        sendJson(res, 200, { status: 'ok', port: PORT });
        return;
      }

      if (pathname === '/session/target' && req.method === 'GET') {
        const result = await requestHostBrowser(
          { action: 'get_default_target' },
          {
            meta: buildRequestMeta(parsed, req, {
              operation: 'get_default_target',
            }),
          },
        );
        sendJson(res, result.ok ? 200 : 500, result);
        return;
      }

      if (pathname === '/session/target' && req.method === 'POST') {
        const result = await requestHostBrowser(
          {
            action: 'set_default_target',
            targetId: requireTargetId(readTargetParam(parsed, req)),
          },
          {
            meta: buildRequestMeta(parsed, req, {
              operation: 'set_default_target',
            }),
          },
        );
        sendJson(res, result.ok ? 200 : 500, result);
        return;
      }

      if (pathname === '/session/target' && req.method === 'DELETE') {
        const result = await requestHostBrowser(
          { action: 'clear_default_target' },
          {
            meta: buildRequestMeta(parsed, req, {
              operation: 'clear_default_target',
            }),
          },
        );
        sendJson(res, result.ok ? 200 : 500, result);
        return;
      }

      if (pathname === '/session/close-all' && req.method === 'POST') {
        const result = await requestHostBrowser(
          { action: 'close_scope_targets' },
          {
            meta: buildRequestMeta(parsed, req, {
              operation: 'close_scope_targets',
            }),
          },
        );
        sendJson(res, result.ok ? 200 : 500, result);
        return;
      }

    if (pathname === '/targets') {
      const result = await requestHostBrowser(
        { action: 'list_targets' },
        {
          meta: buildRequestMeta(parsed, req, {
            operation: 'list_targets',
          }),
        },
      );
      sendJson(res, result.ok ? 200 : 500, result.ok ? result.targets || [] : result);
      return;
    }

    if (pathname === '/new') {
      const url = readNestedUrlParam(parsed, 'url');
      const result = await requestHostBrowser(
        {
          action: 'new_target',
          url,
        },
        {
          meta: buildRequestMeta(parsed, req, {
            operation: 'create_target',
            url,
          }),
        },
      );
      sendJson(
        res,
        result.ok ? 200 : 500,
        result.ok ? { targetId: result.target?.id, target: result.target } : result,
      );
      return;
    }

    if (pathname === '/close') {
      const result = await requestHostBrowser(
        {
          action: 'close_target',
          targetId: requireTargetId(targetId),
        },
        {
          meta: buildRequestMeta(parsed, req, {
            operation: 'close_target',
          }),
        },
      );
      sendJson(res, result.ok ? 200 : 500, result);
      return;
    }

    if (pathname === '/info') {
      const result = await requestHostBrowser(
        {
          action: 'get_target_info',
          targetId: requireTargetId(targetId),
        },
        {
          meta: buildRequestMeta(parsed, req, {
            operation: 'get_target_info',
          }),
        },
      );
      sendJson(res, result.ok ? 200 : 500, result.ok ? result.page || result.target : result);
      return;
    }

    if (pathname === '/navigate') {
      const url = readNestedUrlParam(parsed, 'url') || '';
      const result = await requestHostBrowser(
        {
          action: 'navigate',
          targetId: requireTargetId(targetId),
          url,
        },
        {
          meta: buildRequestMeta(parsed, req, {
            operation: 'navigate',
            url,
          }),
        },
      );
      sendJson(res, result.ok ? 200 : 500, result.ok ? result.page || result : result);
      return;
    }

    if (pathname === '/back') {
      const result = await requestHostBrowser(
        {
          action: 'back',
          targetId: requireTargetId(targetId),
        },
        {
          meta: buildRequestMeta(parsed, req, {
            operation: 'back',
          }),
        },
      );
      sendJson(res, result.ok ? 200 : 500, result.ok ? result.page || result : result);
      return;
    }

    if (pathname === '/eval') {
      const expression = await readBody(req);
      const result = await requestHostBrowser(
        {
          action: 'evaluate',
          targetId: requireTargetId(targetId),
          expression,
        },
        {
          meta: buildRequestMeta(parsed, req, {
            operation: 'evaluate',
          }),
        },
      );
      sendJson(res, result.ok ? 200 : 500, result.ok ? result.value : result);
      return;
    }

    if (pathname === '/click' || pathname === '/clickAt') {
      const selector = (await readBody(req)).trim();
      const action = pathname === '/clickAt' ? 'click_at' : 'click';
      const result = await requestHostBrowser(
        {
          action,
          targetId: requireTargetId(targetId),
          selector,
        },
        {
          meta: buildRequestMeta(parsed, req, {
            operation: action,
          }),
        },
      );
      sendJson(res, result.ok ? 200 : 500, result.ok ? { ok: Boolean(result.value) } : result);
      return;
    }

    if (pathname === '/scroll') {
      const y = parsed.searchParams.get('y');
      const direction = parsed.searchParams.get('direction');
      const result = await requestHostBrowser(
        {
          action: 'scroll',
          targetId: requireTargetId(targetId),
          y: y ? Number(y) : undefined,
          direction: direction === 'top' || direction === 'bottom' ? direction : undefined,
        },
        {
          meta: buildRequestMeta(parsed, req, {
            operation: 'scroll',
          }),
        },
      );
      sendJson(res, result.ok ? 200 : 500, result.ok ? { ok: Boolean(result.value) } : result);
      return;
    }

    if (pathname === '/screenshot') {
      const result = await requestHostBrowser(
        {
          action: 'screenshot',
          targetId: requireTargetId(targetId),
        },
        {
          meta: buildRequestMeta(parsed, req, {
            operation: 'screenshot',
          }),
        },
      );

      if (!result.ok || !result.screenshotBase64) {
        sendJson(res, 500, result);
        return;
      }

      const filePath = parsed.searchParams.get('file');
      if (filePath) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, Buffer.from(result.screenshotBase64, 'base64'));
        sendJson(res, 200, { ok: true, file: filePath });
        return;
      }

      sendJson(res, 200, { data: result.screenshotBase64 });
      return;
    }

    if (pathname === '/download') {
      const downloadPath = parsed.searchParams.get('file');
      const downloadDir = parsed.searchParams.get('dir') || '/workspace/group/downloads';
      const selector =
        req.method === 'POST'
          ? (await readBody(req)).trim()
          : (parsed.searchParams.get('selector') || '').trim();
      const timeoutMs = parsed.searchParams.get('timeoutMs');
      const result = await requestHostBrowser(
        {
          action: 'download',
          targetId: requireTargetId(targetId),
          selector: selector || undefined,
          downloadPath: downloadPath || undefined,
          downloadDir: downloadPath ? undefined : downloadDir,
          timeoutMs: timeoutMs ? Number(timeoutMs) : undefined,
        },
        {
          meta: buildRequestMeta(parsed, req, {
            operation: 'download',
          }),
        },
      );

      if (!result.ok || !result.downloadedFilePath) {
        sendJson(res, 500, result);
        return;
      }

      sendJson(res, 200, { ok: true, file: result.downloadedFilePath });
      return;
    }

      sendJson(res, 404, { ok: false, error: 'not_found' });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : 'proxy_failed',
      });
    }
  });
}

const server = createProxyServer();

if (isDirectExecution()) {
  server.listen(PORT, '127.0.0.1', () => {
    process.stdout.write(`[web-access] proxy listening on 127.0.0.1:${PORT}\n`);
  });
}
