---
name: x-search-latest
description: 仅在用户显式输入 `/x-search-latest:关键词[:天数]` 时使用。不要自动触发，不要从自然语言问题中猜测触发。这个技能只负责在 X 的 Latest 搜索页按关键词做定向查询，并筛选最近 N 天内的结果直接返回给用户。
allowed-tools: Bash
---

# x-search-latest

这是一个只允许显式触发的系统级技能。

只在用户消息**直接以**下面格式开头时使用：

- `/x-search-latest:关键词`
- `/x-search-latest:关键词:天数`

默认天数为 `30`。

除了这两种格式，其他任何自然语言提问都**不要自动触发**本技能。

## 职责边界

这个技能只负责：

1. 解析显式命令中的关键词和时间范围
2. 正确编码关键词并组装 X Latest 搜索地址
3. 访问 X 搜索页并提取结果
4. 只保留最近 N 天内的结果
5. 把查询结果直接返回给用户

这个技能不负责：

- 自动触发
- 生成邮件
- 生成固定文件
- 多平台汇总
- 把关键词扩展成其他同义词包

## 输入格式

从用户原文中解析：

- `keyword`: `/x-search-latest:` 后面的关键词
- `days`: 最后一个 `:天数`，如果没有则默认 `30`

示例：

- `/x-search-latest:移宇`
  - `keyword = 移宇`
  - `days = 30`

- `/x-search-latest:移宇:30`
  - `keyword = 移宇`
  - `days = 30`

- `/x-search-latest:Touch Care:14`
  - `keyword = Touch Care`
  - `days = 14`

如果关键词为空、天数不是正整数，停止并返回正确用法，不要猜。

## URL 组装规则

基础地址固定为：

`https://x.com/search`

查询参数固定为：

- `q=<encodeURIComponent(keyword)>`
- `src=typed_query`
- `f=live`

最终地址格式固定为：

`https://x.com/search?q=<ENCODED_KEYWORD>&src=typed_query&f=live`

必须正确处理编码：

- `Touch Care` -> `Touch%20Care`
- `移宇` -> `%E7%A7%BB%E5%AE%87`

不要手写近似编码，不要保留空格，不要输出未编码的中文 URL。

## 前置依赖

开始前必须执行：

```bash
node "/home/node/.claude/skills/web-access/scripts/check-deps.mjs"
```

只有当结果同时表明以下两项可用时才能继续：

- `host-browser: ok`
- `proxy: ready`

否则直接报告浏览器桥接不可用，不要继续。

## 浏览器执行要求

不要自己临时拼 `curl http://127.0.0.1:9222/json/new?...` 或裸调 CDP。

必须统一调用仓库内脚本：

```bash
node "/home/node/.claude/skills/x-search-latest/scripts/x_search_latest.mjs" \
  --keyword "<keyword>" \
  --days "<days>"
```

脚本会负责：

1. 打开受管 target
2. 访问组装后的最终 URL
3. 等待页面稳定
4. 提取当前页面可见结果
5. 必要时向下滚动并继续提取
6. 只保留最近 N 天内的结果
7. 返回最终筛选后的全部结果
8. 在 `finally` 中关闭自己创建的 target

不要绕过脚本再自己开页，否则很容易留下宿主无法自动回收的残留页面。

## 结果筛选要求

结果必须尽量保留完整，不要过度总结成一句话。

每条结果尽量包含：

- 时间
- 作者或账号
- 原始文本摘要
- 原始链接
- 是否明确匹配关键词

筛选原则：

1. 优先保留明确包含关键词的结果
2. 只保留最近 `days` 天内的结果
3. 如果时间无法可靠解析，明确标注“时间未完整解析”
4. 不要把明显无关结果硬塞进去

如果没有结果，不要编造，直接明确说明：

- 查询关键词
- 时间范围
- 最终 URL
- 未检索到满足条件的结果

## 输出格式

默认直接回复用户，结构如下：

```text
X Latest 查询结果
关键词：<keyword>
时间范围：最近 <days> 天
查询地址：<final_url>

结果概览：
<命中数量、整体说明>

结果列表：
1. 时间：...
   账号：...
   内容：...
   链接：...
   关键词匹配：...

2. ...
```

如果没有结果：

```text
X Latest 查询结果
关键词：<keyword>
时间范围：最近 <days> 天
查询地址：<final_url>

结果概览：
未检索到满足条件的结果。
```

## 推荐执行方式

如果你需要显式演示执行过程，使用下面这条命令，不要自己改成其他浏览器调用方式：

```bash
node "/home/node/.claude/skills/x-search-latest/scripts/x_search_latest.mjs" \
  --keyword "<keyword>" \
  --days "<days>"
```

## 错误做法

以下行为视为错误：

- 从自然语言问题自动触发本技能
- 改写用户显式提供的关键词
- 把 `Touch Care` 错写成未编码空格 URL
- 把 `移宇` 直接塞进未编码 URL
- 用 WebSearch 代替真实 X 页面
- 只返回一句“查到了/没查到”而不给结果内容
- 不关闭自己创建的 target
