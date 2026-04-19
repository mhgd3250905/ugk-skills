#!/usr/bin/env node

/**
 * 发现 X 的内部搜索 API
 * 在浏览器中执行搜索并拦截网络请求，找出 GraphQL 端点
 */

import process from 'node:process';
import { requestHostBrowser, ensureHostBrowserBridge } from '../../web-access/scripts/host-bridge.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function browserCommand(command, meta) {
  const result = await requestHostBrowser(command, {
    timeoutMs: 60000,
    meta,
  });
  if (!result?.ok) {
    throw new Error(result?.error || `browser_command_failed:${command.action}`);
  }
  return result;
}

async function main() {
  const keyword = process.argv[2] || 'OpenClaw';
  const searchUrl = `https://x.com/search?q=${encodeURIComponent(keyword)}&src=typed_query&f=live`;

  console.log('=== X 内部 API 发现脚本 ===\n');
  console.log(`搜索 URL: ${searchUrl}\n`);

  await ensureHostBrowserBridge();

  // 创建新页面
  const targetResult = await browserCommand(
    { action: 'new_target', url: 'about:blank' },
    { stage: 'api-discover-start', taskKind: 'x-api-discover' }
  );
  const targetId = targetResult?.target?.id;
  if (!targetId) throw new Error('无法创建浏览器页面');

  try {
    // 注入网络监听脚本
    console.log('1. 注入网络请求监听器...');
    await browserCommand(
      {
        action: 'evaluate',
        targetId,
        expression: `
          window.__xApiRequests = [];
          window.__originalFetch = window.fetch;
          window.__originalXhr = window.XMLHttpRequest.prototype.send;

          // 拦截 fetch
          window.fetch = function(...args) {
            const url = args[0]?.url || args[0];
            if (typeof url === 'string' && url.includes('graphql')) {
              console.log('[FETCH GraphQL]', url);
              window.__xApiRequests.push({
                type: 'fetch',
                url: url,
                timestamp: new Date().toISOString()
              });
            }
            return window.__originalFetch.apply(this, args);
          };

          // 拦截 XMLHttpRequest
          const originalOpen = window.XMLHttpRequest.prototype.open;
          window.XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            this.__url = url;
            return originalOpen.apply(this, [method, url, ...rest]);
          };

          window.XMLHttpRequest.prototype.send = function(body) {
            if (this.__url && this.__url.includes('graphql')) {
              console.log('[XHR GraphQL]', this.__url);
              window.__xApiRequests.push({
                type: 'xhr',
                url: this.__url,
                body: body,
                timestamp: new Date().toISOString()
              });
            }
            return window.__originalXhr.apply(this, arguments);
          };

          'Network interception installed';
        `
      },
      { stage: 'inject-interceptor' }
    );

    // 导航到搜索页
    console.log('2. 导航到 X 搜索页...');
    await browserCommand(
      { action: 'navigate', targetId, url: searchUrl },
      { stage: 'navigate-search', url: searchUrl }
    );

    // 等待页面加载
    console.log('3. 等待页面加载和网络请求...');
    await sleep(8000);

    // 获取捕获的请求
    console.log('4. 获取捕获的 API 请求...');
    const requests = await browserCommand(
      { action: 'evaluate', targetId, expression: 'JSON.stringify(window.__xApiRequests || [])' },
      { stage: 'get-requests' }
    );

    console.log('\n=== 捕获到的 GraphQL 请求 ===');
    if (requests?.value) {
      try {
        const parsed = JSON.parse(requests.value);
        if (parsed.length === 0) {
          console.log('未捕获到 GraphQL 请求，尝试其他方法...');
        } else {
          parsed.forEach((req, i) => {
            console.log(`\n${i + 1}. ${req.type.toUpperCase()}: ${req.url}`);
            if (req.body) {
              console.log(`   Body: ${req.body.substring(0, 200)}...`);
            }
          });
        }
      } catch (e) {
        console.log('解析结果:', requests.value);
      }
    }

    // 尝试从 Performance API 获取
    console.log('\n=== 从 Performance API 获取请求 ===');
    const perfRequests = await browserCommand(
      {
        action: 'evaluate',
        targetId,
        expression: `
          JSON.stringify(
            performance.getEntriesByType('resource')
              .filter(r => r.name.includes('graphql') || r.name.includes('api.x.com'))
              .map(r => r.name)
          )
        `
      },
      { stage: 'get-perf-requests' }
    );

    if (perfRequests?.value) {
      try {
        const parsed = JSON.parse(perfRequests.value);
        console.log('\nGraphQL/API 请求:');
        parsed.forEach((url, i) => {
          console.log(`  ${i + 1}. ${url}`);
        });
      } catch (e) {
        console.log(perfRequests.value);
      }
    }

    // 尝试直接检查 window 对象中的 Twitter 数据
    console.log('\n=== 检查 window.__INITIAL_STATE__ ===');
    const initialState = await browserCommand(
      {
        action: 'evaluate',
        targetId,
        expression: `
          (function() {
            const state = window.__INITIAL_STATE__;
            if (!state) return 'not found';
            const keys = Object.keys(state).slice(0, 20);
            return JSON.stringify({
              found: true,
              keys: keys,
              hasSearch: !!state.search
            });
          })()
        `
      },
      { stage: 'check-initial-state' }
    );
    console.log('Initial State:', initialState?.value);

  } finally {
    await browserCommand(
      { action: 'close_target', targetId },
      { stage: 'cleanup' }
    );
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});