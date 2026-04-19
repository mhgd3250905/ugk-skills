#!/usr/bin/env node

import process from 'node:process';

import {
  buildTikTokSearchUrl,
  formatTikTokSearchResult,
  selectRecentRelevantVideos,
  shouldContinueCollectingPayloads,
} from './tiktok_search_latest_lib.mjs';
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
    maxPages: 2,
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
    if (token === '--max-pages') {
      args.maxPages = Number(argv[index + 1] || '2');
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
  if (!Number.isInteger(args.maxPages) || args.maxPages <= 0) {
    throw new Error('max-pages 必须是正整数');
  }
  if (!Number.isInteger(args.maxResults) || args.maxResults <= 0) {
    throw new Error('max-results 必须是正整数');
  }
  return args;
}

function toExpression(factory, ...args) {
  return `(${factory.toString()})(${args
    .map((arg) => JSON.stringify(arg))
    .join(',')})`;
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

async function closeTarget(targetId, meta) {
  await browserCommand({ action: 'close_target', targetId }, meta);
}

async function scrollToBottom(targetId, meta) {
  await browserCommand(
    { action: 'scroll', targetId, direction: 'bottom' },
    meta,
  );
}

function collectSearchRequestUrls() {
  return performance
    .getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter(
      (url) =>
        typeof url === 'string' && url.includes('/api/search/general/full/'),
    );
}

async function refetchSignedUrl(url) {
  const response = await fetch(url, {
    credentials: 'include',
    headers: { accept: 'application/json,text/plain,*/*' },
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    text,
    url: response.url,
    bdturing:
      response.headers.get('bdturing-verify') ||
      response.headers.get('x-vc-bdturing-parameters') ||
      '',
  };
}

async function collectSignedSearchPayloads(targetId, maxPages, meta) {
  const urls = new Set();
  const payloads = [];
  let consecutiveIdleRounds = 0;

  for (let step = 0; ; step += 1) {
    await sleep(step === 0 ? 2500 : 1800);
    const currentUrls =
      (await evaluate(
        targetId,
        toExpression(collectSearchRequestUrls),
        meta,
      )) || [];

    let newUrlCount = 0;
    for (const url of currentUrls) {
      if (!url || urls.has(url)) continue;
      urls.add(url);
      newUrlCount += 1;
      const payload = await evaluate(
        targetId,
        toExpression(refetchSignedUrl, url),
        meta,
      );
      if (payload) {
        payloads.push(payload);
      }
    }

    consecutiveIdleRounds = newUrlCount > 0 ? 0 : consecutiveIdleRounds + 1;
    const shouldContinue = shouldContinueCollectingPayloads({
      step,
      maxPages,
      seenAnyUrls: urls.size > 0,
      consecutiveIdleRounds,
    });

    if (!shouldContinue) {
      break;
    }

    if (newUrlCount > 0 || urls.size === 0) {
      await scrollToBottom(targetId, meta);
    }
  }

  return payloads;
}

function flattenSearchPayloads(payloads) {
  const items = [];
  for (const payload of payloads) {
    if (!payload?.text) continue;
    let parsed;
    try {
      parsed = JSON.parse(payload.text);
    } catch {
      continue;
    }
    const data = Array.isArray(parsed?.data) ? parsed.data : [];
    for (const entry of data) {
      if (entry?.type === 1 && entry?.item) {
        items.push(entry.item);
      }
    }
  }
  return items;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const finalUrl = buildTikTokSearchUrl(args.keyword);

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          keyword: args.keyword,
          days: args.days,
          url: finalUrl,
          maxPages: args.maxPages,
          maxResults: args.maxResults,
        },
        null,
        2,
      ),
    );
    return;
  }

  await ensureHostBrowserBridge();

  let targetId = null;
  try {
    targetId = await createTarget(finalUrl, {
      stage: 'search-open',
      url: finalUrl,
      query: args.keyword,
      taskKind: 'tiktok-search-latest',
    });

    const payloads = await collectSignedSearchPayloads(targetId, args.maxPages, {
      stage: 'search-fetch',
      url: finalUrl,
      query: args.keyword,
      taskKind: 'tiktok-search-latest',
    });

    const rawItems = flattenSearchPayloads(payloads);
    const selected = selectRecentRelevantVideos(rawItems, {
      keyword: args.keyword,
      days: args.days,
    }).slice(0, args.maxResults);

    const output = formatTikTokSearchResult({
      keyword: args.keyword,
      days: args.days,
      finalUrl,
      note:
        selected.length > 0
          ? `共命中 ${selected.length} 条最近 ${args.days} 天内的强相关结果`
          : `未检索到最近 ${args.days} 天内的强相关结果`,
      items: selected,
    });
    console.log(output);
  } finally {
    if (targetId) {
      await closeTarget(targetId, {
        stage: 'search-close',
        url: finalUrl,
        query: args.keyword,
        taskKind: 'tiktok-search-latest',
      }).catch(() => undefined);
    }
  }
}

main().catch((error) => {
  const message =
    error instanceof Error ? error.message : 'tiktok_search_latest_failed';
  console.error(`TikTok Latest 查询失败：${message}`);
  process.exitCode = 1;
});
