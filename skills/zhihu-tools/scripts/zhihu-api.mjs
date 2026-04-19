/**
 * 知乎 API 调用模块
 * 通过 CDP 在页面内执行 fetch，利用浏览器的登录态
 */

import { getDefaultLocalBrowser } from '/app/runtime/skills-user/web-access/scripts/local-cdp-browser.mjs';

const ZHIHU_BASE = 'https://www.zhihu.com';

/**
 * 获取知乎热榜
 * @param {number} limit 返回条数，默认 15
 */
export async function getHotList(limit = 15) {
  const browser = getDefaultLocalBrowser();
  
  const target = await browser.newTarget(ZHIHU_BASE + '/hot');
  const targetId = target.id;
  
  await sleep(4000);
  
  const result = await browser.evaluate(targetId, `
    (async function() {
      const r = await fetch('/api/v3/feed/topstory/hot-lists/total');
      const data = await r.json();
      
      const items = data.data.map(item => ({
        rank: item.card_id?.replace('Q_', '') || '',
        title: item.target?.title || '',
        excerpt: (item.target?.excerpt || '').slice(0, 100),
        hotValue: item.detail_text || '',
        link: item.target?.url || ''
      }));
      
      return JSON.stringify({
        status: r.status,
        ok: r.ok,
        items: items
      });
    })()
  `);
  
  await browser.closeTarget(targetId);
  
  const parsed = JSON.parse(result);
  if (!parsed.ok) {
    throw new Error(`知乎热榜 API 失败: ${parsed.status}`);
  }
  
  return parsed.items.slice(0, limit);
}

/**
 * 获取问题回答列表
 * @param {string} questionId 问题 ID
 * @param {object} options 选项
 */
export async function getAnswers(questionId, options = {}) {
  const { limit = 10, offset = 0, sortBy = 'default' } = options;
  
  const browser = getDefaultLocalBrowser();
  
  const target = await browser.newTarget(`${ZHIHU_BASE}/question/${questionId}`);
  const targetId = target.id;
  
  await sleep(4000);
  
  const result = await browser.evaluate(targetId, `
    (async function() {
      const questionId = window.location.pathname.split('/').pop();
      const r = await fetch('/api/v4/questions/' + questionId + '/answers?limit=${limit}&offset=${offset}&sort_by=${sortBy}');
      const data = await r.json();
      
      const items = (data.data || []).map(item => ({
        id: item.id,
        author: {
          name: item.author?.name || '',
          headline: (item.author?.headline || '').slice(0, 50),
          avatar_url: item.author?.avatar_url || ''
        },
        excerpt: (item.excerpt || item.content?.slice(0, 200) || '').slice(0, 150),
        voteup_count: item.voteup_count || 0,
        comment_count: item.comment_count || 0,
        created_time: item.created_time,
        url: 'https://www.zhihu.com/question/' + questionId + '/answer/' + item.id
      }));
      
      return JSON.stringify({
        status: r.status,
        ok: r.ok,
        paging: data.paging,
        items: items
      });
    })()
  `.replace('${limit}', limit).replace('${offset}', offset).replace('${sortBy}', sortBy));
  
  await browser.closeTarget(targetId);
  
  const parsed = JSON.parse(result);
  if (!parsed.ok) {
    throw new Error(`知乎回答 API 失败: ${parsed.status}`);
  }
  
  return {
    items: parsed.items,
    paging: parsed.paging,
    hasMore: !parsed.paging?.is_end
  };
}

/**
 * 获取回答评论
 * @param {string} answerId 回答 ID
 * @param {number} limit 返回条数
 */
export async function getComments(answerId, limit = 10) {
  const browser = getDefaultLocalBrowser();
  
  // 需要先打开一个知乎页面才能执行 fetch
  const target = await browser.newTarget(ZHIHU_BASE);
  const targetId = target.id;
  
  await sleep(3000);
  
  const result = await browser.evaluate(targetId, `
    (async function() {
      const r = await fetch('/api/v4/answers/${answerId}/comments?limit=${limit}');
      const data = await r.json();
      
      const items = (data.data || []).map(item => ({
        id: item.id,
        author: {
          name: item.author?.name || '',
          avatar_url: item.author?.avatar_url || ''
        },
        content: (item.content || '').slice(0, 200),
        vote_count: item.vote_count || 0,
        created_time: item.created_time
      }));
      
      return JSON.stringify({
        status: r.status,
        ok: r.ok,
        total: data.common_counts || 0,
        items: items
      });
    })()
  `.replace('${answerId}', answerId).replace('${limit}', limit));
  
  await browser.closeTarget(targetId);
  
  const parsed = JSON.parse(result);
  if (!parsed.ok) {
    throw new Error(`知乎评论 API 失败: ${parsed.status}`);
  }
  
  return {
    total: parsed.total,
    items: parsed.items
  };
}

/**
 * 知乎搜索
 * @param {string} query 搜索关键词
 * @param {string} type 搜索类型：general, question, answer, article
 * @param {number} limit 返回条数
 */
export async function search(query, type = 'general', limit = 10) {
  const browser = getDefaultLocalBrowser();
  
  const encodedQuery = encodeURIComponent(query);
  const target = await browser.newTarget(`${ZHIHU_BASE}/search?q=${encodedQuery}&type=${type}`);
  const targetId = target.id;
  
  await sleep(4000);
  
  const evalScript = `
    (async function() {
      const r = await fetch('/api/v4/search_v3?t=${type}&q=${encodedQuery}&correction=1&offset=0&limit=${limit}');
      const data = await r.json();
      
      const items = (data.data || []).map(item => ({
        type: item.type,
        title: item.object?.title || (typeof item.highlight === 'string' ? item.highlight.slice(0, 50) : '') || '',
        excerpt: (item.object?.excerpt || item.object?.content?.slice(0, 100) || '').slice(0, 100),
        url: item.object?.url || '',
        author: item.object?.author?.name || ''
      }));
      
      return JSON.stringify({
        status: r.status,
        ok: r.ok,
        items: items
      });
    })()
  `;
  
  const result = await browser.evaluate(targetId, evalScript);
  
  await browser.closeTarget(targetId);
  
  const parsed = JSON.parse(result);
  if (!parsed.ok) {
    throw new Error(`知乎搜索 API 失败: ${parsed.status}`);
  }
  
  return parsed.items;
}

/**
 * 获取用户信息
 * @param {string} userToken 用户 token（URL 中的用户标识）
 */
export async function getUser(userToken) {
  const browser = getDefaultLocalBrowser();
  
  const target = await browser.newTarget(`${ZHIHU_BASE}/people/${userToken}`);
  const targetId = target.id;
  
  await sleep(4000);
  
  const result = await browser.evaluate(targetId, `
    (async function() {
      const userToken = window.location.pathname.split('/').pop();
      const r = await fetch('/api/v4/members/' + userToken);
      const data = await r.json();
      
      return JSON.stringify({
        status: r.status,
        ok: r.ok,
        user: {
          id: data.id,
          name: data.name,
          headline: data.headline,
          avatar_url: data.avatar_url,
          answer_count: data.answer_count,
          article_count: data.article_count,
          follower_count: data.follower_count,
          following_count: data.following_count,
          url: 'https://www.zhihu.com/people/' + userToken
        }
      });
    })()
  `);
  
  await browser.closeTarget(targetId);
  
  const parsed = JSON.parse(result);
  if (!parsed.ok) {
    throw new Error(`知乎用户 API 失败: ${parsed.status}`);
  }
  
  return parsed.user;
}

/**
 * 从 URL 提取 ID
 */
export function extractQuestionId(url) {
  const match = url.match(/question\/(\d+)/);
  return match ? match[1] : url;
}

export function extractAnswerId(url) {
  const match = url.match(/answer\/(\d+)/);
  return match ? match[1] : url;
}

export function extractUserToken(url) {
  const match = url.match(/people\/([^\/]+)/);
  return match ? match[1] : url;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}