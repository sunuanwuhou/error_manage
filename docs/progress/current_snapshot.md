# Current Snapshot

Updated: 2026-03-21 20:35 CST

## Latest Update

- Current Goal:
  - 收紧 DOCX 真题导入主链路，把试卷命名、分类、删卷和自动比对收成稳定规则。
- What Changed:
  - 新增 `baseTitle` 和 `buildCanonicalPaperSession`，真题统一归一为“年份 + 考试类型/地区 + 标题本体”。
  - 套卷列表改为显示标题本体，管理员可在 `papers` 页直接删除整套卷。
  - 新增 `scripts/import-docx-paper.mjs` 与 `scripts/audit-docx-paper.mjs`，支持“导入 DOCX -> 自动对账数据库”。
- What Is Done:
  - 实样本 `/Users/10030299/Documents/个人/2025年广东省公务员录用考试《行测》题（网友回忆版）.docx` 已真实导入。
  - 自动审计结果：`parsedTotal = 90`、`dbTotal = 90`、`parsedWithImage = 28`、`dbWithImage = 28`、`mismatchCount = 0`。
  - 统一后的 session 名称：`2025 省考/广东 公务员录用考试《行测》题（网友回忆版）`。
- What Is Still Open:
  - 浏览器侧删除试卷和导入页的 E2E 冒烟还没补。
  - 老数据如果保留旧 `srcExamSession`，仍建议后续批量重导或补一次规范化迁移。
- Next 3 Actions:
  1. 用浏览器点一遍 `papers` 页，确认管理员删卷交互和刷新反馈。
  2. 如果要统一历史数据，补一个批量“重算 session label”的迁移脚本。
  3. 给 DOCX 导入页结果页补一条“已归一命名”的可见提示，减少用户困惑。

## Current Goal

- 把系统从“功能很多但主线不够稳”收成“能长期用的个人提分系统”。
- 当前主线只聚焦 3 件事：
  - 导入链路可信
  - 知识树/笔记收稳
  - 练习与套卷闭环统一
- AI 相关本轮只保留文档、边界和失败兜底，不继续深做实现。
- 知识树里的“新增 / 编辑知识点”要统一成轻量 Markdown 体验，减少大表单感，支持贴图和连续编辑。

## What Changed

- `notes` 页的知识点新增/编辑体验开始统一：
  - 新增与编辑共用同一套 Markdown 编辑器
  - 默认先写标题和正文，更多信息折叠到“展开更多信息”
  - 支持直接粘贴图片进正文
  - 支持 Markdown / 代码块式图表内容的预览
  - 知识点正文与知识点详情保持同一套轻量心智

- AI 主线这轮已经继续深做，不再只是文档口径。
  - `认知偏差诊断` 第一版已接入 `analysis-worker`
  - `user_error_diagnosis` context 已新增 `biasContext`
  - `userProfileSignals` 已新增 `highFrequencyBiases`
  - `user_strategy_refresh` 汇总已新增：
    - `topBiases`
    - `biasByQuestionType`
    - `biasRepeatRate`
  - `result.template.json` / prompt / contract 已新增 `biasDiagnosis`
  - 单题快照 `analysis_snapshots.inputSummary` 已开始记录：
    - `biasDiagnosis`
    - `usedEvidence`
    - `diagnosisDecision`
    - `strategyImpact`
  - 已用真实本地样本完成一条 apply 验证：
    - task: `00963954-31fc-4890-9926-66686f33454a`
    - userError: `78de96bd-be05-4c40-9683-1f8e76da5e06`
    - 已写回 `user_errors`
    - 已写入诊断快照
  - 已验证高风险偏差会回流/复用 `user_strategy_refresh`
  - 规则效果自学习第一版也已接上：
    - `recentRulePerformance` 新增 `effectivenessScore / effectivenessTier`
    - `user_strategy_refresh` 的知识检索会读 `topBiases / worstActionRules / recentRulePerformance`
    - 当前真实策略 bundle 已出现“旧规则 failed”信号
  - `analysis:export` 的参数协议已修正：
    - 现在可直接使用 `npm run analysis:export -- --task-id=<id>`
  - 人工反馈校正层第一版也已接入：
    - 新增 `AIFeedbackLog` 数据模型
    - 新增 `/api/ai-feedback`
    - `analysis-worker` 已读取：
      - 单题级 `humanFeedbackSummary`
      - 用户级 `humanFeedbackSignals`
    - prompt 已开始优先尊重人工确认/否定记录
    - 迁库前 worker 会对缺失的 `ai_feedback_logs` 表自动降级

- AI 相关防再犯规则已补：
  - AI apply 验收不能只看 `analysis_queue.status`
  - 必须同时验：
    - `user_errors.ai*`
    - `analysis_snapshots.inputSummary`
    - 高风险是否回流到 `user_strategy_refresh`
  - `current_snapshot.md` 若与当前代码/数据库事实冲突，必须立即修正
  - 新增人工反馈层后，任何“AI 说了算”的逻辑都应优先检查是否已有人工覆盖

- `master` 已同步到 `origin/master` 最新提交：`c0efbd8 stabilize e2e baseline and switch import flow to docx-first`
- 文档治理开始收口：
  - 识别出 `current_snapshot.md`、`完成度清单.md`、部分 AI 文档已混入历史流水和失真优先级
  - 确定后续文档分层：当前真相 / 历史记录 / 长期蓝图
- 产品现状再次审视后，当前最高优先级明确为：
  - 导入可信度
  - 知识树数据质量
  - 练习闭环
  - 自动验证纪律

## What Is Done

- 本地 `master` 已拉到远端最新。
- 知识树方向已定：
  - 一个知识点 = 一篇 Markdown 笔记
  - 错题挂在知识点下面
  - 规律不再作为独立产品形态保留
- 知识点新增 / 编辑已经收敛到同一套轻量编辑器，默认直写正文，图片可直接贴入。
- 当前文档治理方向已定：
  - `docs/README.md` 作为唯一导航页
  - `项目总览与路线图.md` 作为总览层
  - `current_snapshot.md` 只保留当前状态
  - AI 相关改为“移交设计”口径

## What Is Still Open

- 导入后结果页、重复题策略、套卷成卷可信度还不够强。
- 知识树还有两类真实问题没收完：
  - 旧 `sourceErrorIds` 与当前错题实体断链，需要继续清理和回填
  - 知识点详情页还可以再少一层卡片感，让“看笔记”更直接
- 普通练习、套卷练习、知识点回练还没形成真正统一的训练闭环。
- 前后端 smoke 虽然已有脚本和规则，但执行纪律还没完全落地。

## Blockers / Risks

- 当前本地库里 `wesly` 有知识点笔记，但 `user_errors` 为 `0`，说明存在历史残留引用，不能把“关联错题数量”完全当成真实数据。
- 开发服务在这个环境里偶尔会出现端口占用或 curl 不通的假象，判断服务状态必须以真实监听和页面刷新为准。
- 当前工作区仍有少量本地杂项文件，需要单独清理：
  - `package-lock.json`
  - `.dev-server.pid`
  - `latest-complete-patch.zip`
  - `latest-complete.png`

## Core Metrics

- Git branch: `master`
- Git head: `c0efbd8`
- 本地与远端：`master == origin/master`
- 关键主线状态：
  - 导入：可用，但可信度和结果页仍需收口
  - 知识树：方向正确，数据质量仍需修
  - 套卷：可用，但仍需更强考试感和进度感
  - AI：保留边界，不继续在当前轮深做

## Environment Notes

- Project root:
  - `/Users/10030299/Documents/Playground/error_manage`
- Database:
  - 本地 PostgreSQL
  - `error_manage_dev`
- 常用检查：
  - `npm run typecheck`
  - `npm run build`
- 当前协作要求：
  - 优先清理和稳主线
  - AI 只写文档与移交，不继续扩实现

## Next 3 Actions

1. 继续压缩 `notes` 页的知识点详情层级，让知识点展开后更像直接读 Markdown，而不是还隔着一层卡片。
2. 清理 `sourceErrorIds` 的历史残留和断链引用，保证知识点下“关联错题数”可信。
3. 继续把新增 / 编辑 / 回填统一成一个更轻的知识点编辑流，再做一轮全链验证。

## Resume Command

`/继续 error_manage`
