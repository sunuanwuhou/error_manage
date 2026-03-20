# Codex 分析执行手册

Updated: 2026-03-20

## 目标

本手册用于把 `error_manage` 的分析任务交给 Codex 执行。

边界固定如下：

- 项目负责：
  - 写 `analysis_queue`
  - 导出任务上下文
  - 校验结果
  - 写回 `analysis_snapshots / system_insights / knowledge_entries`
- Codex 负责：
  - 读取任务上下文
  - 产出严格结构化 JSON
  - 不直接改数据库

## 标准流程

### 自动巡航入口

如果你希望把这条链尽量收成一个固定动作，优先使用：

```bash
npm run analysis:autopilot -- --task=user_strategy_refresh --interval-hours=0
```

它会顺序做三件事：

1. 补齐过期的 `user_strategy_refresh` 任务
2. 自动 apply 已经准备好的 `bundles/<taskId>/result.json`
3. 领取并导出下一条待处理 bundle

返回结果会是 JSON，核心字段包括：

- `appliedTaskIds`
- `exportedTaskId`
- `bundleDir`
- `codexFile`
- `resultFile`
- `needsCodex`

推荐心智模型：

- `analysis:autopilot` 负责项目侧编排
- Codex 只负责处理 `needsCodex=true` 时导出的 bundle
- Codex 写完 `result.json` 后，下一次 `analysis:autopilot` 会自动把它 apply 回数据库

### 1. 导出任务

```bash
npm run analysis:worker -- --enqueue-stale-strategy --claim-and-export --task=user_strategy_refresh
```

或使用快捷命令：

```bash
npm run analysis:claim -- --task=user_strategy_refresh
```

如果希望“先补队列再导出”一步完成，用：

```bash
npm run analysis:dispatch -- --task=user_strategy_refresh --userId=<userId> --interval-hours=0
```

如果任务已经是 `processing`，需要重新生成 bundle，用：

```bash
npm run analysis:export -- --export-task-id=<taskId>
```

运行后会生成：

- context:
  - `.runtime/analysis/tasks/<taskId>.json`
- prompt:
  - `.runtime/analysis/prompts/<taskId>.md`
- result template:
  - `.runtime/analysis/results/<taskId>.template.json`
- bundle:
  - `.runtime/analysis/bundles/<taskId>/`

bundle 目录中会直接包含：

- `README.md`
- `TASK_FOR_CODEX.md`
- `context.json`
- `prompt.md`
- `result.template.json`

导出后项目还会维护两个固定指针文件：

- `.runtime/analysis/latest-task-id.txt`
- `.runtime/analysis/latest-bundle.txt`

你也可以直接运行：

```bash
npm run analysis:latest
```

它会打印：

- 最新 task id
- 最新 bundle 目录
- 直接交给 Codex 的文件路径
- 默认 apply 命令

## 谁来扫任务

这套协议里，“扫什么任务”永远不是由 Codex 客户端自己决定，而是由项目命令决定。

固定原则：

- `analysis_queue` 决定哪些任务待处理
- `analysis:dispatch` 决定本次要导出哪个 bundle
- Codex 只处理已经导出的 bundle

所以不管你用的是：

- Codex Desktop
- IDEA / VS Code 插件
- Docker 里的 worker
- 其他能访问项目目录的执行器

它们都不需要记忆业务规则，只需要执行固定动作。

## 三种运行模式

### 1. 本机桌面模式

适合当前电脑直接开发和运营。

固定动作：

```bash
npm run analysis:dispatch -- --task=user_strategy_refresh --interval-hours=0
npm run analysis:latest
```

然后把最新 bundle 目录里的 `TASK_FOR_CODEX.md` 交给 Codex Desktop。

Codex 写完 `result.json` 后执行：

```bash
npm run analysis:apply -- --task-id=<taskId>
```

### 2. IDEA / VS Code 插件模式

适合换电脑后不用桌面版，只在 IDE 里工作。

固定动作不变：

```bash
npm run analysis:dispatch -- --task=user_strategy_refresh --interval-hours=0
npm run analysis:latest
npm run analysis:apply -- --task-id=<taskId>
```

区别只在于：

- 让插件版 Codex 读取项目目录中的 bundle
- 在同一工作区输出 `result.json`

插件不需要自己“扫描数据库”，数据库扫描还是 `analysis-worker` 负责。

### 3. Docker 模式

适合项目后续容器化部署。

推荐拆成：

- `app` 容器：
  - 跑 Next.js
  - 写 `analysis_queue`
- `analysis-worker` 容器：
  - 定时执行 `analysis:dispatch`
  - 执行 `analysis:apply`
- 外部 Codex 执行器：
  - 访问共享卷中的 bundle
  - 生成 `result.json`

关键要求：

- `.runtime/analysis` 必须挂成共享卷
- app 和 worker 连接同一个 Postgres
- 不把“任务规则”写进容器编排，而是继续走项目命令

## 推荐心智模型

把它理解成三层：

1. 项目层
- `analysis_queue`
- `analysis-worker`
- bundle 协议

2. 调度层
- 桌面自动化
- cron / launchd
- 容器定时器
- CI/CD 定时任务

3. 推理层
- Codex Desktop
- 插件版 Codex
- 未来其他模型执行器

只要这三层不混在一起，换环境就不会乱。

## 2. 让 Codex 分析

把下面两份文件交给 Codex：

- context JSON
- prompt Markdown

要求 Codex：

- 只输出 JSON
- 必须遵守 `outputContract`
- 结果保存为：
  - `.runtime/analysis/results/<taskId>.json`

建议优先以 template 为骨架填写，避免漏字段。

## 3. 回写结果

```bash
npm run analysis:worker -- --apply-result --task-id=<taskId> --result-file=/absolute/path/to/result.json
```

或使用快捷命令：

```bash
npm run analysis:apply -- --task-id=<taskId> --result-file=/absolute/path/to/result.json
```

如果 Codex 已经把结果写到 bundle 默认位置：

```bash
npm run analysis:apply -- --task-id=<taskId>
```

回写时 worker 会：

- 校验 `taskId`
- 校验 `analysisType`
- 校验 `userId === task.targetId`
- 校验 findings / recommendations / knowledge 结构
- 幂等跳过已完成任务

## 文件说明

### context JSON

主要内容：

- `task`
- `user`
- `summary`
- `previousSnapshot`
- `retrievedKnowledge`
- `baseline`
- `outputContract`

### prompt Markdown

只负责告诉 Codex：

- 这是什么任务
- 输出必须是什么格式
- 应该重点参考哪些上下文

### result template JSON

这是 worker 自动生成的空白结果模板，方便 Codex 填写。

它不是最终结果，只是占位骨架。

## 当前支持的任务

- `user_strategy_refresh`
- `user_error_diagnosis`

### `user_error_diagnosis` 用法

先为某条错题创建诊断任务：

```bash
npm run analysis:worker -- --enqueue-user-error-id=<userErrorId>
```

再导出 bundle：

```bash
npm run analysis:worker -- --claim-and-export --task=user_error_diagnosis
```

apply 成功后会直接写回对应 `user_errors` 的这些字段：

- `aiRootReason`
- `aiErrorReason`
- `aiActionRule`
- `aiThinking`
- `aiReasonTag`
- `customAiAnalysis`

如果结果里带了 `knowledge`，也会同步沉淀到 `knowledge_entries`。

如果想快速构造 AI 进化测试样本，可先运行：

```bash
npm run analysis:seed:testdata -- --userId=wesly_local --count=24
```

它会基于现有题库生成：

- 一批带历史 `aiActionRule / aiReasonTag` 的 `user_errors`
- 对应的 `review_records`
- 对应的 `practice_records`

适合验证：

- 历史错因复发
- 规则效果评分
- 单题诊断 RAG 上下文

后续扩展时，新任务必须同步补：

1. context 结构
2. prompt 生成逻辑
3. result schema
4. apply-result 回写逻辑

## 当前已验证

- `claim-and-export` 已真实导出任务文件
- `apply-result` 已用模拟 Codex 结果文件跑通
- 重复 apply 已验证会幂等跳过

## 当前未完成

- 还没有把真正的 Codex 自动化调度串起来
- 还没有对 `paper_review_summary` 做同样协议
