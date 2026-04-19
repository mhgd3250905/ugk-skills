#!/usr/bin/env node

import { ensureHostBrowserBridge } from './host-bridge.mjs';

const DEFAULT_BODY_EXPRESSION = 'document.body ? document.body.innerText : ""';
const DEFAULT_TITLE_EXPRESSION = 'document.title';

function collapseWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function excerptText(value, maxLength = 280) {
  const normalized = collapseWhitespace(value);
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function stripHtml(value) {
  return collapseWhitespace(
    String(value || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&'),
  );
}

function extractTitleFromHtml(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? collapseWhitespace(match[1]) : '';
}

function detectFailureReason(text, title = '') {
  const normalized = `${title} ${text}`.toLowerCase();
  if (!normalized.trim()) return 'empty_result';

  const loginPatterns = [
    'sign in',
    'log in',
    'login',
    'please sign in',
    'please log in',
    '需要登录',
    '请登录',
  ];
  if (loginPatterns.some((pattern) => normalized.includes(pattern))) {
    return 'login_required';
  }

  const blockedPatterns = [
    'access denied',
    'forbidden',
    'captcha',
    'bot check',
    'verify you are human',
    '请求过于频繁',
    '访问受限',
  ];
  if (blockedPatterns.some((pattern) => normalized.includes(pattern))) {
    return 'blocked';
  }

  return null;
}

function buildFailure(stage, failureReason, extra = {}) {
  return {
    ok: false,
    stage,
    failureReason,
    ...extra,
  };
}

function buildSuccess(stage, extra = {}) {
  return {
    ok: true,
    stage,
    ...extra,
  };
}

function defaultFetchImpl(url, options) {
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(30000),
  });
}

function buildBrowserStageMeta(input, operation, note) {
  const meta = {
    stage: 'S3',
    url: input.url,
    taskKind: input.taskKind,
    operation,
    note,
    agentScope: resolveAgentScope(input),
  };

  return Object.values(meta).some((value) => typeof value === 'string')
    ? meta
    : undefined;
}

function appendProxyMeta(baseUrl, meta) {
  if (!meta) return baseUrl;

  const url = new URL(baseUrl);
  if (meta.stage) url.searchParams.set('metaStage', meta.stage);
  if (meta.url) url.searchParams.set('metaUrl', meta.url);
  if (meta.taskKind) url.searchParams.set('metaTaskKind', meta.taskKind);
  if (meta.operation) url.searchParams.set('metaOperation', meta.operation);
  if (meta.note) url.searchParams.set('metaNote', meta.note);
  if (meta.agentScope) url.searchParams.set('metaAgentScope', meta.agentScope);
  return url.toString();
}

function resolveAgentScope(input) {
  const explicit =
    typeof input?.agentScope === 'string' ? input.agentScope.trim() : '';
  if (explicit) return explicit;

  const env = input?.env || process.env;
  const candidates = [
    env.CLAUDE_AGENT_ID,
    env.CLAUDE_HOOK_AGENT_ID,
    env.agent_id,
  ];
  for (const value of candidates) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) return trimmed;
  }
  return undefined;
}

function describeExpression(expression) {
  if (expression === DEFAULT_TITLE_EXPRESSION) {
    return 'title_expression';
  }
  if (expression === DEFAULT_BODY_EXPRESSION) {
    return 'body_text_expression';
  }
  return excerptText(expression, 80);
}

function createDefaultProxyClient(input, fetchImpl = defaultFetchImpl) {
  return {
    async getSessionTarget() {
      const response = await fetchImpl(
        appendProxyMeta(
          'http://127.0.0.1:3456/session/target',
          buildBrowserStageMeta(input, 'get_default_target', 'reuse_target'),
        ),
      );
      const payload = await response.json();
      return payload?.targetId || undefined;
    },
    async setSessionTarget(targetId) {
      await fetchImpl(
        appendProxyMeta(
          `http://127.0.0.1:3456/session/target?target=${encodeURIComponent(targetId)}`,
          buildBrowserStageMeta(input, 'set_default_target', 'remember_target'),
        ),
        {
          method: 'POST',
        },
      );
    },
    async clearSessionTarget() {
      await fetchImpl(
        appendProxyMeta(
          'http://127.0.0.1:3456/session/target',
          buildBrowserStageMeta(input, 'clear_default_target', 'forget_target'),
        ),
        {
          method: 'DELETE',
        },
      );
    },
    async createTarget(url) {
      const response = await fetchImpl(
        appendProxyMeta(
          `http://127.0.0.1:3456/new?url=${encodeURIComponent(url)}`,
          buildBrowserStageMeta(input, 'create_target', 'open_page'),
        ),
      );
      const payload = await response.json();
      return payload;
    },
    async getInfo(targetId) {
      const response = await fetchImpl(
        appendProxyMeta(
          `http://127.0.0.1:3456/info?target=${encodeURIComponent(targetId)}`,
          buildBrowserStageMeta(input, 'get_target_info', 'inspect_page'),
        ),
      );
      return response.json();
    },
    async eval(targetId, expression) {
      const response = await fetchImpl(
        appendProxyMeta(
          `http://127.0.0.1:3456/eval?target=${encodeURIComponent(targetId)}`,
          buildBrowserStageMeta(
            input,
            'evaluate',
            describeExpression(expression),
          ),
        ),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
          },
          body: expression,
        },
      );
      return response.json();
    },
    async closeTarget(targetId) {
      await fetchImpl(
        appendProxyMeta(
          `http://127.0.0.1:3456/close?target=${encodeURIComponent(targetId)}`,
          buildBrowserStageMeta(input, 'close_target', 'cleanup'),
        ),
      );
    },
  };
}

export function buildJinaReaderUrl(url) {
  return `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, '')}`;
}

async function runStaticFetchStage(stage, input) {
  const fetchImpl = input.fetchImpl || defaultFetchImpl;
  const targetUrl = stage === 'S2' ? buildJinaReaderUrl(input.url) : input.url;
  const response = await fetchImpl(targetUrl, {
    headers: {
      'User-Agent': 'NanoClaw-WebAccess/1.0',
    },
  });

  if (!response.ok) {
    return buildFailure(stage, `http_${response.status}`);
  }

  const contentType = response.headers?.get?.('content-type') || '';
  const rawBody = await response.text();
  const title = contentType.includes('text/html')
    ? extractTitleFromHtml(rawBody)
    : '';
  const text = contentType.includes('text/html')
    ? stripHtml(rawBody)
    : collapseWhitespace(rawBody);
  const failureReason = detectFailureReason(text, title);

  if (failureReason) {
    return buildFailure(stage, failureReason, {
      title,
      excerpt: excerptText(text),
    });
  }

  if (!text) {
    return buildFailure(stage, 'empty_result');
  }

  return buildSuccess(stage, {
    url: input.url,
    title,
    excerpt: excerptText(text),
    contentType,
  });
}

async function runBrowserStage(input) {
  const ensureBridge = input.ensureBridge || ensureHostBrowserBridge;
  const proxyClient =
    input.proxyClient || createDefaultProxyClient(input, input.fetchImpl);

  await ensureBridge();

  const agentScope = resolveAgentScope(input);
  let targetId =
    agentScope && typeof proxyClient.getSessionTarget === 'function'
      ? await proxyClient.getSessionTarget()
      : undefined;
  let createdTarget = false;

  if (!targetId) {
    const created = await proxyClient.createTarget(input.url);
    targetId = created?.targetId || created?.target?.id;
    createdTarget = true;
    if (!targetId) {
      return buildFailure('S3', 'target_create_failed');
    }
    if (agentScope && typeof proxyClient.setSessionTarget === 'function') {
      await proxyClient.setSessionTarget(targetId);
    }
  }

  try {
    const info = await proxyClient.getInfo(targetId);
    const titleValue = await proxyClient.eval(targetId, DEFAULT_TITLE_EXPRESSION);
    const bodyValue = await proxyClient.eval(targetId, DEFAULT_BODY_EXPRESSION);
    const title = collapseWhitespace(titleValue || info?.title || '');
    const text = collapseWhitespace(bodyValue);
    const failureReason = detectFailureReason(text, title);

    if (failureReason) {
      return buildFailure('S3', failureReason, {
        url: info?.url || input.url,
        title,
        excerpt: excerptText(text),
      });
    }

    if (!text) {
      return buildFailure('S3', 'empty_result', {
        url: info?.url || input.url,
        title,
      });
    }

    return buildSuccess('S3', {
      url: info?.url || input.url,
      title,
      excerpt: excerptText(text),
    });
  } finally {
    if (!agentScope) {
      await proxyClient.closeTarget(targetId);
    }
  }
}

export async function runUrlStage(stage, input) {
  if (stage === 'S1' || stage === 'S2') {
    return runStaticFetchStage(stage, input);
  }

  if (stage === 'S3') {
    return runBrowserStage(input);
  }

  return buildFailure(stage, 'unsupported_stage');
}
