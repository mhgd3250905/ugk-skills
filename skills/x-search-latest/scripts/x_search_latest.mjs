#!/usr/bin/env node

import process from 'node:process';

import {
  buildXSearchUrl,
  formatXSearchResult,
  selectRecentRelevantTweets,
} from './x_search_latest_lib.mjs';
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

function collectVisibleTweets(limit) {
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const rows = [];
  const seen = new Set();

  for (const article of document.querySelectorAll('article')) {
    const timeEl = article.querySelector('time');
    const postedAt = normalize(timeEl?.getAttribute('datetime') || '');
    if (!postedAt) continue;

    const linkEl = article.querySelector('a[href*="/status/"]');
    const href = normalize(linkEl?.getAttribute('href') || '');
    if (!href) continue;

    let url = '';
    try {
      url = new URL(href, location.origin).toString();
    } catch {
      continue;
    }
    if (!/\/status\/\d+/.test(url) || seen.has(url)) continue;
    seen.add(url);

    const tweetTextNodes = Array.from(
      article.querySelectorAll('[data-testid="tweetText"]'),
    );
    const content = normalize(
      tweetTextNodes.map((node) => node.textContent || '').join(' '),
    );
    if (!content) continue;

    const handleMatch = href.match(/^\/([^/]+)\/status\//);
    const authorHandle = handleMatch ? `@${handleMatch[1]}` : '';
    const authorName = normalize(
      article.querySelector('div[dir="ltr"] span')?.textContent || '',
    );

    rows.push({
      postedAt,
      url,
      content,
      authorHandle,
      authorName,
    });

    if (rows.length >= limit) break;
  }

  return rows;
}

async function collectTweets(targetId, maxScrolls, meta) {
  const rows = [];
  const seen = new Set();

  for (let step = 0; step <= maxScrolls; step += 1) {
    await sleep(step === 0 ? 3500 : 2000);
    const currentRows =
      (await evaluate(targetId, toExpression(collectVisibleTweets, 18), meta)) || [];

    for (const row of currentRows) {
      const url = String(row?.url || '').trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      rows.push(row);
    }

    if (step < maxScrolls) {
      await scrollToBottom(targetId, meta);
    }
  }

  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const finalUrl = buildXSearchUrl(args.keyword);

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
      taskKind: 'x-search-latest',
      agentScope,
    });

    const rows = await collectTweets(targetId, args.maxScrolls, {
      stage: 'search-fetch',
      url: finalUrl,
      query: args.keyword,
      taskKind: 'x-search-latest',
      agentScope,
    });

    const selected = selectRecentRelevantTweets(rows, {
      keyword: args.keyword,
      days: args.days,
    }).slice(0, args.maxResults);

    const output = formatXSearchResult({
      keyword: args.keyword,
      days: args.days,
      finalUrl,
      note:
        selected.length > 0
          ? `共命中 ${selected.length} 条最近 ${args.days} 天内的可见结果`
          : '未检索到满足条件的结果。',
      items: selected,
    });

    console.log(output);
  } finally {
    if (targetId) {
      try {
        await closeTarget(targetId, {
          stage: 'search-close',
          url: finalUrl,
          query: args.keyword,
          taskKind: 'x-search-latest',
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
