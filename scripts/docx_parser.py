import sys, json, zipfile, xml.etree.ElementTree as ET, base64, re

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
REL = '{http://schemas.openxmlformats.org/package/2006/relationships}'
PIC = '{http://schemas.openxmlformats.org/drawingml/2006/picture}'

path = sys.argv[1]

with zipfile.ZipFile(path, 'r') as z:
    rel_map = {}
    try:
        rel_root = ET.fromstring(z.read('word/_rels/document.xml.rels'))
        for rel in rel_root.findall(f'{REL}Relationship'):
            rid = rel.attrib.get('Id')
            target = rel.attrib.get('Target')
            if rid and target:
                rel_map[rid] = target
    except KeyError:
        pass

    image_data = {}
    for rid, target in rel_map.items():
        if 'media/' not in target:
            continue
        full_target = target.replace('..\\', '').replace('../', '')
        if not full_target.startswith('word/'):
            full_target = 'word/' + full_target.lstrip('/')
        try:
            raw = z.read(full_target)
            ext = full_target.rsplit('.', 1)[-1].lower()
            mime = {
                'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
                'gif': 'image/gif', 'bmp': 'image/bmp', 'webp': 'image/webp'
            }.get(ext, 'application/octet-stream')
            image_data[rid] = f'data:{mime};base64,' + base64.b64encode(raw).decode('ascii')
        except KeyError:
            continue

    doc_root = ET.fromstring(z.read('word/document.xml'))
    body = doc_root.find(f'{W}body')
    paragraphs = []
    if body is not None:
        for p in body.findall(f'{W}p'):
            texts = []
            images = []
            for t in p.iter(f'{W}t'):
                texts.append(t.text or '')
            for blip in p.iter(f'{A}blip'):
                rid = blip.attrib.get(f'{R}embed')
                if rid and rid in image_data:
                    images.append(image_data[rid])
            text = ''.join(texts)
            paragraphs.append({'text': text.strip(), 'images': images})

questions = []
current = None
warnings = []
question_re = re.compile(r'^\s*(\d{1,3})[\.．、]\s*(.+)$')
option_re = re.compile(r'^\s*([A-DＡ-Ｄ])[\.．、\)）:：]\s*(.+)$')
answer_re = re.compile(r'^\s*(?:答案|参考答案)\s*[:：]\s*([A-DＡ-Ｄ正确错误对错ABCD]{1,8})\s*$')
analysis_re = re.compile(r'^\s*(?:解析|答案解析|参考解析)\s*[:：]\s*(.*)$')

for para in paragraphs:
    text = para['text']
    imgs = para['images']
    if not text and not imgs:
        continue

    m = question_re.match(text)
    if m:
        if current:
            questions.append(current)
        current = {
            'no': m.group(1),
            'content': m.group(2).strip(),
            'questionImage': imgs[0] if imgs else '',
            'options': [],
            'answer': '',
            'type': '单项选择题',
            'analysis': '',
            'rawText': text,
        }
        continue

    if current is None:
        continue

    if imgs and not current.get('questionImage'):
        current['questionImage'] = imgs[0]

    opt = option_re.match(text)
    if opt:
        key = opt.group(1).translate(str.maketrans('ＡＢＣＤ', 'ABCD'))
        val = opt.group(2).strip()
        current['options'].append(f'{key}.{val}')
        continue

    ans = answer_re.match(text)
    if ans:
        current['answer'] = ans.group(1).translate(str.maketrans('ＡＢＣＤ', 'ABCD')).replace('对', '正确').replace('错', '错误')
        continue

    ana = analysis_re.match(text)
    if ana:
        current['analysis'] = (current.get('analysis', '') + '\n' + ana.group(1).strip()).strip()
        continue

    if current['options'] and len(current['options']) < 4 and option_re.search(text):
        current['options'].append(text.strip())
        continue

    if text:
        if current['analysis']:
            current['analysis'] = (current['analysis'] + '\n' + text).strip()
        elif current['options']:
            current['analysis'] = text.strip()
        else:
            current['content'] = (current['content'] + '\n' + text).strip()

if current:
    questions.append(current)

if not questions:
    warnings.append('未识别到编号题目，建议使用“1. / 1、”题号格式，或改用 JSON/TXT 导入。')

print(json.dumps({'questions': questions, 'warnings': warnings}, ensure_ascii=False))
