---
name: tiktok-search-latest
description: 仅在用户显式输入 `/tiktok-search-latest:关键词[:天数]` 时使用。不要自动触发，不要从自然语言问题中猜测触发。这个技能只负责在 TikTok 搜索页按关键词做定向查询，并筛选最近 N 天内的强相关结果直接返回给用户；标题、内容、时间、作者和互动数是主输出。
allowed-tools: Bash
---

# tiktok-search-latest

这是一个只允许显式触发的系统级技能。
只在用户消息直接以下面格式开头时使用：
- `/tiktok-search-latest:关键词`
- `/tiktok-search-latest:关键词:天数`

默认天数是 `30`。
除了这两种格式，其他任何自然语言提问都不要自动触发本技能。

## 职责边界

这个技能只负责：
1. 解析显式命令中的关键词和时间范围
2. 组装 TikTok 搜索页 URL
3. 复用已登录的宿主 Chrome 搜索 TikTok
4. 提取最近 N 天内的强相关结果
5. 直接返回标题、内容、时间、作者、点赞数、评论数、链接

这个技能不负责：
- 自动触发
- 生成固定文件
- 邮件汇总
- 多平台聚合
- 把弱相关结果硬说成命中

## 输入格式

从用户原文中解析：
- `keyword`: `/tiktok-search-latest:` 后面的关键词
- `days`: 最后一段 `:天数`，如果没有则默认 `30`

示例：
- `/tiktok-search-latest:Medtrum`
- `/tiktok-search-latest:Touch Care:14`
- `/tiktok-search-latest:移宇:30`

如果关键词为空、天数不是正整数，停止并返回正确用法，不要猜。

## 执行要求

必须调用脚本：

```bash
node "/home/node/.claude/skills/tiktok-search-latest/scripts/tiktok_search_latest.mjs" --keyword "<KEYWORD>" --days <DAYS>
```

规则：
1. 关键词必须原样传给脚本，不要自行扩词
2. 天数必须传解析后的正整数
3. 优先直接返回脚本输出，不要再二次加工成表格腔废话
4. 标题、内容、时间、作者、点赞数、评论数、链接是主输出
5. 不要把 TikTok 默认排序中明显弱相关的内容硬塞进最终结果

## 查询与过滤原则

脚本会：
1. 打开 `https://www.tiktok.com/search?q=<关键词编码>` 搜索页
2. 复用页面真实产生的 `/api/search/general/full/` 已签名请求 URL
3. 重新取回搜索 JSON
4. 对结果做最近 N 天过滤
5. 对结果做强关键词匹配过滤
6. 按时间倒序返回

注意：
- TikTok 默认搜索结果掺水很重，时间近不代表相关；必须保留强匹配过滤
- 互动数可以直接取视频 stats

## 输出格式

默认直接回复用户，结构如下：

```text
TikTok Latest 查询结果
关键词：<keyword>
时间范围：最近 <days> 天
查询地址：<final_url>

结果概览：<命中数量与整体说明>

结果列表：
1. 时间：...
   账号：...
   标题：...
   内容：...
   点赞数：...
   评论数：...
   匹配依据：...
   链接：...
```

如果没有结果：

```text
TikTok Latest 查询结果
关键词：<keyword>
时间范围：最近 <days> 天
查询地址：<final_url>

结果概览：未检索到最近 <days> 天内的强相关结果
结果列表：未检索到满足条件的结果。
```

## 错误做法

以下行为视为错误：
- 从自然语言问题自动触发本技能
- 把 TikTok 默认搜索页里弱相关结果硬塞进最终输出
- 把脚本原始结果改成低信息密度表格
- 只返回“查到了/没查到”，不给标题和内容
