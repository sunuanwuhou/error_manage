# Codex 高频分析执行方案

Updated: 2026-03-20

## 背景

- 目标不是把 ChatGPT Pro 当成产品 API，而是把 Codex 当成高频执行的分析 worker。
- 主项目继续负责：
  - 用户动作落库
  - `analysis_queue` 作为任务状态源
  - `analysis_snapshots / system_insights / user_errors` 作为结果存储
  - 页面展示与人工确认
- Codex 负责：
  - 按计划高频扫描待处理任务
  - 读取 worker 导出的上下文文件
  - 运行推理分析并输出结构化 JSON
- analysis-worker 负责：
  - 领取任务并导出上下文
  - 校验 Codex 结果并写回项目

## 总体架构

```text
用户行为
  -> Next.js 写 analysis_queue
  -> analysis-worker 领取任务并导出 context JSON
  -> Codex 读取 context JSON + prompt
  -> Codex 输出 result JSON
  -> analysis-worker apply-result 写回 analysis_snapshots / system_insights / knowledge_entries
  -> 前端读取结果展示
```

## 设计原则

1. `analysis_queue` 是唯一任务状态源，不新增第二套主状态系统。
2. Codex 是执行器，不是业务状态源，也不是数据库真相来源。
3. 模型推理与数据库写入必须解耦，Codex 只负责输出结构化结果，worker 负责校验和落库。
4. 先做“批处理价值高、非实时依赖强”的任务，不把实时用户链路绑上外部执行。
5. 所有任务都要幂等，允许高频重跑而不破坏数据。

## 第一阶段范围

先落一个最小可运行闭环：`user_strategy_refresh`

- 输入：
  - 近 30 天 `activity_logs`
  - `user_errors`
  - `system_insights`
  - 用户配置（考试类型、目标分、考试日期、日目标）
- 输出：
  - `analysis_snapshots.analysisType = 'user_strategy_refresh'`
  - 高置信策略写入 `system_insights`
  - 可复用策略知识写入 `knowledge_entries`
  - 对应 `analysis_queue` 任务状态更新为 `done / failed / skipped`

本阶段暂不做：

- 把 ChatGPT Pro 当作产品运行时 API
- 单题同步诊断改造
- 套卷整卷复盘自动分析
- 多模型适配层重构

## 任务类型规划

### 已落地/沿用

- `skill_tag`
  - 现有导入链路已经会写入
  - 继续保留给后续考点聚类分析使用

### 第一阶段新增规范

- `user_strategy_refresh`
  - `targetId = userId`
  - 作用：为某个用户生成阶段性训练策略

### 第二阶段预留

- `paper_review_summary`
  - `targetId = paperPracticeSession.id`
  - 作用：整卷交卷后的异步复盘
- `user_error_diagnosis`
  - `targetId = userError.id`
  - 作用：单题个性化诊断

### 本轮已落地扩展

- `user_error_diagnosis`
  - 已接入 `analysis-worker`
  - `targetId = userError.id`
  - 导出 bundle 时会带上：
    - 题干
    - 选项
    - 正确答案
    - 用户答案
    - 复习次数 / 掌握度
    - 旧诊断结果
    - 可复用知识
  - apply 时会直接写回：
    - `user_errors.aiRootReason`
    - `user_errors.aiErrorReason`
    - `user_errors.aiActionRule`
    - `user_errors.aiThinking`
    - `user_errors.aiReasonTag`
    - `user_errors.customAiAnalysis`

## 队列约定

### `analysis_queue`

- `status`
  - `pending`: 待领取
  - `processing`: worker 已领取
  - `done`: 分析完成
  - `failed`: 分析失败，等待人工重试
  - `skipped`: 当前 worker 不支持或上下文不足

### 幂等规则

- 同一用户在同一时间只保留一条 `pending/processing` 的 `user_strategy_refresh`
- 同一用户即使重复跑策略分析，也只会新增新快照，不覆盖历史快照
- `system_insights` 只追加新建议，不直接改写历史建议
- `knowledge_entries` 对同一类策略方法优先更新和累积，不盲目无限追加重复条目

## Worker 运行方式

### 目标形态

- Codex 高频执行：
  - 每 10 分钟：补齐 `user_strategy_refresh` 待处理任务
  - 每 10 分钟：消费一批 `analysis_queue`

### 统一原则

- 不让 `Codex Desktop / IDEA 插件 / Docker` 自己决定“扫什么”
- 始终由项目协议决定“扫什么”：
  - `analysis_queue` 决定有哪些待处理任务
  - `analysis-worker` 决定如何 claim / export / apply
  - `.runtime/analysis/bundles/<taskId>/` 决定 Codex 要读取和写回哪些文件
- 执行器只负责“按时运行固定命令”，不负责记忆业务规则

### 统一入口

不论在哪种环境里，建议都只认这几条命令：

```bash
npm run analysis:dispatch -- --task=user_strategy_refresh --interval-hours=0
npm run analysis:autopilot -- --task=user_strategy_refresh --interval-hours=0
npm run analysis:latest
npm run analysis:apply -- --task-id=<taskId>
```

含义固定：

- `analysis:dispatch`
  - 补齐队列并导出最新 bundle
- `analysis:autopilot`
  - 补齐队列
  - 自动 apply 已准备好的 `result.json`
  - 再导出下一条 bundle
- `analysis:latest`
  - 打印当前应该交给 Codex 的 bundle
- `analysis:apply`
  - 把 Codex 产出的 `result.json` 写回数据库

### 运行拓扑

#### 模式 A：本机桌面版 Codex

```text
本机 Next.js
  -> 写 analysis_queue
  -> 本机 analysis-worker 执行 analysis:dispatch
  -> 生成 .runtime/analysis/bundles/<taskId>
  -> Codex Desktop 读取 bundle 并写 result.json
  -> 本机 analysis-worker 执行 analysis:apply
```

适用场景：

- 你自己在当前电脑上开发和运营
- bundle 目录就在本地工作区
- 最容易先看见真实效果

#### 模式 B：IDEA / VS Code / 其他插件版 Codex

```text
IDE/终端所在工作区
  -> 执行 analysis:dispatch
  -> bundle 写到项目的 .runtime/analysis
  -> 插件版 Codex 读取 TASK_FOR_CODEX.md 和同目录文件
  -> 写出 result.json
  -> 同一工作区执行 analysis:apply
```

适用场景：

- 换电脑后不使用 Codex Desktop
- 只要插件能访问项目目录，就能按同一 bundle 协议工作

关键点：

- 插件不需要“知道自己该扫什么”
- 它只需要读取当前 bundle 目录中的任务文件
- 该扫哪些任务，始终由 `analysis:dispatch` 从数据库决定

#### 模式 C：Docker / 容器部署

```text
app 容器
  -> Next.js 写 analysis_queue

analysis-worker 容器
  -> 定时执行 analysis:dispatch
  -> 把 bundle 写入共享卷 /app/.runtime/analysis

外部 Codex 执行器
  -> 读取共享卷中的 bundle
  -> 写 result.json

analysis-worker 容器
  -> 执行 analysis:apply
  -> 结果落回同一个 Postgres
```

适用场景：

- 应用服务容器化
- worker 独立部署
- 未来想平滑切到 API 模型

关键点：

- 容器里不要依赖某台机器上的 Codex 状态
- 只依赖共享卷、数据库和固定命令
- `bundle` 是容器内外的交接协议，不是某个客户端私有状态

### 调度责任边界

- 项目负责：
  - 生成任务
  - 选择待处理任务
  - 导出 bundle
  - 校验并回写结果
- 执行器负责：
  - 定时触发 `analysis:dispatch`
  - 让 Codex 处理当前 bundle
  - 触发 `analysis:apply`
- Codex 负责：
  - 读取 `context.json`
  - 读取 `prompt.md`
  - 参考 `result.template.json`
  - 写出 `result.json`

### 为什么这样设计

这样换环境时不会丢行为定义：

- 换电脑，不需要迁移“Codex 记忆”
- 换插件，不需要重写任务逻辑
- 上 Docker，不需要把任务规则塞进容器编排

真正稳定的是项目协议，而不是客户端形态。

### 本地命令

```bash
node analysis-worker/src/index.mjs --enqueue-stale-strategy
node analysis-worker/src/index.mjs --claim-and-export --task=user_strategy_refresh
node analysis-worker/src/index.mjs --apply-result --task-id=<id> --result-file=/abs/path/result.json
```

## 第一阶段实现清单

1. 新增本方案文档，固定边界与任务定义
2. 新增 `analysis-worker/src/index.mjs`
3. worker 支持：
   - 读取 `.env.local`
   - 补齐过期的 `user_strategy_refresh` 任务
   - `claim-and-export`
   - `apply-result`
   - 校验 Codex 输出 schema
   - 生成 `analysis_snapshots`
   - 生成高置信 `system_insights`
   - 把核心策略结论固化到 `knowledge_entries`
4. 根项目增加运行脚本
5. 验证 worker 能正常启动、能识别队列、能完成一次策略分析

## 文件协议

### 导出文件

- context:
  - `.runtime/analysis/tasks/<taskId>.json`
- prompt:
  - `.runtime/analysis/prompts/<taskId>.md`
- result template:
  - `.runtime/analysis/results/<taskId>.template.json`

### 结果文件

- result:
  - `.runtime/analysis/results/<taskId>.json`

### Codex 结果 JSON 必填字段

- `taskId`
- `analysisType`
- `userId`
- `confidenceScore`
- `dataPointsUsed`
- `findings`
- `recommendations`

### 结果协议规则

- `result.taskId` 必须等于被 apply 的任务 id
- `result.analysisType` 必须等于任务 `targetType`
- `result.userId` 必须等于任务 `targetId`
- `findings` 和 `recommendations` 必须是非空数组
- `knowledge` 可选，但如果提供必须满足结构化 schema
- `apply-result` 对已完成任务必须幂等跳过，不能重复写快照

## 三层沉淀

每次分析完成后，不只“通知 AI 去分析”，而是明确沉淀三层结果：

1. `analysis_snapshots`
- 保存单次分析的完整上下文、findings、recommendations
- 用于回溯和飞轮上下文

2. `system_insights`
- 保存可执行系统建议
- 用于驱动 `daily-tasks` 等运行时策略

3. `knowledge_entries`
- 保存可复用的知识块
- 当前先沉淀结构化文本知识
- 若配置 `OPENAI_API_KEY`，worker 会额外生成 embedding 写入 `contentEmbedding`
- 若未配置，则自动降级为“结构化知识库 + 关键词检索”

## 检索增强

- `user_strategy_refresh` 在生成本次 findings / recommendations 之前，会先检索历史 `策略分析` 知识。
- 检索顺序：
  - 若可生成 embedding：优先走向量相似检索
  - 否则：降级到 `triggerKeywords` 的关键词召回
- 命中的历史知识会：
  - 回写到本次 `analysis_snapshots.inputSummary.retrievedKnowledge`
  - 注入本次 recommendations，作为 `supportingKnowledge`
  - 递增 `knowledge_entries.usageCount`

## 向量知识库约定

- 向量化是增强层，不是第一阶段硬依赖
- 先确保每条高价值分析都能结构化落库
- 后续检索优先级：
  - `questionType / analysis domain`
  - `qualityScore`
  - `usageCount`
  - 向量相似度

## 图片题与 OCR

- 不是所有题都适合同等质量地分析。
- 纯文本题最稳定，图题如果只传 `[图]` 给 AI，分析质量会明显下降。
- 因此图片题应优先补 OCR / 图像摘要，而不是只把占位文本交给模型。

当前项目现状：

- 项目已存在截图 OCR 基础设施：
  - `src/lib/import/ocr.ts`
  - `src/app/api/ai/ocr/route.ts`
- 本轮已把图片题 OCR 思路接到 `user_error_diagnosis` 导出链路：
  - 若题目有 `questionImage`
  - 且题干包含 `[图]` 或文本过短
  - 且配置了 `MINIMAX_API_KEY`
  - worker 会先尝试识别题图中的可见文字和结构摘要
  - 再把 `imageOcr` 一并放入 bundle context 给 Codex

设计原则：

- OCR 是增强层，不是唯一真相来源
- 先用 OCR 补“可见文字和结构摘要”
- 再由 Codex 结合题干、选项、答案和历史知识做推理
- 如果 OCR 不可用，仍保留文本诊断降级路径

## 第二阶段实现清单

1. 为 `paper_review_summary` 建立入队入口
2. 为 `user_error_diagnosis` 建立异步链路
3. 为更多任务类型补充 Codex 输出 schema
4. 增加管理员页上的任务触发/重跑入口
5. 把 Codex 自动化调度真正固化成可重复运行的计划任务

## 风险与边界

- ChatGPT Pro / Codex 更适合作为运营分析 worker，不适合作为面向最终用户的受保障在线 API。
- 高频执行必须依赖幂等设计，不能靠“只运行一次”的假设。
- 若后续要让用户实时看到 AI 结果，仍建议逐步迁到正式 API 模型。
- `current_snapshot.md` 继续记录阶段推进，但方案本身以本文件为准。
