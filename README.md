# UGK Skills

UGK 的可复用独立技能仓库。

这个仓库用于承载可以单独发布、复用和维护的 skills，不再把所有技能死绑在主应用仓库里。当前已经收录邮件发送技能和一组显式触发的 Latest 检索技能，后续也会继续扩充。

## 当前技能

### `send-email`

基于 SMTP 的邮件发送技能，支持：

- 纯文本邮件
- HTML 邮件
- 抄送 / 密送
- 附件
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

## 仓库结构

```text
skills/
  send-email/
    SKILL.md
    config.example.json
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
```

## 组织规则

每个 skill 统一放在 `skills/<skill-name>/` 下，并尽量保持以下结构：

- `SKILL.md`：技能说明与触发规则
- `config.example.json`：可共享的示例配置
- `scripts/`：脚本实现
- `tests/`：最小验证测试

## 安全说明

- 不要把真实 `config.json` 提交到仓库
- 不要把 SMTP 密码、授权码、API Key 等私密信息提交到仓库
- 敏感配置只应保存在本地私有文件中

## 后续方向

这个仓库的目标不是只放一个 `send-email`，而是逐步沉淀成 UGK 的共享技能仓库。

## License

MIT
