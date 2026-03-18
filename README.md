# 错题管理系统

> 公务员行测备考 · 存量化学习系统  
> 技术方案详见 `docs/技术方案_v7.9.md`

## 快速启动（约15分钟）

### 前置要求
- Node.js 18+
- PostgreSQL 15+
- cloudflared（`brew install cloudflared`，手机访问用）

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

### 首次登录流程
1. `admin / changeme123` 登录
2. 完成3步设置向导（考试类型 → 目标分 → 每日目标）
3. 进入管理员页面 → 点击"启动 Cloudflare Tunnel"→ 复制域名发手机
4. 录题：错题本 → + 单题 / 批量录
5. 首页看今日任务 → 开始练习

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
