# 文档导航

```
docs/
├── README.md                      ← 你在这里
│
├── 项目总览与路线图.md            系统目标 / 主闭环 / 阶段路线图 / 优先级口径
│
├── spec/
│   └── 技术方案_v7.9.md           系统完整设计文档（74个功能的详细方案）
│
├── progress/
│   └── 完成度清单.md              功能实现状态 + 待办缺口
│   └── 系统审视与问题跟进.md      系统级问题审计与验证状态
│   └── 问题复盘与防再犯清单.md    真实踩坑记录 + 防再犯规则
│
├── architecture/
│   ├── 数据流设计.md              三层数据结构（ActivityLog/Snapshot/Insight）
│   └── AI分析飞轮.md             理论→实践→反哺理论 的循环设计
│
├── 受限环境改动同步规范.md        公司电脑/受限机器下的改动回传与交接流程
│
└── decisions/
    └── 设计决策记录.md            为什么这样设计（ADR格式）
```

## 阅读路径

**先快速建立全局认知** → `项目总览与路线图.md`  
**第一次了解系统** → `spec/技术方案_v7.9.md`  
**查看实现进度** → `progress/完成度清单.md`  
**查看最近一轮状态** → `progress/current_snapshot.md`  
**查看系统性问题** → `progress/系统审视与问题跟进.md`  
**查看历史踩坑与防再犯规则** → `progress/问题复盘与防再犯清单.md`  
**受限环境下同步改动** → `受限环境改动同步规范.md`  
**理解数据架构** → `architecture/数据流设计.md`  
**理解AI飞轮** → `architecture/AI分析飞轮.md`  
**理解设计取舍** → `decisions/设计决策记录.md`  
**实现分析服务** → `../analysis-worker/ARCHITECTURE.md`
