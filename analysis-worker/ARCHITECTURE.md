# 分析服务架构设计

> 状态：早期设计稿，保留作历史背景参考
> 当前执行口径请优先查看 `docs/architecture/Codex高频分析执行方案.md` 与 `docs/architecture/Codex分析执行手册.md`

---

## 核心思路

错题系统（主项目）和分析服务共享同一个 PostgreSQL，分析服务直接读写 DB，不需要经过主项目 API。**零通信成本，完全解耦。**

```
wrongquestion/
├── src/                    # 主项目 (Next.js, port 3000)
└── analysis-worker/        # 分析服务 (独立进程, 共享DB)
```

---

## 触发方式

**方式A：定时任务**
```bash
# crontab -e
0 3 * * * tsx analysis-worker/src/index.ts --task=errors
```

**方式B：手动触发（先做这个）**
```bash
node analysis-worker/src/index.ts --task=errors
node analysis-worker/src/index.ts --task=progress
node analysis-worker/src/index.ts --task=patterns
node analysis-worker/src/index.ts --task=strategy
```

**方式C：文件系统 watch（开发时）**
```bash
tsx watch analysis-worker/src/index.ts
# 检测到 DB 有新错题 → 自动触发
```

---

## 分析任务清单

| Task | 读什么 | 分析什么 | 写回哪里 |
|------|--------|---------|---------|
| `errors` | 最近30条错题 + aiReasonTag | 找系统性错误模式，生成专项规律 | `KnowledgeEntry` |
| `progress` | UserSectionStats + masteryHistory | 当前进度瓶颈在哪，今后2周重点攻什么 | `KnowledgeEntry` (type=strategy) |
| `patterns` | 所有 isHot 错题 | 这批题有什么共同思维盲点 | `UserInsight` |
| `strategy` | daysToExam + stockifiedRate | 生成考前定制化备考建议 | `KnowledgeEntry` (type=exam_advice) |
| `knowledge_feed` | 高分错题（mastery从低到高的典型题） | 提取解法模式喂进知识库 | `KnowledgeEntry` |

---

## 核心数据流

```typescript
async function runTask(taskName: string) {

  // 1. 从 DB 读数据
  const data = await prisma.userError.findMany({ ... })

  // 2. 从知识库读已有沉淀（让 Claude 知道上次分析了什么）
  const existingKnowledge = await prisma.$queryRaw`
    SELECT methodName, solutionSteps, qualityScore
    FROM knowledge_entries
    WHERE questionType = ${type}
    ORDER BY usageCount DESC LIMIT 5
  `

  // 3. 构建 prompt（包含已有知识库摘要）
  const prompt = buildPrompt(data, existingKnowledge)

  // 4. 调用 Claude（用 @anthropic-ai/sdk，复用 ANTHROPIC_API_KEY）
  const result = await claude.messages.create({
    model: 'claude-opus-4-5',  // 分析用 Opus，质量最高
    messages: [{ role: 'user', content: prompt }]
  })

  // 5. 解析 JSON 结果写回 DB
  await prisma.knowledgeEntry.create({ data: parsed })
}
```

---

## 知识积累飞轮（最重要的设计）

每次分析都读取上一次的结论，形成持续进化的上下文。

```
第1次分析：
  输入：错题原始数据
  输出：发现"充分必要条件方向记反"是主要错误
  写入：KnowledgeEntry { methodName: "充分必要方向口诀" }

第2次分析（一周后）：
  输入：新的错题数据 + "上次发现了充分必要方向问题"
  输出：发现经过练习已改善，但"削弱题"新出现了问题
  写入：KnowledgeEntry { methodName: "削弱题排除法" }
  更新：上条 usageCount++，qualityScore 验证提升

第N次分析：
  知识库已有20条沉淀规律
  Claude 能识别出跨周期的进步/退步模式
  输出质量指数级提升
```

飞轮关键字段（实现时加到 KnowledgeEntry）：
```
verifiedAt    // 被后续分析验证有效的时间
supersededBy  // 被更新的规律替代（指向新条目ID）
sessionId     // 哪次分析产生的（便于追溯）
```

---

## 与主项目的接口

分析服务写入 DB 后，主项目自动感知，不需要任何通信：

- 写入 `KnowledgeEntry` → 主项目知识库页面直接显示
- 写入 `UserInsight` → 主项目规律固化页面显示
- 写入 `UserNote` (type='ai_analysis') → 主项目笔记页面显示
- 更新 `UserError.aiActionRule` → 下次答题揭晓页直接展示

**这就是共享 DB 最大的好处：零通信成本，完全解耦。**

---

## 实现顺序建议

```
Week 1: 跑通 --task=errors（最直接的价值）
Week 2: 加 --task=patterns（发现系统性盲点）
Week 3: 加知识积累飞轮（existingKnowledge 注入 prompt）
Week 4: 加定时任务，完全自动化
```

---

## 依赖

```bash
cd analysis-worker
npm install
# 复用主项目的 .env.local（同一个 DATABASE_URL + ANTHROPIC_API_KEY）
cp ../.env.local .env.local
```

```json
{
  "@anthropic-ai/sdk": "^0.24.0",
  "@prisma/client":    "^5.10.0",
  "date-fns":          "^3.3.1",
  "tsx":               "^4.7.0"
}
```

---

## AnalysisQueue 表（已实现，待消费）

系统已在 DB 中建立 `analysis_queue` 表，分析服务的核心入口就是这张表。

```typescript
// 分析服务主循环
async function processQueue() {
  // 取优先级最高的 pending 任务
  const task = await prisma.$queryRaw`
    SELECT * FROM analysis_queue
    WHERE status = 'pending'
    ORDER BY priority DESC, "createdAt" ASC
    LIMIT 1
  `
  if (!task) return

  // 标记为 processing
  await prisma.$executeRaw`
    UPDATE analysis_queue SET status='processing', "updatedAt"=NOW() WHERE id=${task.id}
  `

  // 读已有知识库（飞轮上下文）
  const existingKnowledge = await prisma.$queryRaw`
    SELECT "methodName", "solutionSteps", "qualityScore"
    FROM knowledge_entries
    WHERE "questionType" = ${task.targetId}
    ORDER BY "qualityScore" DESC LIMIT 5
  `

  // 读该考点所有真题
  const questions = await prisma.question.findMany({
    where: {
      OR: [
        { type: task.targetId },
        { subtype: task.targetId },
        { sub2: task.targetId },
      ],
      isFromOfficialBank: true,
    },
    take: 20,
  })

  // 构建 prompt 分析 + 写回
  // ...见 src/lib/ai/knowledge-extractor.ts
}
```

### 触发时机

| 触发 | 谁写入 | 何时 |
|------|--------|------|
| 批量导入完成 | `api/import/confirm` | 自动，按题目 skillTag 聚类写入 |
| 用户发现盲区 | `api/analysis/gaps` 页面 | 用户点"加入分析"按钮 |
| 手动添加 | `api/analysis/queue POST` | 管理员或分析服务 |
| 定时全量 | 分析服务 cron | 每周重新分析高频考点 |

---

## 三层数据结构（已实现）

```
ActivityLog        原始事件流        src/lib/activity/logger.ts
AnalysisSnapshot   AI分析结果        src/lib/activity/snapshot-writer.ts
SystemInsight      可执行系统建议    prisma/schema.prisma
```

### 分析服务使用示例

```typescript
import { buildActivitySummary, getRecentActivity } from '../src/lib/activity/logger'
import { getPrevSnapshot, writeAnalysisSnapshot } from '../src/lib/activity/snapshot-writer'

async function runUserPatternAnalysis(userId: string) {

  // 1. 读活动摘要（快速）
  const summary = await buildActivitySummary(userId, 30)

  // 2. 读上次分析（飞轮上下文）
  const prev = await getPrevSnapshot({ userId, analysisType: 'user_pattern' })
  const prevContext = prev
    ? `上次分析（${prev.createdAt.toLocaleDateString()}）发现：${prev.findings.map(f => f.title).join('、')}`
    : '这是首次分析'

  // 3. 读原始活动日志（详细）
  const recentLogs = await getRecentActivity({
    userId,
    eventTypes: ['practice.answer', 'error.stockified', 'error.rebound'],
    since: new Date(Date.now() - 30 * 86400000),
    limit: 500,
  })

  // 4. 构建 prompt（注入历史上下文）
  const prompt = buildPrompt(summary, recentLogs, prevContext)

  // 5. 调用 Claude Opus（分析用最强模型）
  const result = await claude.messages.create({
    model: 'claude-opus-4-5',
    messages: [{ role: 'user', content: prompt }],
  })

  // 6. 解析并写回（同时触发 SystemInsight 写入）
  const parsed = JSON.parse(result.content[0].text)
  const snapshotId = await writeAnalysisSnapshot({
    userId,
    analysisType: 'user_pattern',
    prevSnapshotId: prev?.id,
    inputSummary: { ...summary, logCount: recentLogs.length },
    findings: parsed.findings,
    recommendations: parsed.recommendations,
    confidenceScore: parsed.confidenceScore,
    dataPointsUsed: recentLogs.length,
  })

  console.log(`分析完成: ${snapshotId}`)
}
```

### 已记录的事件（自动，无需手动触发）

| 操作 | 事件类型 | 记录位置 |
|------|---------|---------|
| 答每道题 | `practice.answer` | `api/review/submit` |
| 题目存量化 | `error.stockified` | `api/review/submit` |
| 批量导入完成 | `import.completed` | `api/import/confirm` |
| AI诊断完成 | `ai.diagnosis_done` | `lib/ai-diagnosis.ts` |
| 分析服务完成 | `ai.analysis_done` | `lib/activity/snapshot-writer.ts` |

### 飞轮循环

```
Day 1:  ActivityLog 50条  → AI首次分析 → AnalysisSnapshot(confidence=0.5)
Day 7:  ActivityLog 400条 → AI分析+上次快照 → AnalysisSnapshot(confidence=0.75)
Day 30: ActivityLog 2000条→ AI分析+历史链  → AnalysisSnapshot(confidence=0.9)
                                           → SystemInsight: 个性化interval
                                           → systemInsight 被采纳 → 反哺系统行为
```
