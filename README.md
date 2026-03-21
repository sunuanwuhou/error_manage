# 错题管理系统

> 公务员行测备考 · 存量化学习系统  
> 技术方案详见 `docs/spec/技术方案_v7.9.md`  
> 文档导航与阅读顺序详见 `docs/README.md`

## 文档入口

如果你不是直接来跑代码，而是想先快速恢复项目上下文，建议按这个顺序阅读：

1. `docs/README.md`
2. `docs/项目总览与路线图.md`
3. `docs/progress/current_snapshot.md`
4. `AGENTS.md`

按场景找文档：

- 想看项目目标、主闭环和路线图：`docs/项目总览与路线图.md`
- 想看当前最新状态：`docs/progress/current_snapshot.md`
- 想看完整方案：`docs/spec/技术方案_v7.9.md`
- 想看架构专题：`docs/architecture/`
- 想看问题复盘和完成度：`docs/progress/`

## 快速启动（约15分钟）

### 前置要求
- Node.js 18+
- PostgreSQL 15+
- `cloudflared` 可选。
  - 已安装时优先复用系统命令
  - 未安装时，管理员页的 Tunnel 按钮会在支持平台上自动下载官方二进制到项目运行目录，仅用于本机测试外网访问

### 启动步骤

```bash
# 1. 建数据库
psql -U postgres -c "CREATE DATABASE wrongquestion;"

# 2. 安装依赖
npm install && npm install -D tsx

# 3. 配置环境变量
cp .env.local.example .env.local
# 编辑 .env.local，填入 DATABASE_URL 和 NEXTAUTH_SECRET

# 4. 初始化数据库
npm run db:push

# 5. 创建管理员账号
npx tsx scripts/seed-admin.ts
# 默认：admin / changeme123

# 6. 启动
npm run dev
# 访问 http://localhost:3000
```

### E2E 冒烟测试

```bash
# 1. 安装 Playwright 浏览器
npm run test:e2e:install

# 2. 跑前端冒烟
npm run smoke:frontend

# 可选：复用已有服务
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npm run test:e2e
```

默认策略：

- Windows：`npm run smoke:frontend` 默认走 Docker 挂载开发，等价于 `npm run smoke:frontend:docker`
- macOS：`npm run smoke:frontend` 默认走本地进程开发，等价于 `npm run smoke:frontend:local`
- 两种模式都会优先把 E2E 数据库切到本机 `127.0.0.1:5432/wrongquestion`
- 若你的本机数据库账号不是 `postgres/postgres`，请显式设置 `E2E_DATABASE_URL` 和 `E2E_DIRECT_URL`
- 如果暂时不想安装 Playwright 浏览器，可先只跑环境准备：
  - Windows: `npm run smoke:frontend:prepare:docker`
  - macOS: `npm run smoke:frontend:prepare:local`

测试文件统一放在 `tests/e2e/`，当前先提供登录页和根路由的最小烟雾覆盖，后续主流程测试由并行 agent 继续补充。

### 首次登录流程
1. `admin / changeme123` 登录
2. 完成3步设置向导（考试类型 → 目标分 → 每日目标）
3. 进入管理员页面 → 点击"启动 Cloudflare Tunnel"→ 复制域名发手机
4. 录题：错题本 → + 单题 / 批量录
5. 首页看今日任务 → 开始练习

### 本地外网访问

如果你只是想把本机开发环境临时暴露给手机或同事测试，直接用项目内置 Tunnel 即可：

1. 启动本地服务

```bash
npm run dev
```

2. 管理员登录后，进入“管理员页面”
3. 点击顶部 `Cloudflare Tunnel` 的“启动”
4. 等待出现 `trycloudflare.com` 地址，复制后即可外网访问

补充说明：
- 如果机器上没有安装 `cloudflared`，项目会在支持平台上自动下载官方二进制到 `.runtime/cloudflared/`
- 这个地址是临时的，每次重启都可能变化，只适合测试
- Tunnel 启动后，项目会把当前外网地址写入 `.runtime/public-origin.txt`，认证回调会优先跟随这个地址
- 若想手动安装，Mac 仍推荐：`brew install cloudflared`

### Docker 开发挂载 + 自动 Tunnel

如果你在本地通过 Docker 做开发，并希望每次启动自动带一个外网地址：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

这套开发态配置会同时做三件事：

- `app` 使用源码挂载运行 `next dev`
- `db` 启动本地 PostgreSQL + pgvector
- `tunnel` sidecar 自动创建 Cloudflare Quick Tunnel

启动后可从两个位置查看最新地址：

- 登录页顶部的“当前外网地址”
- `.runtime/tunnel-url.txt`
- `.runtime/public-origin.txt`

调试 tunnel：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f tunnel
```

注意：

- 当前默认是 Quick Tunnel，每次重启域名都会变
- 登录页展示的是“当前可分享地址”，不是稳定回调域名
- 若要“外网可登录”长期稳定，仍建议切到 Named Tunnel，并把 `NEXTAUTH_URL` 固定到命名域名

---

## 完整功能清单

### 核心引擎（自动运行，用户无感知）
- mastery 更新算法 · errorROI 排序 · 激活期自动切换
- AI 首次诊断（录题后异步触发，公共解析共享节省成本）
- 记忆锚点生成（首次存量化后异步生成口诀）
- 连续打卡精确计算

### 练习功能
- 快速模式：选答案直接揭晓
- 深度模式：选答案 → 写思路 → AI验证 → 揭晓
- 修正卡渐进隐藏（1-2次完整展示 → 3-4次只看标题 → 5次+自测）
- 四状态机展示（已稳固/冲刺目标/攻坚中/本次跳过）
- 练习结束总结（正确率 · 新增存量化 · 各题型表现）

### 录题功能
- 手动录题（完整表单）
- 批量录题（Tab键切换，10秒/题）

### 进度分析
- 存量底线分 + 增量空间分双条线
- 各题型存量化进度
- 错误陷阱聚合（≥30条数据自动开启）
- 考场答题顺序建议
- 模拟考成绩录入 + 趋势图
- 记忆锚点快速过（考前1小时，5秒/条）

### 系统功能
- 首次登录向导（考试类型/目标分/日期）
- 首页告警（reboundAlert/Day7里程碑/激活期切换/考前48h）
- 管理员账号后台（创建/停用/重置密码）
- Cloudflare Tunnel 一键管理（启动/停止/域名显示）
- 密码修改 · 设置页
- 登录限流（5次/15分钟）

---

## 项目结构（51个源文件）

```
src/
  app/(app)/
    dashboard/        今日任务 + 告警卡片
    practice/         答题 + 练习总结
    errors/           错题本 + 单题录入 + 批量录入
    stats/            进度分析（策略/陷阱/模拟考）
    anchors/          记忆锚点快速过
    mock-tests/       模拟考成绩
    onboarding/       首次登录向导
    settings/         设置 + 修改密码
    admin/users/      管理员后台 + Tunnel控制
  lib/
    mastery-engine    ⭐ 核心算法
    daily-tasks       ⭐ 推题队列
    ai-diagnosis      AI首次诊断
    memory-anchor     记忆锚点生成
    streak            连续打卡
    rate-limit        限流工具
  middleware.ts       登录限流 + 全局鉴权
```

## 数据备份

```bash
pg_dump wrongquestion > backup_$(date +%Y%m%d).sql
# 自动（crontab -e）：
# 0 3 * * * pg_dump wrongquestion > ~/wq_$(date +\%Y\%m\%d).sql
```

## Codex 定时分析

仓库已经有项目侧编排入口，不需要依赖 IDEA 插件自己做后台定时器：

```bash
npm run analysis:autopilot -- --task=user_strategy_refresh --interval-hours=0
```

Windows 下可以直接用：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-analysis-autopilot.ps1
powershell -ExecutionPolicy Bypass -File scripts/register-analysis-autopilot-task.ps1 -EveryMinutes 30
```

能做到的是“项目数据定时分析”；做不到的是“让 IDEA 的 Codex 面板自己脱离项目协议常驻后台跑任务”。
