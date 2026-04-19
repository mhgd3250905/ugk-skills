/**
 * 小红书 API 调用模块
 * 通过 CDP 在页面内执行 fetch，利用浏览器的登录态和签名
 */

import { getDefaultLocalBrowser } from '/app/runtime/skills-user/web-access/scripts/local-cdp-browser.mjs';

const XHS_BASE = 'https://www.xiaohongshu.com';

/**
 * 通用请求方法
 */
async function xhsFetch(browser, targetId, url, options = {}) {
  const result = await browser.evaluate(targetId, `
    (async function() {
      try {
        const r = await fetch('${url}', {
          method: '${options.method || 'GET'}',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json;charset=UTF-8',
          },
          credentials: 'include'
        });
        const data = await r.json();
        return JSON.stringify({
          status: r.status,
          ok: r.ok,
          data: data
        });
      } catch (e) {
        return JSON.stringify({
          status: 0,
          ok: false,
          error: e.message
        });
      }
    })()
  `);

  const parsed = JSON.parse(result);
  if (!parsed.ok) {
    throw new Error(`小红书 API 失败: ${parsed.status} - ${parsed.error || '未知错误'}`);
  }
  return parsed.data;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 搜索笔记
 * @param {string} keyword 搜索关键词
 * @param {number} page 页码
 * @param {number} pageSize 每页数量
 */
export async function searchNotes(keyword, page = 1, pageSize = 20) {
  const browser = getDefaultLocalBrowser();

  const encodedKeyword = encodeURIComponent(keyword);
  const target = await browser.newTarget(`${XHS_BASE}/search_result?keyword=${encodedKeyword}`);
  const targetId = target.id;

  await sleep(4000);

  const result = await browser.evaluate(targetId, `
    (async function() {
      try {
        const url = '/api/sns/web/v1/search/notes?keyword=${encodedKeyword}&page=${page}&page_size=${pageSize}&search_id=&sort=general';
        const r = await fetch(url, {
          method: 'GET',
          credentials: 'include'
        });
        const data = await r.json();

        const items = (data.data?.notes || []).map(item => {
          const note = item.noteCard || item;
          return {
            id: note.noteId || note.id,
            title: (note.displayTitle || note.title || '').slice(0, 100),
            desc: (note.desc || '').slice(0, 200),
            author: {
              nickname: note.user?.nickname || note.user?.name || '',
              userId: note.user?.userId || ''
            },
            interactInfo: {
              likeCount: note.interactInfo?.likeCount || 0,
              collectCount: note.interactInfo?.collectCount || 0,
              commentCount: note.interactInfo?.commentCount || 0
            },
            cover: note.cover?.infoList?.[0]?.url || note.cover || '',
            type: note.type || 'normal',
            link: 'https://www.xiaohongshu.com/explore/' + (note.noteId || note.id)
          };
        });

        return JSON.stringify({
          status: r.status,
          ok: r.ok,
          items: items,
          hasMore: data.data?.has_more || false
        });
      } catch (e) {
        return JSON.stringify({ status: 0, ok: false, error: e.message });
      }
    })()
  `.replace(/\${encodedKeyword}/g, encodedKeyword).replace(/\${page}/g, page).replace(/\${pageSize}/g, pageSize));

  await browser.closeTarget(targetId);

  const parsed = JSON.parse(result);
  if (!parsed.ok) {
    throw new Error(`小红书搜索失败: ${parsed.status} - ${parsed.error || '未知错误'}`);
  }

  return {
    items: parsed.items,
    hasMore: parsed.hasMore
  };
}

/**
 * 获取笔记详情
 * @param {string} noteId 笔记 ID
 */
export async function getNoteDetail(noteId) {
  const browser = getDefaultLocalBrowser();

  const target = await browser.newTarget(`${XHS_BASE}/explore/${noteId}`);
  const targetId = target.id;

  await sleep(4000);

  const result = await browser.evaluate(targetId, `
    (async function() {
      try {
        const noteId = window.location.pathname.split('/').pop();
        const url = '/api/sns/web/v1/feed?source_id=' + noteId;
        const r = await fetch(url, {
          method: 'GET',
          credentials: 'include'
        });
        const data = await r.json();

        const note = data.data?.notes?.[0]?.noteCard || data.data?.[0] || {};
        const items = note.imageList || [];

        return JSON.stringify({
          status: r.status,
          ok: r.ok,
          note: {
            id: note.noteId || noteId,
            title: note.displayTitle || note.title || '',
            desc: note.desc || '',
            type: note.type || 'normal',
            author: {
              nickname: note.user?.nickname || '',
              userId: note.user?.userId || '',
              avatar: note.user?.avatar || ''
            },
            interactInfo: {
              likeCount: note.interactInfo?.likeCount || 0,
              collectCount: note.interactInfo?.collectCount || 0,
              commentCount: note.interactInfo?.commentCount || 0,
              shareCount: note.interactInfo?.shareCount || 0
            },
            images: items.map(img => img.infoList?.[0]?.url || img.url || '').filter(Boolean),
            video: note.video?.media?.stream?.h264?.[0]?.masterUrl || note.video?.url || '',
            tags: (note.tagList || []).map(t => t.name || t).filter(Boolean),
            time: note.time || '',
            link: 'https://www.xiaohongshu.com/explore/' + (note.noteId || noteId)
          }
        });
      } catch (e) {
        return JSON.stringify({ status: 0, ok: false, error: e.message });
      }
    })()
  `);

  await browser.closeTarget(targetId);

  const parsed = JSON.parse(result);
  if (!parsed.ok) {
    throw new Error(`小红书笔记详情失败: ${parsed.status} - ${parsed.error || '未知错误'}`);
  }

  return parsed.note;
}

/**
 * 获取笔记评论
 * @param {string} noteId 笔记 ID
 * @param {number} limit 返回条数
 */
export async function getNoteComments(noteId, limit = 20) {
  const browser = getDefaultLocalBrowser();

  const target = await browser.newTarget(`${XHS_BASE}/explore/${noteId}`);
  const targetId = target.id;

  await sleep(3000);

  const result = await browser.evaluate(targetId, `
    (async function() {
      try {
        const noteId = window.location.pathname.split('/').pop();
        const url = '/api/sns/web/v2/comment/page?note_id=' + noteId + '&cursor=&top_comment_id=&image_formats=jpg,webp,avif';
        const r = await fetch(url, {
          method: 'GET',
          credentials: 'include'
        });
        const data = await r.json();

        const items = (data.data?.comments || []).slice(0, ${limit}).map(item => ({
          id: item.id,
          content: item.content || '',
          author: {
            nickname: item.user?.nickname || '',
            userId: item.user?.userId || '',
            avatar: item.user?.avatar || ''
          },
          likeCount: item.likeCount || item.like_count || 0,
          subCommentCount: item.subCommentCount || item.sub_comment_count || 0,
          time: item.createTime || item.time || ''
        }));

        return JSON.stringify({
          status: r.status,
          ok: r.ok,
          items: items,
          hasMore: data.data?.has_more || false
        });
      } catch (e) {
        return JSON.stringify({ status: 0, ok: false, error: e.message });
      }
    })()
  `.replace('${limit}', limit));

  await browser.closeTarget(targetId);

  const parsed = JSON.parse(result);
  if (!parsed.ok) {
    throw new Error(`小红书评论失败: ${parsed.status} - ${parsed.error || '未知错误'}`);
  }

  return {
    items: parsed.items,
    hasMore: parsed.hasMore
  };
}

/**
 * 获取用户信息
 * @param {string} userId 用户 ID
 */
export async function getUserInfo(userId) {
  const browser = getDefaultLocalBrowser();

  const target = await browser.newTarget(`${XHS_BASE}/user/profile/${userId}`);
  const targetId = target.id;

  await sleep(4000);

  const result = await browser.evaluate(targetId, `
    (async function() {
      try {
        const userId = window.location.pathname.split('/').pop();

        // 尝试从页面数据获取
        const userInfo = window.__INITIAL_STATE__?.user?.userInfo || {};

        // 如果页面数据有用户信息
        if (userInfo.nickname) {
          return JSON.stringify({
            status: 200,
            ok: true,
            user: {
              userId: userInfo.userId || userId,
              nickname: userInfo.nickname || '',
              desc: userInfo.desc || '',
              avatar: userInfo.avatar || '',
              notes: userInfo.notes || 0,
              fans: userInfo.fans || 0,
              follows: userInfo.follows || 0,
              liked: userInfo.liked || 0,
              location: userInfo.location || '',
              link: 'https://www.xiaohongshu.com/user/profile/' + userId
            }
          });
        }

        // 否则尝试 API
        const url = '/api/sns/web/v1/user/collected?user_id=' + userId;
        const r = await fetch(url, {
          method: 'GET',
          credentials: 'include'
        });
        const data = await r.json();

        const user = data.data?.user || {};

        return JSON.stringify({
          status: r.status,
          ok: r.ok,
          user: {
            userId: user.userId || userId,
            nickname: user.nickname || '',
            desc: user.desc || '',
            avatar: user.avatar || '',
            notes: user.notes || 0,
            fans: user.fans || 0,
            follows: user.follows || 0,
            liked: user.liked || 0,
            location: user.location || '',
            link: 'https://www.xiaohongshu.com/user/profile/' + userId
          }
        });
      } catch (e) {
        return JSON.stringify({ status: 0, ok: false, error: e.message });
      }
    })()
  `);

  await browser.closeTarget(targetId);

  const parsed = JSON.parse(result);
  if (!parsed.ok) {
    throw new Error(`小红书用户信息失败: ${parsed.status} - ${parsed.error || '未知错误'}`);
  }

  return parsed.user;
}

/**
 * 获取用户发布的笔记
 * @param {string} userId 用户 ID
 * @param {number} limit 返回条数
 */
export async function getUserNotes(userId, limit = 20) {
  const browser = getDefaultLocalBrowser();

  const target = await browser.newTarget(`${XHS_BASE}/user/profile/${userId}`);
  const targetId = target.id;

  await sleep(4000);

  const result = await browser.evaluate(targetId, `
    (async function() {
      try {
        const userId = window.location.pathname.split('/').pop();
        const url = '/api/sns/web/v1/user_posted?num=${limit}&cursor=&user_id=' + userId + '&image_formats=jpg,webp,avif';
        const r = await fetch(url, {
          method: 'GET',
          credentials: 'include'
        });
        const data = await r.json();

        const items = (data.data?.notes || []).map(note => ({
          id: note.noteId || note.id,
          title: (note.displayTitle || note.title || '').slice(0, 100),
          desc: (note.desc || '').slice(0, 200),
          cover: note.cover?.infoList?.[0]?.url || note.cover || '',
          type: note.type || 'normal',
          interactInfo: {
            likeCount: note.interactInfo?.likeCount || 0,
            collectCount: note.interactInfo?.collectCount || 0
          },
          link: 'https://www.xiaohongshu.com/explore/' + (note.noteId || note.id)
        }));

        return JSON.stringify({
          status: r.status,
          ok: r.ok,
          items: items,
          hasMore: data.data?.has_more || false
        });
      } catch (e) {
        return JSON.stringify({ status: 0, ok: false, error: e.message });
      }
    })()
  `.replace('${limit}', limit));

  await browser.closeTarget(targetId);

  const parsed = JSON.parse(result);
  if (!parsed.ok) {
    throw new Error(`小红书用户笔记失败: ${parsed.status} - ${parsed.error || '未知错误'}`);
  }

  return {
    items: parsed.items,
    hasMore: parsed.hasMore
  };
}

/**
 * 获取首页推荐
 * @param {number} limit 返回条数
 */
export async function getHomeFeed(limit = 20) {
  const browser = getDefaultLocalBrowser();

  const target = await browser.newTarget(XHS_BASE);
  const targetId = target.id;

  await sleep(4000);

  const result = await browser.evaluate(targetId, `
    (async function() {
      try {
        const url = '/api/sns/web/v1/homefeed?cursor=&num=${limit}&refresh_type=1&image_formats=jpg,webp,avif';
        const r = await fetch(url, {
          method: 'GET',
          credentials: 'include'
        });
        const data = await r.json();

        const items = (data.data?.items || []).filter(item => item.noteCard).map(item => {
          const note = item.noteCard;
          return {
            id: note.noteId || note.id,
            title: (note.displayTitle || note.title || '').slice(0, 100),
            desc: (note.desc || '').slice(0, 200),
            author: {
              nickname: note.user?.nickname || '',
              userId: note.user?.userId || ''
            },
            interactInfo: {
              likeCount: note.interactInfo?.likeCount || 0,
              collectCount: note.interactInfo?.collectCount || 0,
              commentCount: note.interactInfo?.commentCount || 0
            },
            cover: note.cover?.infoList?.[0]?.url || note.cover || '',
            type: note.type || 'normal',
            link: 'https://www.xiaohongshu.com/explore/' + (note.noteId || note.id)
          };
        }).slice(0, ${limit});

        return JSON.stringify({
          status: r.status,
          ok: r.ok,
          items: items
        });
      } catch (e) {
        return JSON.stringify({ status: 0, ok: false, error: e.message });
      }
    })()
  `.replace(/\${limit}/g, limit));

  await browser.closeTarget(targetId);

  const parsed = JSON.parse(result);
  if (!parsed.ok) {
    throw new Error(`小红书首页推荐失败: ${parsed.status} - ${parsed.error || '未知错误'}`);
  }

  return parsed.items;
}

/**
 * 从 URL 提取笔记 ID
 */
export function extractNoteId(url) {
  const match = url.match(/explore\/([a-zA-Z0-9]+)/);
  return match ? match[1] : url;
}

/**
 * 从 URL 提取用户 ID
 */
export function extractUserId(url) {
  const match = url.match(/profile\/([a-zA-Z0-9]+)/);
  return match ? match[1] : url;
}