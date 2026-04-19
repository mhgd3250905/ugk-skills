---
name: zhihu-tools
description: 当用户要求查询知乎热榜、问题回答、评论、搜索结果、用户信息或专栏文章，并且需要依赖已登录浏览器会话调用站内接口时使用。
---

# 知乎数据查询技能

通过宿主浏览器的登录态，在页面内调用知乎 API 获取结构化数据。

## 触发词

- 知乎热榜、知乎热门、知乎hot
- 知乎问题、知乎回答、知乎评论
- 知乎搜索、知乎用户、知乎专栏
- 查知乎、看知乎、知乎查询

## 可用功能

### 1. 热榜查询
```
知乎热榜
知乎热门
```
返回当前知乎热榜 Top 15-30，包含标题、热度、链接。

### 2. 问题回答查询
```
知乎问题 {questionId}
知乎问题 {url}
知乎回答 {questionId}
```
返回指定问题的回答列表，支持排序：default（默认）、voteups（按赞）、created（按时间）。

### 3. 评论查询
```
知乎评论 {answerId}
知乎评论 {questionId} 的回答
```
返回指定回答的评论列表。

### 4. 搜索
```
知乎搜索 {关键词}
知乎搜 {关键词}
```
搜索知乎内容，返回相关问题和回答。

### 5. 用户信息
```
知乎用户 {userToken}
知乎用户 {url}
```
获取用户基本信息、回答数、文章数等。

### 6. 专栏文章
```
知乎专栏 {articleId}
知乎文章 {url}
```
获取专栏文章内容。

## API 端点总结

| 功能 | API 端点 | 参数 |
|------|---------|------|
| 热榜 | `/api/v3/feed/topstory/hot-lists/total` | 无 |
| 回答 | `/api/v4/questions/{id}/answers` | `limit`, `offset`, `sort_by` |
| 评论 | `/api/v4/answers/{id}/comments` | `limit`, `offset` |
| 搜索 | `/api/v4/search_v3` | `q`, `t`, `limit`, `offset` |
| 用户 | `/api/v4/members/{token}` | 无 |
| 专栏 | `/api/posts/{id}` | 无 |

## 实现原理

知乎 API 需要 Cookie 认证，但 `__zse_ck` cookie 与浏览器会话绑定，无法在外部直接借用。

**解决方案**：通过 CDP 控制宿主浏览器，在页面内执行 fetch 请求，浏览器会自动附加认证信息。

## 数据格式

### 热榜返回格式
```json
{
  "rank": 1,
  "title": "问题标题",
  "excerpt": "摘要",
  "hotValue": "3264万热度",
  "link": "https://www.zhihu.com/question/xxx"
}
```

### 回答返回格式
```json
{
  "id": "answerId",
  "author": {
    "name": "用户名",
    "headline": "简介",
    "avatar_url": "头像"
  },
  "excerpt": "回答摘要",
  "voteup_count": 1234,
  "comment_count": 56,
  "created_time": timestamp,
  "url": "回答链接"
}
```

## 注意事项

1. 需要宿主浏览器已登录知乎
2. 某些 API（如话题）可能需要额外签名，返回 403
3. 专栏文章如果不存在返回 404
4. 所有请求都在页面内执行，浏览器自动处理认证

## 示例

```
用户: 知乎热榜
助手: [返回热榜 Top 15]

用户: 知乎问题 2028861445954125830
助手: [返回该问题的回答列表]

用户: 知乎搜索 人工智能
助手: [返回搜索结果]
```
