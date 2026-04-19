---
name: ins-search-latest
description: 仅在用户显式输入 `/ins-search-latest:关键词[:天数]` 时使用。不要从自然语言问题中猜测触发。该技能只负责在 Instagram 站内按关键词查询，并筛选最近 N 天内的相关帖子。
allowed-tools: Bash
---

# ins-search-latest

这个技能只允许显式触发。只有当用户消息直接以下列格式开头时使用：

- `/ins-search-latest:关键词`
- `/ins-search-latest:关键词:天数`

默认天数是 `30`，最大按 `90` 天执行。如果关键词为空或天数不是正整数，停止并返回正确用法。

## Browser Readiness

开始前必须执行：

```bash
node /app/runtime/skills-user/web-access/scripts/check-deps.mjs
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

必须调用脚本：

```bash
node "/app/runtime/skills-user/ins-search-latest/scripts/ins_search_latest.mjs" --keyword "<KEYWORD>" --days <DAYS>
```

规则：

1. 关键词必须原样传给脚本，不要自行扩词
2. 天数必须传解析后的正整数
3. 优先直接返回脚本输出，不要再加工成废话套话
4. 主输出只保留时间、作者、标题、正文、点赞数、评论数、链接
5. 不要补热评，也不要把评论区内容混成正文

脚本会打开 Instagram 搜索页，复用登录态，收集候选帖子详情，并按最近 N 天与相关性筛选。

## Output

默认直接回复用户：

```text
Instagram Latest 查询结果
关键词：<keyword>
时间范围：最近 <days> 天
查询地址：<final_url>

结果概览：<命中数量与整体说明>

结果列表：
1. 时间：...
   作者：...
   标题：...
   正文：...
   点赞数：...
   评论数：...
   匹配依据：...
   链接：...
```

如果没有结果，不要编造，明确说明未检索到满足条件的结果。

## Wrong Practices

- 从自然语言问题自动触发本技能
- 私自扩词或改写用户关键词
- 把列表页时间当成绝对可靠来源
- 把评论区内容混成正文
- 只返回“查到了/没查到”，不给正文和链接
- 在 Docker sidecar 模式下引导用户启动 Windows host IPC bridge
