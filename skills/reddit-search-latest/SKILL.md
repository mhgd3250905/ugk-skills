---
name: reddit-search-latest
description: 仅在用户显式输入 `/reddit-search-latest:关键词[:天数]` 时使用。不要自动触发，不要从自然语言问题中猜测触发。这个技能只负责按关键词查询 Reddit 最新帖子，并筛选最近 N 天内的结果直接返回给用户；适用于显式命令式 Reddit 定向查询。
---

# reddit-search-latest

这是一个只允许显式触发的系统级技能。
只在用户消息直接以下面格式开头时使用：
- `/reddit-search-latest:关键词`
- `/reddit-search-latest:关键词:天数`

默认天数是 `30`。
除了这两种格式，其他任何自然语言提问都不要自动触发本技能。

## 职责边界

这个技能只负责：
1. 解析显式命令中的关键词和时间范围
2. 通过 Reddit 公开 JSON 搜索接口查询最新帖子
3. 对结果做最近 N 天的本地时间过滤
4. 把筛选后的结果直接返回给用户

这个技能不负责：
- 自动触发
- 生成固定文件
- 汇总成邮件
- 自动扩展关键词为同义词
- 把 Reddit 查询替换成别的平台

## 输入格式

从用户原文中解析：
- `keyword`: `/reddit-search-latest:` 后面的关键词
- `days`: 最后一段 `:天数`，如果没有则默认 `30`

示例：
- `/reddit-search-latest:移宇`
  - `keyword = 移宇`
  - `days = 30`

- `/reddit-search-latest:移宇:30`
  - `keyword = 移宇`
  - `days = 30`

- `/reddit-search-latest:Touch Care:14`
  - `keyword = Touch Care`
  - `days = 14`

如果关键词为空、天数不是正整数，停止并返回正确用法，不要猜。

## 执行要求

必须调用脚本：

```bash
python3 "/app/runtime/skills-user/reddit-search-latest/scripts/reddit_search_latest.py" --keyword "<KEYWORD>" --days <DAYS>
```

规则：
1. 关键词必须原样传给脚本，不要自行改写
2. 天数必须传解析后的正整数
3. 优先直接返回脚本输出，不要再二次改写成表格、摘要模板或自创格式
4. 如果脚本返回“未检索到满足条件的结果”，照实返回，不要编造
5. 如果脚本已经给出结果列表，不要擅自删减条目，不要把“最近 30 天”改写成别的结论

## 查询与过滤规则

脚本会：
1. 使用 Reddit 搜索接口按 `new` 排序查询
2. 根据天数选择最接近的 Reddit 原生时间桶
3. 再按帖子 `created_utc` 做本地精确过滤，确保真的是最近 N 天

这意味着：
- `:30` 不是装样子，是真的按最近 30 天过滤
- `Touch Care` 之类带空格关键词会正确编码
- 中文关键词也会正确编码

## 输出格式

默认直接回复用户，结构如下：

```text
Reddit Latest 查询结果
关键词：<keyword>
时间范围：最近 <days> 天
查询地址：<final_url>

结果概览：<命中数量与整体说明>

结果列表：
1. 时间：...
   子版块：...
   作者：...
   标题：...
   内容摘要：...
   评分：...
   评论数：...
   链接：...
```

如果没有结果：

```text
Reddit Latest 查询结果
关键词：<keyword>
时间范围：最近 <days> 天
查询地址：<final_url>

结果概览：未检索到满足条件的结果。
```

## 错误做法

以下行为视为错误：
- 从自然语言问题自动触发本技能
- 改写用户显式提供的关键词
- 把自定义天数假装成精确过滤，实际上只用 Reddit 固定桶不做本地过滤
- 把脚本原始结果改写成看似漂亮但信息失真的表格或摘要
- 只返回“查到了/没查到”而不提供结果内容
- 在脚本失败时编造 Reddit 结果
