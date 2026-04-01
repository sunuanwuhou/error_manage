# 广东行测 DOCX 导入优化补丁

## 这次补的核心
- 改成按题号边界切题，而不是按邻近片段或固定窗口截断
- `正确答案:` 直接从 DOCX 行里抓取，支持单选、多选、判断题
- 原文对照默认只显示当前题的原文块
- 上传区建议收口为单一文件选择入口

## 目录
- `src/lib/import/guangdong-docx-parser.ts`：新的解析器与当前题原文切片函数
- `src/lib/import/import-page-guidance.md`：导入页要改的 UI/交互说明
- `scripts/test_guangdong_parser.py`：基于用户提供 12 份 DOCX 的测试脚本
- `docs/test-results.json`：测试结果
