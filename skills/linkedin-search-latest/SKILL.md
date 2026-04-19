---
name: linkedin-search-latest
description: 仅在用户显式输入 `/linkedin-search-latest:关键词[:天数]` 时使用。不要从自然语言问题中猜测触发。该技能只负责在 LinkedIn 内容搜索页按关键词查询，并筛选最近 N 天内的结果。
allowed-tools: Bash
---

# linkedin-search-latest

这个技能只允许显式触发。只有当用户消息直接以下列格式开头时使用：

- `/linkedin-search-latest:关键词`
- `/linkedin-search-latest:关键词:天数`

默认天数是 `30`。如果关键词为空或天数不是正整数，停止并返回正确用法。

## Browser Readiness

开始前必须执行：

```bash
node "/app/runtime/skills-user/web-access/scripts/check-deps.mjs"
```

可继续的条件：

- `host-browser: ok`
- `proxy: ready`

在 Docker sidecar 模式下，`host-browser: ok` 表示 `WEB_ACCESS_BROWSER_PROVIDER=direct_cdp` 已经连到 Chrome sidecar。这个标签只是兼容旧脚本，不代表使用 Windows 宿主 IPC。

如果检查失败，优先运行：

```bash
npm run docker:chrome:check
```

不要在 Docker sidecar 模式下引导用户启动 Windows host IPC bridge。

## Execution

必须统一调用技能目录内脚本：

```bash
node "/app/runtime/skills-user/linkedin-search-latest/scripts/linkedin_search_latest.mjs" \
  --keyword "<keyword>" \
  --days "<days>"
```

不要自己临时拼 CDP URL，不要用 WebSearch 替代真实 LinkedIn 页面，不要绕过脚本打开共享页面。

脚本负责：

1. 正确编码关键词
2. 组装 LinkedIn 内容搜索 URL
3. 打开受控 target
4. 等待页面稳定
5. 提取可见结果并按需滚动
6. 保留最近 N 天内的结果
7. 在 `finally` 中关闭自己创建的 target

如果 LinkedIn 要求登录、跳转登录页、或结果页不可见，不要编造结果，直接说明当前会话中 LinkedIn 搜索不可用。

## Output

结果尽量保留完整信息：

- 时间
- 作者或账号
- 原始文本摘要
- 原始链接
- 是否明确匹配关键词

如果没有结果，不要编造。说明关键词、时间范围、最终 URL、以及未检索到满足条件的结果。

## Wrong Practices

- 从自然语言问题自动触发本技能
- 改写用户显式提供的关键词
- 用 WebSearch 替代真实 LinkedIn 页面
- 在登录不可用时编造搜索结果
- 不关闭自己创建的 target
- 在 Docker sidecar 模式下引导用户启动 Windows host IPC bridge
