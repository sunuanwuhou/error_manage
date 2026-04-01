# error_manage rules integration patch

这是一个基于 `sunuanwuhou/error_manage` 仓库结构准备的覆盖式 patch 包。

## 作用
- 固化开发铁规
- 固化主链映射模板
- 固化提交前检查清单
- 增加本地 pre-push 门禁
- 增加 GitHub Actions 质量门禁
- 增加 PR 模板，防止提交描述失真

## 使用方式
将本包解压到仓库根目录后执行：

```bash
chmod +x .githooks/pre-push scripts/setup-githooks.sh
./scripts/setup-githooks.sh
```

然后本地验证：

```bash
npm run typecheck
npm run smoke:backend
```
