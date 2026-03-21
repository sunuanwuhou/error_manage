# AI 移交设计说明

> Updated: 2026-03-21  
> 目的：把 AI 相关工作从“当前轮持续开发”切换为“可交给其他人接手的设计输入”。

---

## 1. 当前口径

当前项目对 AI 的要求是：

- 保持主流程稳定
- 明确 AI 结果落点
- AI 失败时不能炸主流程

本轮**不继续**深做：
- `analysis-worker` 深化
- RAG 质量提升
- 向量召回增强
- 规则效果评分闭环
- 更复杂 OCR / 图题理解增强
- 多题归纳与社区洞察

这些工作保留为设计和移交材料。

---

## 2. 现有基础设施

### 主应用侧

- 单题诊断接口：
  - `src/app/api/errors/[id]/diagnose/route.ts`
- OCR 入口：
  - `src/app/api/ai/ocr/route.ts`
- 统一 AI provider：
  - `src/lib/ai/provider.ts`
- 知识沉淀与知识树：
  - `src/lib/knowledge-notes.ts`
  - `src/app/api/notes/route.ts`
  - `src/app/api/insights/route.ts`

### 分析侧

- `analysis-worker/src/index.mjs`
- `docs/architecture/Codex高频分析执行方案.md`
- `docs/architecture/Codex分析执行手册.md`
- `docs/architecture/AI进化路线图.md`

---

## 3. AI 结果的正确落点

AI 不应新增独立页面或独立心智。

### 允许的落点

- 单题错因：
  - `user_errors`
- 规则摘要：
  - 挂到知识点 / 知识树
- 用户级策略建议：
  - `system_insights`
- 公共/私有知识：
  - `knowledge_entries`

### 不建议继续新增的落点

- 新的独立“AI 页面”
- 新的独立“规律模块”
- 与主练习链脱节的 AI 结果页

---

## 4. 外部团队接手时最值得继续做的方向

### 4.1 `analysis-worker` 深化

目标：
- 队列稳定消费
- 结果幂等落库
- 更可靠的 bundle/export/apply 流程

建议输入：
- 队列协议
- 样例 bundle
- 当前表结构

### 4.2 RAG 与知识召回

目标：
- 先找用户历史，再找公共知识
- 提高诊断的“个人化”和“领域味”

建议输入：
- `knowledge_entries`
- `analysis_snapshots`
- `system_insights`
- 知识召回规则

### 4.3 规则效果反馈闭环

目标：
- 不是只生成规则，而是知道哪些规则对这个用户有效

建议输入：
- `user_errors`
- `review_records`
- `practice_records`
- `analysis_snapshots`

### 4.4 OCR / 图题理解增强

目标：
- 图题、资料分析、扫描卷处理更稳

建议输入：
- 当前 OCR 路由
- 图片题样本
- 导入质量审计规则

---

## 5. 当前轮保留给主应用的 AI 工作

这些仍属于主应用本轮范围：

- AI 调用失败时的降级体验
- AI 不影响用户继续做题
- AI 结果能自然落到错题 / 知识树 / 策略

换句话说：

**主应用负责“AI 怎么不拖后腿”，外部团队负责“AI 怎么真正变强”。**

---

## 6. 交接时建议提供的材料

建议至少提供：

1. 当前表结构摘要
2. 主应用中 AI 相关路由清单
3. `analysis-worker` 入口和 bundle 样例
4. 一份真实的错题诊断输入/输出样例
5. 当前已知限制：
   - 先保证主流程稳定
   - 不新增独立 AI 产品心智
   - AI 结果必须回流到已有对象
