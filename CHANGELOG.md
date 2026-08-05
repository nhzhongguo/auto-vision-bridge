# Changelog

## [1.2.2] - 2026-08-05

### Fixed

- 修复 `scripts/install-skill.mjs` 被错误保存为字面量换行，导致仓库拉取后“一键部署”实际不执行的问题。
- 修复 `--yes` 误退出和覆盖安装删除本地 `scripts/config.json` 的问题；更新技能代码时保留本机配置。

### Added

- 一键安装支持 `--provider`、`--model` 预选参数，AI 只需向用户确认视觉服务商、视觉模型和 API Key。
- `setup.mjs` 增加 `--skill`、`--skip-test`、`--bridge`、`--no-bridge` 和帮助信息。
- 体检不再显示 API Key 的首尾片段。
- README 增加客户一键部署、配置文件位置和 CC Switch 故障排查说明。

## [1.2.1] - 2026-08-04

### Fixed

- 修复 Codex + CC Switch 场景下切换供应商覆盖 `base_url` 后，图片在到达 Vision Bridge 前被 `15721` 直接拒绝的问题。
- Bridge 启动时自动把 Codex `base_url` 接到 `57399`，并监听/轮询 `config.toml`，在 CC Switch 改写后自动恢复。
- 增加 Codex 配置替换守卫测试，保留原引号和行尾注释，不记录原始地址或密钥。

### Docs

- 更新中英文 README 与 AI 部署说明，明确 `57399 → 15721 → 上游` 路由、切换供应商可能导致会话断开，以及视觉模型的计费风险。

## [1.2.0] - 2026-08-04

### Added

- 内置视觉模型服务商与模型目录，只展示明确支持图片输入的模型。
- 展示免费、可能计费、价格未知等计费风险。
- 新增 `scripts/uninstall.mjs` 安全一键卸载与还原流程。
- 支持用户在当前对话发送“我要卸载”“卸载视觉”等明确请求触发卸载流程。

### Changed

- 配置向导不再拿纯文本模型反复试错。
- 付费或价格未知模型默认跳过联网测试，确认承担费用后才可使用 `--force` 测试。
- 安装、部署文档和示例配置同步到 1.2.0。

### Safety

- 卸载前只停止能通过 `/health` 确认属于 Auto Vision Bridge 的 bridge。
- 修改 Codex `config.toml` 前自动生成备份。
- 已安装技能移动到卸载备份目录，不直接永久删除。
- API Key 仅保留在本机未跟踪配置文件中。
