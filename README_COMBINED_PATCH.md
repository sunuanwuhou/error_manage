# Combined patch

This package merges:
- rules integration patch
- Guangdong DOCX import parser + self-test patch

Main additions:
- docs/rules/开发铁规.md
- .githooks/pre-push
- .github/workflows/quality-gates.yml
- src/lib/import/guangdong-docx-parser.ts
- src/lib/import/import-page-guidance.md
- scripts/test_guangdong_parser.py
- docs/test-results.json

Apply this patch at the repo root.
