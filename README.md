# UGK Skills

UGK 的可复用独立技能仓库。

这个仓库用于承载可以单独发布、复用和维护的 skills，不再把所有技能死绑在主应用仓库里。当前已收录 `send-email`，后续也会持续加入更多技能。

## 当前技能

### `send-email`

一个基于 SMTP 的邮件发送技能，支持：

- 纯文本邮件
- HTML 邮件
- 抄送 / 密送
- 附件
- 通过本地 `config.json` 读取私有配置

具体用法见 [skills/send-email/SKILL.md](skills/send-email/SKILL.md)。

## 仓库结构

```text
skills/
  send-email/
    SKILL.md
    config.example.json
    scripts/
    tests/
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
