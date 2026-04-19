---
name: x-search-latest
description: 仅在用户显式输入 `/x-search-latest:关键词[:天数]` 时使用。不要从自然语言问题中猜测触发。该技能只负责在 X 的 Latest 搜索页按关键词查询，并筛选最近 N 天内的结果。
allowed-tools: Bash
---

# x-search-latest

这个技能只允许显式触发。只有当用户消息直接以下列格式开头时使用：

- `/x-search-latest:关键词`
- `/x-search-latest:关键词:天数`

默认天数是 `30`。如果关键词为空或天数不是正整数，停止并返回正确用法，不要猜。

## Browser Readiness

开始前必须执行：

```bash
node /app/runtime/skills-user/web-access/scripts/check-deps.mjs
```

如果在 Windows 项目目录调试，使用：

```bash
node runtime/skills-user/web-access/scripts/check-deps.mjs
```

可继续的条件：

- `host-browser: ok`
- `proxy: ready`

注意：在 Docker sidecar 模式下，`host-browser: ok` 是兼容旧脚本的输出标签，实际含义是 `WEB_ACCESS_BROWSER_PROVIDER=direct_cdp` 已经连到 Chrome sidecar，不代表走 Windows 宿主 IPC。

如果检查失败，优先运行：

```bash
npm run docker:chrome:check
```

需要重启 sidecar Chrome 时才运行：

```bash
npm run docker:chrome:restart
```

不要在 Docker sidecar 模式下提示用户启动 Windows host IPC launcher。那是 legacy fallback，不是当前默认路径。

## Execution

必须统一调用脚本：

```bash
node /app/runtime/skills-user/x-search-latest/scripts/x_search_latest.mjs \
  --keyword "<keyword>" \
  --days "<days>"
```

如果在 Windows 项目目录调试，使用：

```bash
node runtime/skills-user/x-search-latest/scripts/x_search_latest.mjs \
  --keyword "<keyword>" \
  --days "<days>"
```

不要自己临时拼 `curl http://127.0.0.1:9222/json/new?...`，不要裸调 CDP，不要手工打开共享页面。

脚本负责：

1. 正确编码关键词
2. 组装 `https://x.com/search?q=<ENCODED_KEYWORD>&src=typed_query&f=live`
3. 打开受控 browser target
4. 提取当前可见结果并按需滚动
5. 只保留最近 N 天内、明确相关的结果
6. 在 `finally` 中关闭自己创建的 target

## Output

结果尽量保留完整信息：

- 时间
- 作者或账号
- 原始文本摘要
- 原始链接
- 关键词是否明确匹配

如果没有结果，不要编造。直接说明关键词、时间范围、最终 URL、以及未检索到满足条件的结果。

## Wrong Practices

- 从自然语言问题自动触发本技能
- 改写用户显式提供的关键词
- 手写近似 URL 编码
- 用 WebSearch 替代真实 X 页面
- 绕过脚本自己开页
- 不关闭自己创建的 target
- 在 Docker sidecar 模式下引导用户启动 Windows host IPC bridge
