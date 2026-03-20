# AI 进化路线图

Updated: 2026-03-20

## 目标

让 AI 从“一次性分析器”进化成“会记忆、会复用、会校正、会调策略”的系统。

目标形态：

```text
当前错题 / 当前训练状态
  + 用户历史错题
  + 历史 AI 规则
  + 知识库
  + 后验效果反馈
  -> 本次诊断
  -> 结果沉淀
  -> 反馈再进入下一轮分析
```

不是每次从零分析，而是先理解“这个用户以前是怎么错的、哪些规则对他有效、哪些方法已经沉淀过”，再生成本次结论。

## 当前基础

项目已经具备以下地基：

- 队列与 bundle 协议：
  - [analysis-worker/src/index.mjs](/Users/10030299/Documents/Playground/error_manage/analysis-worker/src/index.mjs)
  - [Codex高频分析执行方案.md](/Users/10030299/Documents/Playground/error_manage/docs/architecture/Codex高频分析执行方案.md)
  - [Codex分析执行手册.md](/Users/10030299/Documents/Playground/error_manage/docs/architecture/Codex分析执行手册.md)
- 单题诊断字段：
  - [prisma/schema.prisma](/Users/10030299/Documents/Playground/error_manage/prisma/schema.prisma)
  - `UserError.aiRootReason / aiErrorReason / aiActionRule / aiThinking / aiReasonTag / customAiAnalysis`
- 知识库与检索：
  - [src/lib/ai/knowledge-extractor.ts](/Users/10030299/Documents/Playground/error_manage/src/lib/ai/knowledge-extractor.ts)
  - `knowledge_entries`
- 用户级策略分析：
  - [analysis-worker/src/index.mjs](/Users/10030299/Documents/Playground/error_manage/analysis-worker/src/index.mjs)
  - `user_strategy_refresh`
- 图片与 OCR 基础设施：
  - [src/lib/import/ocr.ts](/Users/10030299/Documents/Playground/error_manage/src/lib/import/ocr.ts)
  - [src/app/api/ai/ocr/route.ts](/Users/10030299/Documents/Playground/error_manage/src/app/api/ai/ocr/route.ts)

## 核心设计原则

1. AI 的进化信息优先放在 bundle `context.json`，而不是塞进 `analysis_queue.targetMeta`。
2. 检索顺序优先“用户历史”，再“公共知识”，不要一开始就走全局公共方法。
3. 不急着加新表，第一版优先复用：
  - `user_errors`
  - `review_records`
  - `practice_records`
  - `analysis_snapshots`
  - `system_insights`
  - `knowledge_entries`
4. OCR 是图题增强层，不是唯一真相来源。
5. 先做高收益的上下文增强和反馈评分，再做复杂画像。

## AI 如何进化

### 第 1 层：单题层进化

目标：

- 从“这题怎么做”升级到“你为什么总在这类题上这样错”

单题诊断时要先读取：

- 同用户、同题型、最近 10-20 条 `user_errors`
- 同用户最近有效的 `aiActionRule / aiReasonTag`
- 该用户私有 `knowledge_entries`
- 全局高质量 `knowledge_entries`
- 最近一次 `user_strategy_refresh` 摘要

建议检索顺序：

1. 同用户、同题型、最近错题
2. 同用户最近规则与错因标签
3. 用户私有知识
4. 全局公共知识
5. 最近用户级策略快照

### 第 2 层：规则效果进化

目标：

- 从“看起来像有效”升级到“后验证明对这个用户有效”

第一版不加表，先用现有字段做效果评分：

- `user_errors.correctCount / reviewCount / masteryPercent / masteryHistory / reboundAlert / isHot`
- `review_records.isCorrect / isSlowCorrect / thinkingVerdict / resultMatrix / timeSpent`
- `practice_records.isCorrect / nextShowAt / questionType`
- `analysis_snapshots.findings / recommendations / confidenceScore`
- `knowledge_entries.usageCount / qualityScore`

建议先落 4 个轻量指标：

- `rule_followup_accuracy_7d`
- `rule_followup_slow_correct_rate_7d`
- `reason_tag_repeat_count_14d`
- `mastery_lift_after_rule`

### 第 3 层：用户层进化

目标：

- 从“会分析题”升级到“会理解这个人”

暂不急着建独立画像表，先做只读聚合函数，生成：

- 高频错因标签
- 最近复发题型
- 最近最有效规则
- 最近失效规则
- 当前训练阻塞点

这部分先进入 bundle context，后续再决定是否落成独立表。

### 第 4 层：策略层进化

目标：

- 从“会解释错题”升级到“会修正训练策略”

`user_strategy_refresh` 后续应消费：

- `diagnosisFeedbackSummary`
- `recentRulePerformance`
- 高风险单题回流信号

最终效果：

- 好规则提升权重
- 差规则降级或替换
- 复发错因直接影响日任务策略

## 该往哪里加信息

### 首选：bundle context

最适合扩展的位置：

- [analysis-worker/src/index.mjs](/Users/10030299/Documents/Playground/error_manage/analysis-worker/src/index.mjs)
  - `exportUserErrorDiagnosisContext`
  - `exportUserStrategyRefreshContext`

原因：

- Codex 真正读取的是 `context.json`
- 当前已经承载 `previousSnapshot / retrievedKnowledge / imageOcr`
- 扩展不会破坏任务状态流转

### 次选：analysis_snapshots.inputSummary

适合记录：

- 本次用了哪些历史规则
- 参考了哪些知识
- 哪些规则有效或失效

用于后续回看和策略层消费。

### 不推荐：analysis_queue.targetMeta

`targetMeta` 更适合放调度元信息：

- `reason`
- `exportContextFile`
- `exportedAt`
- `imageOcrUsed`

不适合承载大块用户历史和反馈数据。

## 建议新增的 context 字段

### 给 user_error_diagnosis

当前已有：

- `userError.previousDiagnosis`
- `question`
- `retrievedKnowledge`

下一步建议补这 4 组：

#### historicalPatterns

- `sameTypeRecentErrors`
- `sameReasonTagRecentCount`
- `sameActionRuleRecentCount`
- `lastThreeDiagnoses`

作用：

- 判断这是“新错因”还是“旧模式复发”

#### ruleEffectiveness

- `currentRule`
- `ruleIssuedAt`
- `sameTypeAfterRuleTotal`
- `sameTypeAfterRuleCorrect`
- `sameTypeAfterRuleAccuracy`
- `repeatWrongAfterRuleCount`

作用：

- 判断旧规则有没有真正帮上忙

#### userProfileSignals

- `highFrequencyReasonTags`
- `weakQuestionTypes`
- `recentMasteryTrend`
- `reviewStability`
- `isRepeatOffenderOnSameType`

作用：

- 让单题诊断具备“懂这个人”的能力

#### knowledgeEvidence

在现有 `retrievedKnowledge` 基础上补：

- `matchReason`
- `matchedKeywords`
- `effectScore`
- `lastUsedAt`

作用：

- 不只知道“相似”，还知道“是否有效”

### 给 user_strategy_refresh

建议补：

#### diagnosisFeedbackSummary

- `topReasonTags`
- `repeatWrongPatterns`
- `bestActionRules`
- `worstActionRules`
- `ruleFailureHotspots`

#### recentRulePerformance

- `ruleName`
- `issuedCount`
- `followupCorrectRate`
- `repeatWrongRate`

作用：

- 让策略分析不再只看活跃度和题量

## 建议新增的 result 字段

### 给 user_error_diagnosis

当前已有：

- `diagnosis`
- `knowledge`

下一步建议补：

#### usedEvidence

- `knowledgeIds`
- `previousDiagnosisUsed`
- `historicalErrorsUsed`
- `ruleEffectUsed`

作用：

- 可审计，知道 AI 这次参考了什么

#### diagnosisDecision

- `mode`: `new_pattern | repeat_pattern | rule_failed | rule_confirmed`
- `supersedesPreviousRule`
- `keepPreviousRule`

作用：

- 告诉系统这次到底是新规律，还是旧规律复发，还是旧规律失效

#### feedbackUpdate

- `ruleToEvaluate`
- `expectedOutcome`
- `reviewWindowDays`

作用：

- 后续 worker 可以据此回看规则效果

#### strategyImpact

- `shouldEscalateToStrategyRefresh`
- `suggestedFocusType`
- `riskLevel`

作用：

- 高风险单题可以回流到用户级策略层

## OCR 与图题进化路线

### 现状

项目已经有 70% 地基：

- `questionImage` 已贯通导入、存储、API、展示
- OCR 已能做截图识别
- 单题 bundle 已开始支持 `imageOcr`

### 最小可行增强

1. 复用 [ocr.ts](/Users/10030299/Documents/Playground/error_manage/src/lib/import/ocr.ts) 的识别能力
2. 在 `user_error_diagnosis` context 中补：
   - `questionImage`
   - `imageOcr`
   - `imageSummary`
3. prompt 改为图文混合输入
4. 只对这些题触发 OCR：
   - 题干包含 `[图]`
   - 题干明显过短
   - 选项明显是图片占位
5. 先缓存到任务上下文，后续再决定是否升到 `questions` 表字段

### 最受益的题型

- 资料分析图表题
- 常识判断图片材料题
- 截图文字题
- 带文字锚点的图片选项题

### 风险最高的题型

- 纯图形推理
- 依赖空间关系的图题
- 复杂图表
- 几何 / 公式图

结论：

- 图里文字越多，OCR 价值越高
- 图里几何结构越多，OCR 单独价值越低
- 真正高质量图题分析，最终还是要走多模态推理

## 三阶段落地顺序

### 阶段 1：扩 context，不改主表结构

目标：

- 让 Codex 不再从零分析

实施：

- `exportUserErrorDiagnosisContext()` 增加：
  - `historicalPatterns`
  - `ruleEffectiveness`
  - `userProfileSignals`
- `exportUserStrategyRefreshContext()` 增加：
  - `diagnosisFeedbackSummary`
  - `recentRulePerformance`
- `result` 增加：
  - `usedEvidence`
  - `diagnosisDecision`

这是当前最高收益、最低风险阶段。

### 阶段 2：补规则效果评分聚合层

目标：

- 让检索从“像不像”升级为“以前有没有用”

实施：

- 新增聚合函数，例如：
  - `src/lib/ai/rule-effectiveness.ts`
- 先基于现有表做 SQL 聚合
- 把效果分写进：
  - bundle context
  - `analysis_snapshots.inputSummary`
  - `result.usedEvidence`

### 阶段 3：把反馈闭环喂给策略层

目标：

- 从会分析错题，进化到会修正训练策略

实施：

- `user_strategy_refresh` 读取阶段 2 的反馈摘要
- 好规则升权
- 差规则降级
- 高风险单题回流策略层

## 第一批实现清单

1. 扩单题诊断 context 的历史错因、历史规则和用户级信号
2. 新增规则效果评分聚合函数
3. 单题 result 增加 `usedEvidence / diagnosisDecision`
4. 检索时增加“用户私有知识优先、效果高知识优先”的 rerank
5. `user_strategy_refresh` 读取最近规则效果摘要
6. 图题按 `imageOcr.visibleText + diagramSummary` 参与检索

## 当前已落地

本轮已经完成第 1 批中的核心骨架：

1. `user_error_diagnosis` context 已补：
- `historicalPatterns`
- `ruleEffectiveness`
- `userProfileSignals`
- `latestStrategySnapshot`

2. `user_strategy_refresh` context 已补：
- `diagnosisFeedbackSummary`
- `recentRulePerformance`

3. `user_error_diagnosis` result template / contract 已补：
- `usedEvidence`
- `diagnosisDecision`
- `strategyImpact`

4. `retrievedKnowledge` 已补增强字段：
- `effectScore`
- `lastUsedAt`
- `matchReason`

5. 已新增测试数据脚本：
- [seed-ai-evolution-test-data.mjs](/Users/10030299/Documents/Playground/error_manage/scripts/seed-ai-evolution-test-data.mjs)
- 命令：
  - `npm run analysis:seed:testdata -- --userId=wesly_local --count=24`

## 当前验证结果

已基于现有题库真实生成 AI 进化测试样本：

- 为 `wesly_local` 追加了 24 条可重复生成的错题历史样本
- 追加了 47 条 `review_records`
- 追加了 24 条 `practice_records`

并已用真实错题导出增强后的 bundle：

- taskId: `7e495884-4459-4870-85c8-88c832fdeaea`
- bundle:
  - [.runtime/analysis/bundles/7e495884-4459-4870-85c8-88c832fdeaea/context.json](/Users/10030299/Documents/Playground/error_manage/.runtime/analysis/bundles/7e495884-4459-4870-85c8-88c832fdeaea/context.json)

这个 context 已经能看到：

- 同题型历史错题
- 最近 3 条历史诊断
- 当前规则效果
- 用户级薄弱题型与错因标签
- 最近一次策略分析结果
- 命中的知识库方法

## 结论

AI 的进化重点不是换更大模型，而是让它越来越会：

- 记住这个用户
- 复用这个用户以前有效的方法
- 识别旧错因是否复发
- 通过后验效果修正自己
- 把单题经验反哺成训练策略

一句话路线：

```text
先检索“这个用户以前怎么错”
  -> 再检索“这类题通常怎么做”
  -> 再用 review/mastery 给规则打效果分
  -> 再把高效果规则反哺给知识库和策略层
```
