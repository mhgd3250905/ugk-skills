---
name: xiaohongshu-tools
description: 当用户要求搜索小红书笔记、查看笔记详情、评论、用户信息或热门推荐，并且需要依赖已登录浏览器会话调用站内接口时使用。
---

# 小红书数据查询技能

通过宿主浏览器的登录态，在页面内调用小红书 API 获取结构化数据。

## 触发词

- 小红书搜索、小红书搜、红书搜索
- 小红书笔记、红书笔记
- 小红书用户、红书用户
- 小红书评论、红书评论
- 小红书热榜、小红书热门
- 查小红书、看小红书

## 可用功能

### 1. 搜索笔记
```
小红书搜索 {关键词}
小红书搜 {关键词}
红书搜 {关键词}
```
搜索小红书笔记，返回标题、摘要、作者、点赞数等。

### 2. 笔记详情
```
小红书笔记 {noteId}
小红书笔记 {url}
```
获取笔记详情，包括正文、图片、标签、互动数据等。

### 3. 笔记评论
```
小红书评论 {noteId}
小红书笔记 {noteId} 的评论
```
获取笔记的评论列表。

### 4. 用户信息
```
小红书用户 {userId}
小红书用户 {url}
```
获取用户基本信息、笔记数、粉丝数等。

### 5. 用户笔记
```
小红书用户 {userId} 的笔记
```
获取用户发布的笔记列表。

### 6. 热门推荐
```
小红书热门
小红书推荐
```
获取首页推荐笔记（需要登录）。

## API 端点总结

| 功能 | API 端点 | 参数 |
|------|---------|------|
| 搜索 | `/api/sns/web/v1/search/notes` | `keyword`, `page`, `page_size` |
| 笔记详情 | `/api/sns/web/v1/feed` | `source_id` |
| 评论 | `/api/sns/web/v2/comment/page` | `note_id`, `cursor` |
| 用户信息 | `/api/sns/web/v1/user/collected` | `user_id` |
| 用户笔记 | `/api/sns/web/v1/user_posted` | `user_id`, `cursor` |
| 首页推荐 | `/api/sns/web/v1/homefeed` | `cursor` |

## 实现原理

小红书 API 需要 Cookie 认证和签名，签名与浏览器会话绑定，无法在外部直接借用。

**解决方案**：通过 CDP 控制宿主浏览器，在页面内执行 fetch 请求，浏览器会自动附加认证信息和签名。

## 数据格式

### 搜索返回格式
```json
{
  "id": "noteId",
  "title": "笔记标题",
  "desc": "笔记描述",
  "author": {
    "nickname": "用户昵称",
    "userId": "用户ID"
  },
  "interactInfo": {
    "likeCount": 1234,
    "collectCount": 567,
    "commentCount": 89
  },
  "cover": "封面图URL",
  "link": "笔记链接"
}
```

### 用户返回格式
```json
{
  "userId": "用户ID",
  "nickname": "昵称",
  "desc": "简介",
  "avatar": "头像URL",
  "notes": 100,
  "fans": 5000,
  "follows": 200
}
```

## 注意事项

1. **需要宿主浏览器已登录小红书**，否则 API 会返回 401 或空数据
2. 小红书 API 有签名校验，必须通过浏览器页面内 fetch
3. 部分接口可能有请求频率限制
4. 笔记 ID 可以从 URL 中提取：`xiaohongshu.com/explore/{noteId}`
5. 用户 ID 可以从 URL 中提取：`xiaohongshu.com/user/profile/{userId}`

## 示例

```
用户: 小红书搜索 人工智能
助手: [返回相关笔记列表]

用户: 小红书笔记 65abc123def
助手: [返回笔记详情]

用户: 小红书用户 https://www.xiaohongshu.com/user/profile/abc123
助手: [返回用户信息]

用户: 小红书热门
助手: [返回首页推荐笔记]
```
