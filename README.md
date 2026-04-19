# UGK Skills

可独立发布的 UGK skills 仓库。

当前已包含：

- `send-email`

## 仓库结构

```text
skills/
  send-email/
    SKILL.md
    config.example.json
    scripts/
    tests/
```

## 使用方式

每个 skill 都放在 `skills/<skill-name>/` 下，尽量保持：

- `SKILL.md`：skill 说明与触发方式
- `config.example.json`：示例配置
- `scripts/`：脚本实现
- `tests/`：最小测试

## 当前 skill

### send-email

通过 SMTP 发送邮件，支持：

- 纯文本邮件
- HTML 邮件
- 抄送 / 密送
- 附件

具体说明见 [skills/send-email/SKILL.md](skills/send-email/SKILL.md)。

## 安全说明

- 真实配置文件 `config.json` 不应提交到仓库
- 邮箱授权码 / SMTP 密码只应保存在本地私有配置中

## License

MIT
