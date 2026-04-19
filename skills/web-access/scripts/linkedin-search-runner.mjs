#!/usr/bin/env node

import { ensureHostBrowserBridge } from './host-bridge.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function proxyRequest(endpoint, options = {}) {
  const url = `http://127.0.0.1:3456${endpoint}`;
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(60000),
  });
  return response.json();
}

async function createTarget(url) {
  return proxyRequest(`/new?url=${encodeURIComponent(url)}`);
}

async function getInfo(targetId) {
  return proxyRequest(`/info?target=${encodeURIComponent(targetId)}`);
}

async function evalScript(targetId, expression) {
  return proxyRequest(`/eval?target=${encodeURIComponent(targetId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: expression,
  });
}

async function closeTarget(targetId) {
  return proxyRequest(`/close?target=${encodeURIComponent(targetId)}`);
}

async function scrollPage(targetId, y = 800) {
  return proxyRequest(`/scroll?target=${encodeURIComponent(targetId)}&y=${y}`);
}

// 提取 LinkedIn 搜索结果的脚本
const EXTRACT_LINKEDIN_SCRIPT = `
(function() {
  const results = [];

  // LinkedIn 内容搜索结果选择器
  const posts = document.querySelectorAll('.search-result__content, .entity-result__content, [data-chameleon-result-urn]');

  posts.forEach(post => {
    try {
      // 时间 - LinkedIn 可能在多个位置
      let datetime = '';
      let timeText = '';
      const timeEl = post.querySelector('time');
      if (timeEl) {
        datetime = timeEl.getAttribute('datetime') || '';
        timeText = timeEl.textContent || '';
      }

      // 如果没有 time 元素，尝试从文本中提取时间信息
      if (!datetime && !timeText) {
        const timeAgoMatch = post.textContent.match(/(\\d+\\s*(?:hour|day|week|month)s?\\s*ago|just now|yesterday)/i);
        if (timeAgoMatch) {
          timeText = timeAgoMatch[1];
        }
      }

      // 作者/账号名称
      let authorName = '';
      let authorTitle = '';
      const authorLink = post.querySelector('a[href*="/in/"], .app-aware-link, .actor-name');
      if (authorLink) {
        authorName = authorLink.textContent.trim();
      }
      // 尝试获取职位标题
      const titleEl = post.querySelector('.entity-result__primary-subtitle, .search-result__truncate');
      if (titleEl) {
        authorTitle = titleEl.textContent.trim();
      }

      // 内容文本
      let content = '';
      const contentEl = post.querySelector('.search-result__text, .entity-result__summary, .attributed-text-segment-list__content');
      if (contentEl) {
        content = contentEl.textContent.trim();
      } else {
        // 尝试获取所有文本
        content = post.textContent.trim().substring(0, 500);
      }

      // 链接
      let postUrl = '';
      const linkEl = post.querySelector('a[href*="/posts/"], a[href*="/feed/"], a[href*="/updates/"], a[href*="/in/"]');
      if (linkEl) {
        postUrl = linkEl.href;
      }

      if (authorName || content) {
        results.push({
          datetime,
          timeText,
          authorName,
          authorTitle,
          content: content.substring(0, 1000),
          postUrl
        });
      }
    } catch (e) {}
  });

  // 如果上面的选择器没有找到结果，尝试更通用的方法
  if (results.length === 0) {
    const allLinks = document.querySelectorAll('a[href*="/in/"]');
    const seenAuthors = new Set();

    allLinks.forEach(link => {
      try {
        const href = link.href;
        if (href.includes('/in/') && !seenAuthors.has(href)) {
          seenAuthors.add(href);

          const parent = link.closest('li, div.search-result, div.entity-result, div[class*="result"]');
          if (parent) {
            const authorName = link.textContent.trim();
            const content = parent.textContent.trim().substring(0, 1000);

            // 尝试提取时间
            let timeText = '';
            const timeMatch = parent.textContent.match(/(\\d+\\s*(?:hour|day|week|month)s?\\s*ago|just now|yesterday)/i);
            if (timeMatch) {
              timeText = timeMatch[1];
            }

            if (authorName) {
              results.push({
                datetime: '',
                timeText,
                authorName,
                authorTitle: '',
                content,
                postUrl: href
              });
            }
          }
        }
      } catch (e) {}
    });
  }

  return JSON.stringify(results);
})();
`;

// 滚动脚本
const SCROLL_SCRIPT = `
window.scrollBy(0, 800);
`;

async function main() {
  const keyword = process.argv[2] || 'Touch Care';
  const days = parseInt(process.argv[3], 10) || 30;

  // 编码关键词
  const encodedKeyword = encodeURIComponent(keyword);

  // 构建 LinkedIn 内容搜索 URL
  const url = `https://www.linkedin.com/search/results/content/?keywords=${encodedKeyword}&origin=FACETED_SEARCH&sortBy=%5B%22date_posted%22%5D`;

  console.log('关键词:', keyword);
  console.log('时间范围:', days, '天');
  console.log('URL:', url);
  console.log('');

  await ensureHostBrowserBridge();

  console.log('正在打开页面...');
  const created = await createTarget(url);
  const targetId = created?.targetId || created?.target?.id;

  if (!targetId) {
    console.error('无法创建浏览器 target');
    process.exit(1);
  }

  console.log('Target ID:', targetId);

  try {
    // 等待页面加载
    console.log('等待页面加载...');
    await sleep(6000);

    // 检查是否需要登录
    const pageCheck = await evalScript(targetId, `
      (function() {
        const url = window.location.href;
        const body = document.body.textContent || '';

        // 检查是否在登录页面
        if (url.includes('/login') || url.includes('/authwall') || url.includes('/checkpoint')) {
          return JSON.stringify({ needsLogin: true, url });
        }

        // 检查页面是否有登录提示
        if (body.includes('Sign in') && body.includes('password')) {
          return JSON.stringify({ needsLogin: true, reason: 'login_prompt' });
        }

        return JSON.stringify({ needsLogin: false, url });
      })();
    `);

    console.log('页面检查结果:', pageCheck);

    const checkResult = JSON.parse(pageCheck);
    if (checkResult.needsLogin) {
      console.log('');
      console.log('LinkedIn 需要登录，当前会话无法访问搜索结果。');
      console.log('原因:', checkResult.reason || 'redirected_to_login');
      console.log('');
      console.log('=== 搜索结果 ===');
      console.log('');
      console.log('关键词:', keyword);
      console.log('时间范围: 最近', days, '天');
      console.log('查询地址:', url);
      console.log('');
      console.log('结果概览:');
      console.log('LinkedIn 当前会话需要登录认证，无法获取搜索结果。');
      console.log('');
      process.exit(0);
    }

    let allResults = [];
    const seenUrls = new Set();
    const maxScrolls = 5;

    for (let i = 0; i < maxScrolls; i++) {
      console.log(`提取结果 (滚动 ${i + 1}/${maxScrolls})...`);

      const rawResult = await evalScript(targetId, EXTRACT_LINKEDIN_SCRIPT);
      let items = [];
      try {
        items = JSON.parse(rawResult);
      } catch (e) {
        console.log('解析结果失败，继续...');
      }

      for (const item of items) {
        const key = item.postUrl || item.authorName + item.content.substring(0, 50);
        if (key && !seenUrls.has(key)) {
          seenUrls.add(key);
          allResults.push(item);
        }
      }

      console.log(`当前共收集 ${allResults.length} 条结果`);

      // 滚动加载更多
      await evalScript(targetId, SCROLL_SCRIPT);
      await sleep(2500);
    }

    // 按时间筛选
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    console.log(`\n筛选最近 ${days} 天的结果 (截止日期: ${cutoffDate.toISOString().split('T')[0]})...`);

    const filteredResults = allResults.filter(item => {
      // 如果有时间戳，用它来判断
      if (item.datetime) {
        const itemDate = new Date(item.datetime);
        return itemDate >= cutoffDate;
      }

      // 如果只有相对时间文本，尝试解析
      if (item.timeText) {
        const lowerTime = item.timeText.toLowerCase();
        if (lowerTime.includes('just now') || lowerTime.includes('hour')) {
          return true;
        }
        if (lowerTime.includes('yesterday') || lowerTime.includes('1 day')) {
          return true;
        }
        // 尝试提取数字
        const match = lowerTime.match(/(\d+)\s*(day|week|month)/);
        if (match) {
          const num = parseInt(match[1], 10);
          const unit = match[2];
          if (unit === 'day' && num <= days) return true;
          if (unit === 'week' && num * 7 <= days) return true;
          if (unit === 'month' && num * 30 <= days) return true;
        }
      }

      // 如果无法解析时间，默认保留（因为是按时间排序的搜索结果）
      return true;
    });

    console.log(`筛选后保留 ${filteredResults.length} 条结果\n`);

    // 输出结果
    console.log('=== 搜索结果 ===\n');
    console.log('关键词:', keyword);
    console.log('时间范围: 最近', days, '天');
    console.log('查询地址:', url);
    console.log('');
    console.log('结果总览:');
    console.log(`共收集 ${allResults.length} 条结果，筛选后保留 ${filteredResults.length} 条`);
    console.log('');

    if (filteredResults.length > 0) {
      console.log('结果列表:\n');
      filteredResults.forEach((item, index) => {
        console.log(`${index + 1}. 时间: ${item.datetime || item.timeText || '未知'}`);
        console.log(`   作者: ${item.authorName || '未知'}`);
        if (item.authorTitle) {
          console.log(`   职位: ${item.authorTitle}`);
        }
        console.log(`   内容: ${item.content || '(无内容)'}`);
        console.log(`   链接: ${item.postUrl || '(无链接)'}`);
        console.log('');
      });
    } else {
      console.log('未检索到满足条件的结果。');
    }

  } finally {
    console.log('关闭浏览器 target...');
    await closeTarget(targetId);
  }
}

main().catch(err => {
  console.error('执行失败:', err.message);
  process.exit(1);
});
