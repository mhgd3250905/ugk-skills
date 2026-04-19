#!/usr/bin/env node

import process from 'node:process';

import {
  buildInstagramSearchUrl,
  buildInstagramSeedUrls,
  formatInstagramSearchResult,
  normalizeInstagramPost,
  selectRecentRelevantPosts,
} from './ins_search_latest_lib.mjs';
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
    maxSeeds: 3,
    postsPerSeed: 12,
    maxResults: 8,
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
    if (token === '--max-seeds') {
      args.maxSeeds = Number(argv[index + 1] || '3');
      index += 1;
      continue;
    }
    if (token === '--posts-per-seed') {
      args.postsPerSeed = Number(argv[index + 1] || '12');
      index += 1;
      continue;
    }
    if (token === '--max-results') {
      args.maxResults = Number(argv[index + 1] || '8');
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
  if (!Number.isInteger(args.maxSeeds) || args.maxSeeds <= 0) {
    throw new Error('max-seeds 必须是正整数');
  }
  if (!Number.isInteger(args.postsPerSeed) || args.postsPerSeed <= 0) {
    throw new Error('posts-per-seed 必须是正整数');
  }
  if (!Number.isInteger(args.maxResults) || args.maxResults <= 0) {
    throw new Error('max-results 必须是正整数');
  }

  args.days = Math.min(args.days, 90);
  return args;
}

async function browserCommand(command, meta, timeoutMs = 45000) {
  const result = await requestHostBrowser(command, {
    timeoutMs,
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

async function navigate(targetId, url, meta) {
  return browserCommand({ action: 'navigate', targetId, url }, meta);
}

async function evaluate(targetId, expression, meta) {
  const result = await browserCommand(
    { action: 'evaluate', targetId, expression },
    meta,
  );
  return result?.value;
}

async function scroll(targetId, direction, meta) {
  await browserCommand({ action: 'scroll', targetId, direction }, meta);
}

async function closeTarget(targetId, meta) {
  await browserCommand({ action: 'close_target', targetId }, meta);
}

function buildTopsearchExpression(keyword) {
  const encodedKeyword = encodeURIComponent(keyword);
  return `(
    async () => {
      const response = await fetch('/web/search/topsearch/?query=${encodedKeyword}', {
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      return {
        ok: response.ok,
        status: response.status,
        json,
        redirectedToLogin: location.pathname.includes('/accounts/login'),
        textExcerpt: text.slice(0, 500),
      };
    }
  )()`;
}

function buildSeedScanExpression(limit) {
  return `(() => {
    const links = [];
    const seen = new Set();
    for (const anchor of document.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href') || '';
      if (!href) continue;
      let url;
      try {
        url = new URL(href, location.href);
      } catch {
        continue;
      }
      if (!/^\\/(?:[^/]+\\/)?(p|reel|tv)\\//.test(url.pathname)) continue;
      url.hash = '';
      url.search = '';
      const absolute = url.toString();
      if (seen.has(absolute)) continue;
      seen.add(absolute);
      const label =
        anchor.getAttribute('aria-label') ||
        anchor.getAttribute('title') ||
        anchor.querySelector('img')?.getAttribute('alt') ||
        anchor.textContent ||
        '';
      links.push({
        url: absolute,
        label: String(label || '').replace(/\\s+/g, ' ').trim(),
      });
      if (links.length >= ${limit}) break;
    }
    return links;
  })()`;
}

function buildPostExtractionExpression() {
  return `(() => {
    const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const asArray = (value) => Array.isArray(value) ? value : value ? [value] : [];
    const parseJson = (raw) => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    };
    const flatten = (node) => {
      if (!node || typeof node !== 'object') return [];
      if (Array.isArray(node)) return node.flatMap(flatten);
      const graph = Array.isArray(node['@graph']) ? node['@graph'].flatMap(flatten) : [];
      return [node, ...graph];
    };
    const ldNodes = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .flatMap((script) => flatten(parseJson(script.textContent || '')));
    const primary = ldNodes.find((node) => {
      const types = asArray(node['@type']).map((value) => String(value));
      return types.some((value) => [
        'SocialMediaPosting',
        'ImageObject',
        'VideoObject',
        'Article',
      ].includes(value));
    }) || {};
    const getInteractionCount = (targetType) => {
      const stats = asArray(primary.interactionStatistic);
      for (const stat of stats) {
        const type = clean(stat?.interactionType?.['@type'] || stat?.interactionType?.name || stat?.name);
        if (!type.toLowerCase().includes(targetType.toLowerCase())) continue;
        const count = Number(stat?.userInteractionCount);
        if (Number.isFinite(count)) return count;
      }
      return null;
    };
    const metaDescription = clean(
      document.querySelector('meta[property="og:description"]')?.getAttribute('content') || ''
    );
    const caption = clean(
      primary.articleBody ||
      primary.caption ||
      primary.description ||
      primary.name ||
      metaDescription
    );
    const commentCount = Number.isFinite(Number(primary.commentCount))
      ? Number(primary.commentCount)
      : getInteractionCount('comment');

    return {
      url: location.href,
      author: clean(
        primary.author?.alternateName ||
        primary.author?.name ||
        document.querySelector('header a[href^="/"]')?.textContent ||
        ''
      ),
      postedAt: clean(
        primary.uploadDate ||
        primary.datePublished ||
        primary.dateCreated ||
        document.querySelector('time')?.getAttribute('datetime') ||
        ''
      ),
      caption,
      likeCount: getInteractionCount('like'),
      commentCount,
      metaDescription,
      redirectedToLogin: location.pathname.includes('/accounts/login'),
      visibleTextExcerpt: clean(document.body ? document.body.innerText : '').slice(0, 500),
    };
  })()`;
}

function parseInstagramSeedLabelDate(label, nowMs = Date.now()) {
  const normalized = String(label || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  const englishAbsolute = normalized.match(/\b(?:on\s+)?([A-Z][a-z]+ \d{1,2}, \d{4})\b/);
  if (englishAbsolute) {
    const parsed = Date.parse(englishAbsolute[1]);
    if (Number.isFinite(parsed)) return parsed;
  }

  const relativeDays = normalized.match(/(\d+)\s*(?:days?|天)前?/i);
  if (relativeDays) {
    const days = Number.parseInt(relativeDays[1], 10);
    if (Number.isFinite(days)) {
      return nowMs - days * 24 * 60 * 60 * 1000;
    }
  }

  return null;
}

function prioritizeCandidates(candidates) {
  return [...candidates].sort((left, right) => {
    const leftMs =
      typeof left.discoveredAtMs === 'number' && Number.isFinite(left.discoveredAtMs)
        ? left.discoveredAtMs
        : Number.NEGATIVE_INFINITY;
    const rightMs =
      typeof right.discoveredAtMs === 'number' && Number.isFinite(right.discoveredAtMs)
        ? right.discoveredAtMs
        : Number.NEGATIVE_INFINITY;
    return rightMs - leftMs;
  });
}

function classifySeed(url) {
  if (url.includes('/explore/tags/')) return 'hashtag';
  if (url.includes('/explore/search/keyword/')) return 'keyword_search';
  return 'account';
}

async function fetchTopsearch(targetId, keyword, meta) {
  const result = await evaluate(targetId, buildTopsearchExpression(keyword), meta);
  if (!result?.ok || result?.redirectedToLogin || !result?.json) {
    throw new Error(
      `instagram_topsearch_failed: status=${result?.status ?? 'unknown'} excerpt=${result?.textExcerpt || '(empty)'}`,
    );
  }
  return result.json;
}

async function collectPostLinksFromSeed(targetId, seedUrl, maxPostsPerSeed, meta) {
  await navigate(targetId, seedUrl, meta);
  await sleep(1800);

  const links = new Map();
  let noNewRounds = 0;

  for (let round = 0; round < 3; round += 1) {
    const snapshot = (await evaluate(
      targetId,
      buildSeedScanExpression(maxPostsPerSeed),
      meta,
    )) || [];

    let newLinkCount = 0;
    for (const link of snapshot) {
      if (!link?.url || links.has(link.url)) continue;
      links.set(link.url, {
        postUrl: link.url,
        matchedBy: classifySeed(seedUrl),
        discoveredAtMs: parseInstagramSeedLabelDate(link.label),
      });
      newLinkCount += 1;
      if (links.size >= maxPostsPerSeed) break;
    }

    if (links.size >= maxPostsPerSeed) break;
    if (newLinkCount === 0) {
      noNewRounds += 1;
      if (noNewRounds >= 2) break;
    } else {
      noNewRounds = 0;
    }

    await scroll(targetId, 'bottom', meta);
    await sleep(1000);
  }

  return [...links.values()];
}

async function collectPostDetails(targetId, postUrl, matchedBy, meta) {
  await navigate(targetId, postUrl, meta);
  await sleep(3000);
  const raw = await evaluate(targetId, buildPostExtractionExpression(), meta);
  if (!raw || raw.redirectedToLogin) return null;
  return normalizeInstagramPost(
    {
      ...raw,
      url: String(raw.url || postUrl).replace(/\s+/g, ' ').trim(),
      author: String(raw.author || '').replace(/\s+/g, ' ').trim(),
      postedAt: String(raw.postedAt || '').replace(/\s+/g, ' ').trim(),
      caption: String(raw.caption || '').replace(/\s+/g, ' ').trim(),
      metaDescription: String(raw.metaDescription || '').replace(/\s+/g, ' ').trim(),
      visibleTextExcerpt: String(raw.visibleTextExcerpt || '').replace(/\s+/g, ' ').trim(),
    },
    matchedBy,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const finalUrl = buildInstagramSearchUrl(args.keyword);

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          keyword: args.keyword,
          days: args.days,
          finalUrl,
          maxSeeds: args.maxSeeds,
          postsPerSeed: args.postsPerSeed,
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
      taskKind: 'ins-search-latest',
    });

    // 等待页面完全加载
    await sleep(3500);

    const topsearchPayload = await fetchTopsearch(targetId, args.keyword, {
      stage: 'search-fetch',
      url: finalUrl,
      query: args.keyword,
      taskKind: 'ins-search-latest',
    });

    const seedUrls = buildInstagramSeedUrls(args.keyword, topsearchPayload).slice(
      0,
      args.maxSeeds,
    );

    const discovered = new Map();
    for (const seedUrl of seedUrls) {
      const seedLinks = await collectPostLinksFromSeed(targetId, seedUrl, args.postsPerSeed, {
        stage: 'seed-scan',
        url: seedUrl,
        query: args.keyword,
        taskKind: 'ins-search-latest',
      });
      for (const item of seedLinks) {
        if (!discovered.has(item.postUrl)) {
          discovered.set(item.postUrl, item);
        }
      }
    }

    const collected = [];
    for (const candidate of prioritizeCandidates([...discovered.values()])) {
      if (collected.length >= args.maxResults) break;
      const post = await collectPostDetails(targetId, candidate.postUrl, candidate.matchedBy, {
        stage: 'post-detail',
        url: candidate.postUrl,
        query: args.keyword,
        taskKind: 'ins-search-latest',
      });
      if (post) {
        collected.push(post);
      }
    }

    const selected = selectRecentRelevantPosts(collected, {
      keyword: args.keyword,
      days: args.days,
    }).slice(0, args.maxResults);

    const output = formatInstagramSearchResult({
      keyword: args.keyword,
      days: args.days,
      finalUrl,
      note:
        selected.length > 0
          ? `共命中 ${selected.length} 条最近 ${args.days} 天内的相关结果`
          : `未检索到最近 ${args.days} 天内的相关结果`,
      items: selected,
    });

    console.log(output);
  } finally {
    if (targetId) {
      await closeTarget(targetId, {
        stage: 'search-close',
        url: finalUrl,
        query: args.keyword,
        taskKind: 'ins-search-latest',
      }).catch(() => undefined);
    }
  }
}

main().catch((error) => {
  const message =
    error instanceof Error ? error.message : 'ins_search_latest_failed';
  console.error(`Instagram Latest 查询失败：${message}`);
  process.exitCode = 1;
});