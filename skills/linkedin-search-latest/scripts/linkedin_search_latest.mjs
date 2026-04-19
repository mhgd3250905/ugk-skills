#!/usr/bin/env node

import fs from 'node:fs';
import process from 'node:process';

import {
  buildLinkedInSearchUrl,
  formatLinkedInSearchResult,
  selectRecentRelevantPosts,
} from './linkedin_search_latest_lib.mjs';
import {
  ensureHostBrowserBridge,
  requestHostBrowser,
} from '../../web-access/scripts/host-bridge.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = {
    keyword: '',
    days: 30,
    maxScrolls: 3,
    maxResults: 12,
    dryRun: false,
    debugDump: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--keyword') {
      args.keyword = String(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--days') {
      args.days = Number(argv[index + 1] || '30');
      index += 1;
      continue;
    }
    if (token === '--max-scrolls') {
      args.maxScrolls = Number(argv[index + 1] || '3');
      index += 1;
      continue;
    }
    if (token === '--max-results') {
      args.maxResults = Number(argv[index + 1] || '12');
      index += 1;
      continue;
    }
    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (token === '--debug-dump') {
      args.debugDump = String(argv[index + 1] || '');
      index += 1;
    }
  }

  if (!args.keyword.trim()) {
    throw new Error('关键词不能为空');
  }
  if (!Number.isInteger(args.days) || args.days <= 0) {
    throw new Error('days 必须是正整数');
  }
  if (!Number.isInteger(args.maxScrolls) || args.maxScrolls <= 0) {
    throw new Error('max-scrolls 必须是正整数');
  }
  if (!Number.isInteger(args.maxResults) || args.maxResults <= 0) {
    throw new Error('max-results 必须是正整数');
  }

  return args;
}

function resolveAgentScope() {
  const candidates = [
    process.env.CLAUDE_AGENT_ID,
    process.env.CLAUDE_HOOK_AGENT_ID,
    process.env.agent_id,
  ];
  for (const value of candidates) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) return trimmed;
  }
  return '';
}

async function browserCommand(command, meta) {
  const result = await requestHostBrowser(command, {
    timeoutMs: 45000,
    meta,
  });
  if (!result?.ok) {
    throw new Error(result?.error || `browser_command_failed:${command.action}`);
  }
  return result;
}

async function createTarget(url, meta) {
  const result = await browserCommand({ action: 'new_target', url }, meta);
  const targetId = result?.target?.id;
  if (!targetId) {
    throw new Error('browser_target_missing');
  }
  return targetId;
}

async function evaluate(targetId, expression, meta) {
  const result = await browserCommand(
    { action: 'evaluate', targetId, expression },
    meta,
  );
  return result?.value;
}

async function scrollToBottom(targetId, meta) {
  await browserCommand({ action: 'scroll', targetId, direction: 'bottom' }, meta);
}

async function closeTarget(targetId, meta) {
  await browserCommand({ action: 'close_target', targetId }, meta);
}

function toExpression(factory, ...args) {
  return `(${factory.toString()})(${args
    .map((arg) => JSON.stringify(arg))
    .join(',')})`;
}

function collectVisiblePosts(limit) {
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const toAbsoluteUrl = (value) => {
    try {
      return new URL(String(value || ''), location.origin).toString();
    } catch {
      return '';
    }
  };
  const isSearchUrl = (value) =>
    value.includes('/search/results/') ||
    value.includes('/search/results/all/') ||
    value.includes('/search/results/content/');
  const findRelativeTimeLabel = (text) => {
    const patterns = [
      /\d+\s*(?:分钟|分|mins?|minutes?)(?!\S)/i,
      /\d+\s*(?:小时|hrs?|hours?)(?!\S)/i,
      /\d+\s*(?:天|days?)(?!\S)/i,
      /\d+\s*(?:周|weeks?|w)(?!\S)/i,
      /\d+\s*(?:个月|月|months?|mos?)(?!\S)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return normalize(match[0]);
    }
    return '';
  };
  const normalizeAuthorText = (text) => {
    const compact = normalize(text);
    if (!compact) return '';
    return compact
      .split(/\d+\s*(?:分钟|分|mins?|minutes?|小时|hrs?|hours?|天|days?|周|weeks?|w|个月|月|months?|mos?)/i)[0]
      .split('•')[0]
      .trim();
  };
  const cleanCardText = (text) =>
    normalize(text)
      .replace(/^信息流动态\s*/u, '')
      .replace(/\s*赞 评论 转发 发送$/u, '')
      .trim();
  const pickContainer = (anchor) => {
    let node = anchor;
    let fallback = anchor.parentElement || anchor;
    for (let depth = 0; depth < 8 && node; depth += 1) {
      const text = normalize(node.innerText || node.textContent || '');
      if (text.length >= 40) fallback = node;
      if (
        text.length >= 160 &&
        text.length <= 2200 &&
        (text.includes('信息流动态') || text.includes('赞 评论 转发 发送'))
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return fallback;
  };
  const rows = [];
  const seen = new Set();

  if (location.pathname.includes('/login')) {
    return {
      loginRequired: true,
      rows: [],
      snapshot: {
        title: document.title || '',
        location: location.href,
        bodyExcerpt: normalize(document.body?.innerText || '').slice(0, 500),
        anchorCount: document.querySelectorAll('a[href]').length,
        feedLinkCount: 0,
      },
    };
  }

  for (const anchor of document.querySelectorAll('a[href]')) {
    const href = normalize(anchor.getAttribute('href') || '');
    const isAuthorLink = href.includes('/in/') || href.includes('/company/');
    if (!isAuthorLink) continue;
    const anchorText = normalize(anchor.innerText || anchor.textContent || '');
    const anchorTimeLabel = findRelativeTimeLabel(anchorText);
    const likelyPrimaryAuthorLink =
      Boolean(anchorTimeLabel) || href.includes('/posts/');
    if (!likelyPrimaryAuthorLink) continue;

    const url = toAbsoluteUrl(href);
    if (!url) continue;
    const container = pickContainer(anchor);
    const text = cleanCardText(container?.innerText || container?.textContent || '');
    if (!text) continue;
    if (text.length < 80) continue;

    const linkCandidates = Array.from(container.querySelectorAll('a[href]'));
    const authorLink =
      linkCandidates.find((node) => {
        const candidate = String(node.getAttribute('href') || '').trim();
        return candidate.includes('/in/') || candidate.includes('/company/');
      }) || anchor;
    const authorHandle = normalize(authorLink?.getAttribute('href') || href);
    const authorName = normalizeAuthorText(authorLink?.innerText || anchor?.innerText || '');
    const postedAtLabel = findRelativeTimeLabel(text);
    if (!postedAtLabel) continue;

    const sourceLink =
      linkCandidates.find((node) => {
        const candidate = toAbsoluteUrl(node.getAttribute('href') || '');
        if (!candidate) return false;
        if (candidate.includes('/in/') || candidate.includes('/company/')) return false;
        if (isSearchUrl(candidate)) return false;
        return true;
      }) || null;

    const resultUrl = sourceLink
      ? toAbsoluteUrl(sourceLink.getAttribute('href') || '')
      : url;
    const dedupeKey = `${authorHandle}|${postedAtLabel}|${resultUrl}`;
    if (seen.has(dedupeKey)) continue;

    seen.add(dedupeKey);

    rows.push({
      postedAt: '',
      postedAtLabel,
      url: resultUrl,
      content: text,
      authorHandle,
      authorName,
    });

    if (rows.length >= limit) break;
  }

  return {
    loginRequired: false,
    rows,
    snapshot: {
      title: document.title || '',
      location: location.href,
      bodyExcerpt: normalize(document.body?.innerText || '').slice(0, 800),
      anchorCount: document.querySelectorAll('a[href]').length,
      feedLinkCount: rows.length,
    },
  };
}

async function collectPosts(targetId, maxScrolls, meta) {
  const rows = [];
  const seen = new Set();
  let loginRequired = false;
  const snapshots = [];

  for (let step = 0; step <= maxScrolls; step += 1) {
    await sleep(step === 0 ? 3500 : 2200);
    const payload =
      (await evaluate(targetId, toExpression(collectVisiblePosts, 18), meta)) || {
        loginRequired: false,
        rows: [],
      };

    if (payload.loginRequired) {
      loginRequired = true;
      snapshots.push({
        step,
        ...(payload.snapshot || {}),
      });
      break;
    }

    snapshots.push({
      step,
      ...(payload.snapshot || {}),
    });

    for (const row of payload.rows || []) {
      const url = String(row?.url || '').trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      rows.push(row);
    }

    if (step < maxScrolls) {
      await scrollToBottom(targetId, meta);
    }
  }

  return { rows, loginRequired, snapshots };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const finalUrl = buildLinkedInSearchUrl(args.keyword);

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          keyword: args.keyword,
          days: args.days,
          url: finalUrl,
          maxScrolls: args.maxScrolls,
          maxResults: args.maxResults,
        },
        null,
        2,
      ),
    );
    return;
  }

  await ensureHostBrowserBridge();

  const agentScope = resolveAgentScope();
  let targetId = null;
  try {
    targetId = await createTarget(finalUrl, {
      stage: 'search-open',
      url: finalUrl,
      query: args.keyword,
      taskKind: 'linkedin-search-latest',
      agentScope,
    });

    const { rows, loginRequired, snapshots } = await collectPosts(targetId, args.maxScrolls, {
      stage: 'search-fetch',
      url: finalUrl,
      query: args.keyword,
      taskKind: 'linkedin-search-latest',
      agentScope,
    });

    if (args.debugDump) {
      fs.writeFileSync(
        args.debugDump,
        JSON.stringify(
          {
            keyword: args.keyword,
            days: args.days,
            finalUrl,
            candidateCount: rows.length,
            rows,
            snapshots,
          },
          null,
          2,
        ),
        'utf8',
      );
    }

    if (loginRequired) {
      console.log(
        formatLinkedInSearchResult({
          keyword: args.keyword,
          days: args.days,
          finalUrl,
          note: '当前会话下 LinkedIn 搜索不可用：页面要求登录或结果不可见。',
          debug: {
            candidateCount: rows.length,
          },
          items: [],
        }),
      );
      return;
    }

    const selected = selectRecentRelevantPosts(rows, {
      keyword: args.keyword,
      days: args.days,
    }).slice(0, args.maxResults);

    console.log(
      formatLinkedInSearchResult({
        keyword: args.keyword,
        days: args.days,
        finalUrl,
        note:
          selected.length > 0
            ? `共命中 ${selected.length} 条最近 ${args.days} 天内的可见结果`
            : '未检索到满足条件的结果。',
        debug: {
          candidateCount: rows.length,
        },
        items: selected,
      }),
    );
  } finally {
    if (targetId) {
      try {
        await closeTarget(targetId, {
          stage: 'search-close',
          url: finalUrl,
          query: args.keyword,
          taskKind: 'linkedin-search-latest',
          agentScope,
        });
      } catch (error) {
        console.error(
          `close_target_failed:${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});