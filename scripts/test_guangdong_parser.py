from __future__ import annotations
from pathlib import Path
from docx import Document
import json
import re

QUESTION_START_RE = re.compile(r'^\s*(\d+)\.\s*【([^】]+)】\s*(.*)$')
OPTION_RE = re.compile(r'^\s*([A-D])\.\s*(.*)$')
ANSWER_RE = re.compile(r'正确答案\s*[:：]\s*([A-D](?:\s*,\s*[A-D]){0,3}|正确|错误|A,B,C,D|A,B,C|A,B,D|A,C,D|B,C,D|A,B|A,C|A,D|B,C|B,D|C,D)')

def clean(text: str) -> str:
    return re.sub(r'\s+', ' ', text.replace('\xa0', ' ')).strip()

def parse_docx(path: Path):
    rows = [clean(p.text) for p in Document(path).paragraphs]
    rows = [r for r in rows if r]
    result = []
    current = None
    for row in rows:
        m = QUESTION_START_RE.match(row)
        if m:
            if current:
                result.append(current)
            current = {'number': int(m.group(1)), 'stem': m.group(3), 'options': {}, 'answer': None, 'raw': [row]}
            continue
        if not current:
            continue
        current['raw'].append(row)
        mo = OPTION_RE.match(row)
        if mo:
            current['options'][mo.group(1)] = mo.group(2)
            continue
        ma = ANSWER_RE.search(row)
        if ma:
            current['answer'] = ma.group(1).replace(' ', '')
            continue
        if current['options'] == {} and not row.startswith('正确答案') and not row.startswith('---'):
            current['stem'] += '\n' + row
    if current:
        result.append(current)
    return result

base = Path('/mnt/data')
files = sorted(base.glob('20*.docx'))
summary = []
for path in files:
    items = parse_docx(path)
    summary.append({
        'file': path.name,
        'questions': len(items),
        'answers': sum(1 for x in items if x['answer']),
        'option_complete': sum(1 for x in items if len(x['options']) >= 2),
        'first_answer': items[0]['answer'] if items else None,
    })

out = {
    'files': summary,
    'total_files': len(summary),
    'total_questions': sum(x['questions'] for x in summary),
    'total_answers': sum(x['answers'] for x in summary),
}
Path('/mnt/data/patch_v1/docs/test-results.json').write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(out, ensure_ascii=False, indent=2))
