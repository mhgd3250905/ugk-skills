const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function trimText(value, limit) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (!limit || text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function parseCount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.replace(/[^\d]/g, ''), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseOgDescription(metaDescription) {
  const raw = String(metaDescription || '').trim();
  if (!raw) {
    return {
      author: '',
      caption: '',
      likeCount: null,
      commentCount: null,
    };
  }

  const likeMatch = raw.match(/(\d+)\s+likes?/i);
  const commentMatch = raw.match(/(\d+)\s+comments?/i);
  const authorMatch = raw.match(/-\s+([^,:，：]+)\s*[,，：:]/);
  const captionMatch = raw.match(/:\s*"([\s\S]*)"\s*\.?\s*$/);

  return {
    author: authorMatch ? authorMatch[1].trim() : '',
    caption: captionMatch ? captionMatch[1].trim() : '',
    likeCount: likeMatch ? Number.parseInt(likeMatch[1], 10) : null,
    commentCount: commentMatch ? Number.parseInt(commentMatch[1], 10) : null,
  };
}

function deriveTitle(caption, maxLength = 80) {
  const raw = String(caption || '').trim();
  if (!raw) return '';
  const firstSegment =
    raw
      .split(/\r?\n/)
      .map((segment) => segment.trim())
      .find(Boolean) || raw;
  const firstSentence =
    firstSegment
      .split(/[.!?。！？]/)[0]
      .replace(/\s+/g, ' ')
      .trim() || firstSegment.replace(/\s+/g, ' ').trim();
  if (firstSentence.length <= maxLength) return firstSentence;
  return `${firstSentence.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function includesKeyword(value, keyword) {
  return normalizeText(value).includes(normalizeText(keyword));
}

function encodeInstagramPathSegment(value) {
  return encodeURIComponent(String(value || '').trim());
}

function buildMatchReason(post, keyword) {
  const normalizedKeyword = normalizeText(keyword);
  if (!normalizedKeyword) return 'unknown';

  if (includesKeyword(post.author, normalizedKeyword)) {
    return 'author';
  }
  if (includesKeyword(post.caption, normalizedKeyword)) {
    return 'caption';
  }
  if (includesKeyword(post.titleDerived, normalizedKeyword)) {
    return 'title';
  }
  if (includesKeyword(post.postUrl, normalizedKeyword)) {
    return 'url';
  }
  return 'seed';
}

export function buildInstagramSearchUrl(keyword) {
  return `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(keyword)}`;
}

export function buildInstagramSeedUrls(keyword, payload) {
  const urls = [buildInstagramSearchUrl(keyword)];
  const seen = new Set(urls);
  const exactHashtagUrls = [];
  const exactUserUrls = [];
  const fuzzyUserUrls = [];
  const fuzzyHashtagUrls = [];

  for (const entry of payload?.hashtags || []) {
    const hashtagName = String(entry?.hashtag?.name || '').trim();
    if (!hashtagName || !includesKeyword(hashtagName, keyword)) continue;
    const url = `https://www.instagram.com/explore/tags/${encodeInstagramPathSegment(hashtagName)}/`;
    if (seen.has(url)) continue;
    seen.add(url);
    if (normalizeText(hashtagName) === normalizeText(keyword)) {
      exactHashtagUrls.push(url);
    } else {
      fuzzyHashtagUrls.push(url);
    }
  }

  for (const entry of payload?.users || []) {
    const username = String(entry?.user?.username || '').trim();
    const fullName = String(entry?.user?.full_name || '').trim();
    if (
      !username ||
      (!includesKeyword(username, keyword) && !includesKeyword(fullName, keyword))
    ) {
      continue;
    }
    const url = `https://www.instagram.com/${encodeInstagramPathSegment(username)}/`;
    if (seen.has(url)) continue;
    seen.add(url);
    if (
      normalizeText(username) === normalizeText(keyword) ||
      normalizeText(fullName) === normalizeText(keyword)
    ) {
      exactUserUrls.push(url);
    } else {
      fuzzyUserUrls.push(url);
    }
  }

  return [
    ...urls,
    ...exactHashtagUrls,
    ...exactUserUrls,
    ...fuzzyUserUrls,
    ...fuzzyHashtagUrls,
  ];
}

export function normalizeInstagramPost(raw, matchedBy) {
  const postUrl = String(raw?.url || '').trim();
  const postedAt = String(raw?.postedAt || '').trim();
  if (!postUrl || !postedAt) return null;

  const parsedMeta = parseOgDescription(raw?.metaDescription);
  const author =
    String(raw?.author || '').replace(/\s+/g, ' ').trim() || parsedMeta.author;
  if (!author) return null;

  const rawCaption = String(raw?.caption || '').replace(/\s+/g, ' ').trim();
  const rawMetaDescription = String(raw?.metaDescription || '')
    .replace(/\s+/g, ' ')
    .trim();
  const caption =
    (rawCaption &&
    rawCaption !== rawMetaDescription &&
    !/^\d+\s+likes?,\s+\d+\s+comments?\s+-/i.test(rawCaption)
      ? rawCaption
      : '') ||
    parsedMeta.caption ||
    String(raw?.visibleTextExcerpt || '').replace(/\s+/g, ' ').trim();

  return {
    postUrl,
    postedAt,
    author,
    titleDerived: deriveTitle(caption),
    caption,
    likeCount: parseCount(raw?.likeCount) ?? parsedMeta.likeCount,
    commentCount: parseCount(raw?.commentCount) ?? parsedMeta.commentCount,
    matchedBy,
  };
}

export function selectRecentRelevantPosts(posts, options) {
  const keyword = String(options?.keyword || '').trim();
  const days = Math.max(1, Number(options?.days || 30));
  const nowMs = Number(options?.nowMs || Date.now());
  const cutoffMs = nowMs - days * DAY_MS;

  return (Array.isArray(posts) ? posts : [])
    .map((post) => {
      const postedAtMs = Date.parse(post?.postedAt || '');
      if (!Number.isFinite(postedAtMs) || postedAtMs < cutoffMs) {
        return null;
      }

      const haystack = [
        post?.author,
        post?.caption,
        post?.titleDerived,
        post?.postUrl,
      ].join(' ');
      if (!includesKeyword(haystack, keyword)) {
        return null;
      }

      return {
        ...post,
        matchReason: buildMatchReason(post, keyword),
      };
    })
    .filter(Boolean)
    .sort((left, right) => Date.parse(right.postedAt) - Date.parse(left.postedAt));
}

export function formatInstagramSearchResult(input) {
  const lines = [
    'Instagram Latest 查询结果',
    `关键词：${input.keyword}`,
    `时间范围：最近 ${input.days} 天`,
    `查询地址：${input.finalUrl}`,
    '',
    `结果概览：${input.note}`,
    '',
  ];

  if (!Array.isArray(input.items) || input.items.length === 0) {
    lines.push('结果列表：未检索到满足条件的结果。');
    return lines.join('\n');
  }

  lines.push('结果列表：');
  input.items.forEach((item, index) => {
    lines.push(`${index + 1}. 时间：${String(item.postedAt || '').slice(0, 10) || '时间未完整解析'}`);
    lines.push(`   作者：${item.author || 'unknown'}`);
    lines.push(`   标题：${trimText(item.titleDerived || '（无标题）', 160)}`);
    lines.push(`   正文：${trimText(item.caption || '（正文为空）', 320)}`);
    lines.push(`   点赞数：${item.likeCount ?? '未知'}`);
    lines.push(`   评论数：${item.commentCount ?? '未知'}`);
    lines.push(`   匹配依据：${item.matchReason || item.matchedBy || 'unknown'}`);
    lines.push(`   链接：${item.postUrl}`);
  });

  return lines.join('\n');
}