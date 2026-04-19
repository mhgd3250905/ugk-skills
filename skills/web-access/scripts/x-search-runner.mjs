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

// 提取 X 搜索结果的脚本
const EXTRACT_TWEETS_SCRIPT = `
(function() {
  const results = [];
  const tweets = document.querySelectorAll('article[data-testid="tweet"]');

  tweets.forEach(article => {
    try {
      // 时间
      const timeEl = article.querySelector('time');
      const datetime = timeEl ? timeEl.getAttribute('datetime') : '';
      const timeText = timeEl ? timeEl.textContent : '';

      // 作者账号
      const authorLink = article.querySelector('a[href^="/"]');
      const authorHandle = authorLink ? authorLink.getAttribute('href').replace('/', '') : '';

      // 内容
      const contentEl = article.querySelector('[data-testid="tweetText"]');
      const content = contentEl ? contentEl.textContent : '';

      // 链接
      const tweetLink = article.querySelector('a[href*="/status/"]');
      const tweetHref = tweetLink ? tweetLink.getAttribute('href') : '';
      const tweetUrl = tweetHref ? 'https://x.com' + tweetHref.split('?')[0] : '';

      if (content || authorHandle) {
        results.push({
          datetime,
          timeText,
          authorHandle,
          content: content.substring(0, 500),
          tweetUrl
        });
      }
    } catch (e) {}
  });

  return JSON.stringify(results);
})();
`;

// 滚动脚本
const SCROLL_SCRIPT = `
window.scrollBy(0, 800);
`;

async function main() {
  const keyword = process.argv[2] || 'Medtrum';
  const days = parseInt(process.argv[3], 10) || 30;
  const encodedKeyword = encodeURIComponent(keyword);
  const url = `https://x.com/search?q=${encodedKeyword}&src=typed_query&f=live`;

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
    await sleep(5000);

    let allTweets = [];
    const seenUrls = new Set();
    const maxScrolls = 5;

    for (let i = 0; i < maxScrolls; i++) {
      console.log(`提取结果 (滚动 ${i + 1}/${maxScrolls})...`);

      const rawResult = await evalScript(targetId, EXTRACT_TWEETS_SCRIPT);
      let tweets = [];
      try {
        tweets = JSON.parse(rawResult);
      } catch (e) {
        console.log('解析结果失败，继续...');
      }

      for (const tweet of tweets) {
        if (tweet.tweetUrl && !seenUrls.has(tweet.tweetUrl)) {
          seenUrls.add(tweet.tweetUrl);
          allTweets.push(tweet);
        }
      }

      console.log(`当前共收集 ${allTweets.length} 条推文`);

      // 滚动加载更多
      await evalScript(targetId, SCROLL_SCRIPT);
      await sleep(2000);
    }

    // 按时间筛选
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    console.log(`\n筛选最近 ${days} 天的结果 (截止日期: ${cutoffDate.toISOString().split('T')[0]})...`);

    const filteredTweets = allTweets.filter(tweet => {
      if (!tweet.datetime) return false;
      const tweetDate = new Date(tweet.datetime);
      return tweetDate >= cutoffDate;
    });

    console.log(`筛选后保留 ${filteredTweets.length} 条推文\n`);

    // 输出结果
    console.log('=== 搜索结果 ===\n');
    console.log('关键词:', keyword);
    console.log('时间范围: 最近', days, '天');
    console.log('查询地址:', url);
    console.log('');
    console.log('结果总览:');
    console.log(`共收集 ${allTweets.length} 条推文，筛选后保留 ${filteredTweets.length} 条`);
    console.log('');

    if (filteredTweets.length > 0) {
      console.log('结果列表:\n');
      filteredTweets.forEach((tweet, index) => {
        console.log(`${index + 1}. 时间: ${tweet.datetime || tweet.timeText || '未知'}`);
        console.log(`   账号: @${tweet.authorHandle || '未知'}`);
        console.log(`   内容: ${tweet.content || '(无内容)'}`);
        console.log(`   链接: ${tweet.tweetUrl || '(无链接)'}`);
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
