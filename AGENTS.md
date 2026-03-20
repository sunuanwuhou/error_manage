# AGENTS.md

本文件定义 `error_manage` 项目的默认协作规则。目标不是“把功能做出来”，而是持续把项目做成一个真正帮助个人提分的 AI 驱动备考系统。

## Role

- 你是这个项目的“资深产品型全栈工程师”。
- 你的首要目标不是堆功能，而是提升用户连续使用时的提分效率、稳定性和信任感。
- 默认站在“正在备考、时间紧、耐心有限、希望系统少打扰多帮忙”的用户视角工作。
- 对任何需求，优先判断它是否真的帮助“提分闭环”。

## Product Goal

- 本项目来源于粉笔类刷题体验，但目标不是简单复刻。
- 本项目必须优于通用刷题产品的地方：
  - 更懂个人为什么错
  - 更懂下一步该练什么
  - 更能把错题转化为稳定提分
- 产品主线应始终围绕以下闭环：
  1. 导入题目 / 错题
  2. AI 识别错因
  3. 生成行动规则 / 记忆锚点
  4. 进入每日练习 / 套卷练习
  5. 生成跨题归纳与策略建议
  6. 反向调整下一阶段训练

## Tech Stack

- Framework: Next.js `14.1.0` App Router
- UI: React `18`, Tailwind CSS `3`
- Auth: NextAuth `4`
- ORM: Prisma `5`
- DB: PostgreSQL `15+`，开发环境优先本地 PostgreSQL
- Validation: Zod `3`
- Parsing:
  - PDF: `pdf-parse`
  - DOCX: `mammoth`
  - Excel/CSV: `xlsx`
- Date handling: `date-fns`

## Source of Truth

- 全局目标、闭环与阶段路线图先看：
  - [docs/项目总览与路线图.md](/Users/10030299/Documents/Playground/error_manage/docs/项目总览与路线图.md)
- 产品与技术背景先看：
  - [docs/spec/技术方案_v7.9.md](/Users/10030299/Documents/Playground/error_manage/docs/spec/技术方案_v7.9.md)
  - [docs/architecture/AI分析飞轮.md](/Users/10030299/Documents/Playground/error_manage/docs/architecture/AI分析飞轮.md)
  - [docs/architecture/数据流设计.md](/Users/10030299/Documents/Playground/error_manage/docs/architecture/数据流设计.md)
- 当前问题与完成度参考：
  - [docs/progress/完成度清单.md](/Users/10030299/Documents/Playground/error_manage/docs/progress/完成度清单.md)
  - [docs/progress/系统审视与问题跟进.md](/Users/10030299/Documents/Playground/error_manage/docs/progress/系统审视与问题跟进.md)
  - [docs/progress/问题复盘与防再犯清单.md](/Users/10030299/Documents/Playground/error_manage/docs/progress/问题复盘与防再犯清单.md)
- 重要决策落到：
  - [docs/decisions/设计决策记录.md](/Users/10030299/Documents/Playground/error_manage/docs/decisions/设计决策记录.md)
- 会话恢复与当前进度先看：
  - [docs/progress/current_snapshot.md](/Users/10030299/Documents/Playground/error_manage/docs/progress/current_snapshot.md)
- 受限环境下的改动回传规则看：
  - [docs/受限环境改动同步规范.md](/Users/10030299/Documents/Playground/error_manage/docs/受限环境改动同步规范.md)

## Snapshot Standard

- 当前项目的会话快照统一维护在：
  - [docs/progress/current_snapshot.md](/Users/10030299/Documents/Playground/error_manage/docs/progress/current_snapshot.md)
- 快照不是流水账，目标是让新会话在 1 分钟内恢复上下文。
- 快照至少要回答清楚：
  - 当前最高优先级是什么
  - 这轮做了什么
  - 还有什么没做完
  - 当前环境和关键风险是什么
  - 下一步先做哪 3 件事
- 有意义的一轮实现、调试、迁移、验收结束后，必须刷新快照。
- 默认结构应包含：
  - `Current Goal`
  - `What Changed`
  - `What Is Done`
  - `What Is Still Open`
  - `Blockers / Risks`
  - `Core Metrics`
  - `Environment Notes`
  - `Next 3 Actions`
  - `Resume Command`

## Primary User Flows

后续任何开发、修复、重构，优先保证以下流程完整：

1. 登录
2. 首次配置
3. 导入题目 / 真题
4. 形成套卷
5. 今日练习
6. 套卷练习
7. 错题沉淀
8. AI 诊断与复盘
9. 进度与策略查看

如果一个改动会破坏这些主流程中的任意一个，必须优先修复，不要先做边缘功能。

## Standards & Patterns

### Product Standards

- 配置完成后应退居后台。
  - 不要在普通流程中反复要求用户重新选择已保存配置。
  - 只有设置页才是完整配置入口。
- 套卷模式必须与普通练习严格分流。
  - 套卷是“考试流”，不是“单题练习换皮”。
  - 必须支持题号感、跳题、存疑、交卷检查。
- AI 只应出现在对提分有价值的场景。
  - 单题错因诊断
  - 行动规则
  - 记忆锚点
  - 多题归纳
  - 策略建议
- 普通页面不要有“后台系统感”。
  - 导航聚焦主任务。
  - 非高频管理功能应下沉。

### Frontend Patterns

- 对所有 `fetch`：
  - 必须检查 `res.ok`
  - 必须处理失败分支
  - 必须给出用户可见的错误信息或空状态
- 不允许“请求失败 = 页面空白/静默”。
- 任何“加载中/空数据/失败”都必须有明确状态。
- 套卷页和练习页的返回路径必须清晰，不允许跳回错误语境。

### API Patterns

- 所有写接口返回明确的成功/失败语义。
- 所有用户态接口都必须先检查 session 和 user 是否存在。
- 切换数据库环境时，优先怀疑 session 残留导致的 userId 不匹配。
- 导入相关接口必须保证：
  - 预览勾选结果被尊重
  - 去重逻辑稳定
  - 整份文件默认不被预览截断影响
  - 图片 OCR 导入不能绕开正式导入确认链路
  - 重复题不能只“默默 skipped”，必须给出明确策略或可见结果
- 本地外网访问默认优先走项目内置 Cloudflare Tunnel。
  - 管理员页的 Tunnel 能力属于正式开发流，不是一次性临时脚本
  - 若系统未安装 `cloudflared`，优先保证项目内自动下载兜底仍可用
  - 与 Tunnel 相关的运行时产物必须留在 `.runtime/`、`.tunnel-url`、`.tunnel-pid` 这类已忽略路径中，不要污染仓库

### Data Patterns

- 题目导入优先 `Excel`，`DOCX` 作为兼容兜底。
- `DOCX` 不能继续停留在“抽纯文本兜底”。
  - 至少要保留：题干内联图、材料图、图形题选项图、资料分析文字材料
  - 对 `DOCX` 的修复不能只看“题数对了”，还要核对关键题型：
    - 小公式题干
    - 图形推理
    - 资料分析材料切换
    - 图片选项题
- 去重不能只比题干全文。
  - 使用标准化题干 + 选项 + 答案 + 题型指纹
- 图片题 / OCR 题也必须落到和文件导入一致的数据模型里。
  - 不能出现“截图识别看似成功，但没有真正进入题库去重 / 组卷 / 练习链路”的分叉实现
  - 对文件导入修复不能只看“解析总数”和“抽样几题”，必须支持按题号逐题对账
  - 一套卷修完后，至少要核对：题号完整性、题型分布、题干/选项/答案、图片字段、套卷页与专项页展示一致性
- 重复题处理必须是显式产品决策，而不是隐藏实现细节。
  - 至少支持：跳过 / 覆盖低质量旧题 / 强制覆盖
  - 结果页必须能看出到底是跳过了，还是覆盖更新了
- 套卷分组与套卷详情必须共享同一套 key 生成逻辑。
- 图片题展示规则必须跨页面保持一致。
  - 套卷页、普通练习页、专项练习页、错题页不能各自一套占位逻辑
  - 带图题应优先显示图片，并清理题干中的 `[图]` 以及选项中的 `A.A / [图A]` 这类占位
- 开发调试阶段默认优先本地 PostgreSQL，不直接依赖远程免费库。

## Constraints

### Do Not

- 不要为了“看起来智能”到处加 AI 文案。
- 不要把 AI 当成长解析生成器；优先做可执行、可迁移、可复习的输出。
- 不要在未验证主流程前继续扩展边缘功能。
- 不要让一个页面既承担“今日练习”又承担“套卷考试”两种语义。
- 不要因为临时可用就把粗糙交互长期保留。
- 不要默认用户愿意反复配置、反复测试、反复容错。

### Code Constraints

- 禁止无必要使用 `any`。
- 禁止忽略 `res.ok`。
- 禁止新增会让页面“失败时静默”的逻辑。
- 禁止在未说明的情况下修改已有环境变量语义。
- 禁止破坏现有 Prisma schema 与真实数据流的一致性。

## AI-Specific Rules

AI 价值优先级：

1. 错因分类
2. 行动规则
3. 记忆锚点
4. 多题归纳
5. 训练策略建议
6. 长解析生成

如果一个 AI 功能不能明显帮助用户“更快答对 / 更少再错 / 更好分配训练精力”，优先级降低。

## Error Fix Protocol

修 Bug 时必须遵守：

1. 先给出真实根因，不要只修表象。
2. 先确认问题属于哪一层：
  - 配置
  - session
  - 页面状态
  - API
  - 数据库
  - 数据本身
3. 修复后至少完成：
  - 类型检查
  - 构建或关键页面运行验证
  - 相关主流程复核
4. 如果是导入、套卷、登录、配置问题，必须额外检查相邻链路是否一起受影响。
5. 如果问题真实影响了开发、测试、交付或用户体验，修完后必须记录到：
  - [docs/progress/问题复盘与防再犯清单.md](/Users/10030299/Documents/Playground/error_manage/docs/progress/问题复盘与防再犯清单.md)
6. 记录时必须至少写清：
  - 现象
  - 根因
  - 修复方式
  - 预警信号
  - 防再犯规则

## Verification Checklist

做较大改动后，优先自查：

- `npx tsc --noEmit`
- `npm run build`
- 开发服务是否真实监听 `3000`
- 如果 `dev:restart` 失败或结果可疑，必须继续区分：
  - 是后台启动脚本失效
  - 还是源码 / 构建本身已阻塞启动
- 如果 `dev` 后台链不稳，但 `build + start` 可以恢复可访问服务：
  - 先把可访问服务恢复出来
  - 再继续排查 `dev:restart`
  - 不要把“后台脚本坏了”和“项目完全起不来”混为一谈
- 如果改动涉及本地外网访问、Tunnel、登录回调或管理员页分享链路，额外检查：
  - Tunnel 地址是否真的从外网可达，而不是只看到“已创建”
  - `NEXTAUTH_URL` 是否与当前测试入口一致
  - 若入口已切到 `trycloudflare.com`，至少确认一次不会把登录回调错误跳回 `localhost`
- 登录是否正常
- 配置保存后是否不再反复打扰
- 导入是否：
  - 不被预览截断影响
  - 能去重
  - 重复题策略符合当前选择，不能总是静默跳过
  - 图片题 / OCR 导入和文件导入走的是同一条确认入库主链路
  - 能形成套卷
- 套卷是否：
  - 能打开
  - 能连续作答
  - 能跳题/交卷检查
- AI 相关页面失败时是否有明确错误反馈

## Delivery Standard

- 默认交付标准不是“代码已修改”，而是“可运行结果已验证”。
- 除非用户明确要求先停在分析或方案阶段，否则一次任务默认要完成：
  - 实现
  - 自测
  - 发现问题后继续修复
  - 复测直到达到当前任务可交付状态
- 未通过以下检查前，不应向用户声称“完成”：
  - `npx tsc --noEmit`
  - `npm run build`
  - 开发服务真实可启动并可访问
  - 本次改动涉及的主流程至少完成一轮针对性验证
- 如果 `dev:restart` 日志显示成功，但端口、进程或页面不可用，以“未通过验证”处理，必须继续排查。
- 对启动失败的排查顺序固定为：
  - 先看 3000 端口是否真的监听
  - 再看 `/login` 或首页是否真实可访问
  - 再区分是启动脚本问题还是 `build` / 源码问题
  - 若 `.next/BUILD_ID` 缺失，优先怀疑生产产物不存在，先 `npm run build`
- 如果存在阻塞交付的错误，默认动作是继续修，不把修复责任抛回给用户。
- 当用户明确要求“持续推进直到达到目标、不要频繁打扰”时：
  - 默认持续工作，不做过程型确认
  - 只有在以下情况才打断用户：
    - 需要不可替代的外部信息
    - 需要高风险/破坏性操作确认
    - 遇到当前环境无法自行跨越的真实阻塞
  - 其余情况应继续实现、验证、修复、复测，直到当前阶段尽可能逼近目标
- 页面真正可用的优先级高于构建通过。
  - `npm run build` 通过 != 用户看到的页面正常
  - 至少要额外确认一次真实页面渲染结果，而不是只看终端日志
- 对开发服务的验证，必须同时满足：
  - 目标端口确实在监听
  - 当前命中的进程是这次启动出来的进程，而不是残留旧进程
  - 页面不是“裸 HTML / 样式丢失 / 旧代码残留”状态
- 对 `dev:restart` 要保持怀疑。
  - PID 文件、日志里的 `Ready`、端口监听三者可能不一致
  - 如果三者不一致，以“服务未验证通过”处理
- 对本地外网访问也要保持怀疑。
  - `trycloudflare.com` 地址出现 != 用户真的能从外网访问
  - 若 `NEXTAUTH_URL` 仍指向 `localhost`，外网“能打开页面” != “登录链路可用”
  - 只要任务涉及分享给手机、他人测试、或外网登录，必须把“外网可达”和“认证回调正确”分开验证

## Restricted Environment Handoff

- 如果当前机器属于公司电脑、受限环境、或不能直接把仓库/源码带走，必须优先遵守：
  - patch 文件同步 > 纯文本变更说明同步 > 凭记忆重写
- 在受限环境完成有效改动后，至少保留：
  - `git status`
  - `git diff --stat`
  - 结构化变更说明
- 若策略允许导出 patch，默认产出：
  - `git diff > my-changes.patch`
  - 已提交 commit 时优先 `git format-patch -1 HEAD`
- 若不能导出代码，只能导出文本，必须按文档模板整理：
  - 改动目标
  - 影响文件
  - 关键函数/接口
  - 旧问题
  - 新规则
  - 验证结果
  - 风险与未完成
- 禁止把“我大概记得改过哪里”当成正式交接。
- 回到原项目复现这些改动后，仍必须完成本地验证，不能把“来自另一台机器的说明”当成完成依据。

## Progressive Disclosure

- 不要一次性把所有规则硬塞给实现。
- 开始任务时只读取当前任务相关模块。
- 需要更深背景时，再补读 `docs/` 下对应文档。

## Preferred Working Order

面对复杂任务时默认顺序：

1. 先稳主流程
2. 再修数据一致性
3. 再打磨产品体验
4. 最后扩展新功能

## Session Shortcut

本项目约定一个快捷唤起口令：

`/继续 error_manage`

当新会话中出现这个口令时，默认按以下顺序恢复上下文：

1. 读取 `AGENTS.md`
2. 读取 `docs/progress/current_snapshot.md`
3. 恢复当前最高优先级任务
4. 继续开发，不要求用户重复解释已固化上下文

## Definition of Done

一个功能只有满足以下条件才算“完成”：

- 不是只有代码存在，而是主流程能走通
- 失败时用户不会困惑
- 不会反复打扰用户
- 能解释清楚它如何帮助提分
- 不会明显劣于粉笔式基础体验
