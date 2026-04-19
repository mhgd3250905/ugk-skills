# UGK Skills

UGK 的可复用独立技能仓库。

这个仓库用于承载可以单独发布、复用和维护的 skills，不再把所有技能死绑在主应用仓库里。当前已经收录邮件发送技能、一组显式触发的 Latest 检索技能、真实浏览器访问技能，以及站内数据查询技能，后续也会继续扩充。

## 当前技能

### `send-email`

基于 SMTP 的邮件发送技能，支持：

- 纯文本邮件
- HTML 邮件
- 抄送 / 密送
- 附件
- Node.js / Python 两种脚本入口
- 通过本地 `config.json` 读取私有配置

具体用法见 [skills/send-email/SKILL.md](skills/send-email/SKILL.md)。

### Latest 检索技能

以下技能都属于“只允许显式命令触发”的定向检索技能：

- [x-search-latest](skills/x-search-latest/SKILL.md)
  - 触发格式：`/x-search-latest:关键词[:天数]`
  - 在 X 的 Latest 搜索页按关键词筛选最近 N 天结果
- [linkedin-search-latest](skills/linkedin-search-latest/SKILL.md)
  - 触发格式：`/linkedin-search-latest:关键词[:天数]`
  - 在 LinkedIn 内容搜索页筛选最近 N 天结果
- [reddit-search-latest](skills/reddit-search-latest/SKILL.md)
  - 触发格式：`/reddit-search-latest:关键词[:天数]`
  - 通过 Reddit 搜索接口筛选最近 N 天帖子
- [tiktok-search-latest](skills/tiktok-search-latest/SKILL.md)
  - 触发格式：`/tiktok-search-latest:关键词[:天数]`
  - 在 TikTok 搜索结果中提取最近 N 天的强相关内容
- [ins-search-latest](skills/ins-search-latest/SKILL.md)
  - 触发格式：`/ins-search-latest:关键词[:天数]`
  - 在 Instagram 站内检索最近 N 天相关帖子

### `web-access`

统一的真实浏览器访问技能，用于：

- 动态页面访问
- 登录态网站操作
- 社交平台内容抓取
- 截图、下载与浏览器自动化
- Docker Chrome sidecar / legacy host IPC 桥接

具体用法见 [skills/web-access/SKILL.md](skills/web-access/SKILL.md)。

### 站内数据查询技能

- [xiaohongshu-tools](skills/xiaohongshu-tools/SKILL.md)
  - 通过浏览器登录态调用小红书页面内 API，支持搜索、笔记详情、评论、用户信息和热门推荐
- [zhihu-tools](skills/zhihu-tools/SKILL.md)
  - 通过浏览器登录态调用知乎页面内 API，支持热榜、问题回答、评论、搜索、用户信息和专栏文章

## 仓库结构

```text
skills/
  send-email/
    SKILL.md
    config.example.json
    package.json
    package-lock.json
    scripts/
    tests/
  x-search-latest/
    SKILL.md
    scripts/
  linkedin-search-latest/
    SKILL.md
    scripts/
  reddit-search-latest/
    SKILL.md
    scripts/
  tiktok-search-latest/
    SKILL.md
    scripts/
  ins-search-latest/
    SKILL.md
    scripts/
  web-access/
    SKILL.md
    scripts/
  xiaohongshu-tools/
    SKILL.md
    scripts/
  zhihu-tools/
    SKILL.md
    scripts/
```

## 组织规则

每个 skill 统一放在 `skills/<skill-name>/` 下，并尽量保持以下结构：

- `SKILL.md`：技能说明与触发规则
- `config.example.json`：可共享的示例配置
- `package.json` / `package-lock.json`：Node.js 技能依赖定义
- `scripts/`：脚本实现
- `tests/`：最小验证测试

## 安全说明

- 不要把真实 `config.json` 提交到仓库
- 不要把 `node_modules` 之类的依赖缓存提交到仓库
- 不要把 SMTP 密码、授权码、API Key 等私密信息提交到仓库
- 敏感配置只应保存在本地私有文件中

## 后续方向

这个仓库的目标不是只放一个 `send-email`，而是逐步沉淀成 UGK 的共享技能仓库。

## License

MIT
