"""Build read-only Word underline layouts and conservative standard answers.

Only exact code/name/type/edition matches are eligible. Local provenance and
unresolved fields go to output/, while the browser receives text and answers.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import unicodedata
import xml.etree.ElementTree as ET
import zipfile

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
ROOT = Path(__file__).resolve().parents[1]


def standard_identity(filename):
    stem = Path(filename).stem
    if stem.startswith('~$'):
        return None
    match = re.match(r'^([Dd]?\d+)(.*?)(原料|成品)(?:检验(?:原始)?记(?:录)?|检验质量标准|质量标(?:准)?)', stem)
    if not match:
        return None
    code, product, kind = match.group(1, 2, 3)
    suffix = stem[match.end():]
    suffix = re.sub(r'[-\s]*副本|[.。\s]+', '', suffix)
    suffix = re.sub(r'(?<!\d)\d{1,2}$', '', suffix)
    suffix = unicodedata.normalize('NFKC', suffix)
    # Keep region and year; aliases only change synonymous wording.
    suffix = suffix.replace('上海炮规', '上海').replace('上炮', '上海').replace('浙炮', '浙江')
    suffix = suffix.replace('中国药典', '药典').replace('国家炮规', '国炮')
    suffix = re.sub(r'[()（）\s]', '', suffix)
    return code.upper(), product.strip(), kind, suffix


def split_runs(raw_runs):
    result = []
    for text, underline in raw_runs:
        for match in re.finditer(r'[_＿]{2,}|[^_＿]+|[_＿]', text):
            part = match.group()
            pieces = re.split(r'([ \t\u00a0\u3000]+)', part) if underline else [part]
            for value in pieces:
                if not value:
                    continue
                blank = bool(re.fullmatch(r'[_＿]{2,}', value) or
                             (underline and value.isspace()))
                run = {'text': value, 'blank': blank}
                if underline:
                    run['underline'] = True
                if result and result[-1].get('blank') == blank and (blank or result[-1].get('underline') == run.get('underline')):
                    result[-1]['text'] += value
                else:
                    result.append(run)
    return result


def normalize(text):
    value = unicodedata.normalize('NFKC', text)
    return re.sub(r'\s+', '', value).replace('﹕', ':')


def match_answers(runs, standard_paragraphs):
    """Require the complete record paragraph, including all method conditions."""
    blanks = [i for i, run in enumerate(runs) if run.get('blank')]
    answers = [''] * len(blanks)
    text = ''.join(run['text'] for run in runs)
    if re.search(r'型号|编号|批号|检验人|复核人|配制批|配置批', text):
        return answers
    paragraphs = [normalize(p) for p in standard_paragraphs if p.strip()]
    tokens = []
    for run in runs:
        if run.get('blank'):
            tokens.append(f'\x01{len([s for s in tokens if s.startswith(chr(1))])}\x02')
        else:
            tokens.append(normalize(run['text']))
    tagged = ''.join(tokens)
    # Remove only a recognizable extra actual-mass entry after a fixed nominal
    # quantity. Do not discard reagent, concentration, layer or wavelength text.
    tagged = re.sub(r'(\d+(?:\.\d+)?(?:g|ml))\(\x01\d+\x02(?:g|ml)?\)', r'\1', tagged)
    # Actual weighed masses are batch data even if a standard supplies a nominal mass.
    excluded = set()
    for j, index in enumerate(blanks):
        right = normalize(''.join(r['text'] for r in runs[index + 1:index + 3]))
        if re.match(r'^[)）]?g(?:[,，)。；;]|$)', right, re.I):
            excluded.add(j)
    for sentence in [tagged]:
        indices = [int(n) for n in re.findall('\x01(\d+)\x02', sentence)]
        if not indices:
            continue
        sentence = re.sub(r'^(?:\(\d+\)|\d+[.、])', '', sentence)
        sentence = re.sub(r'^(?:测定法|检验结果|实验方法及结果)[:：]', '', sentence)
        parts = re.split(r'(\x01\d+\x02)', sentence)
        static_length = sum(len(p) for p in parts if not p.startswith('\x01'))
        if static_length < 8:
            continue
        pattern = r'(?<!\w)' + ''.join('([^。；;]{1,80}?)' if p.startswith('\x01') else re.escape(p) for p in parts)
        if not re.search(r'[。；;]$', sentence):
            pattern += r'(?=[。；;]|$)'
        choices = {m.groups() for p in paragraphs for m in re.finditer(pattern, p)}
        if len(choices) == 1:
            for index, value in zip(indices, next(iter(choices))):
                if index not in excluded:
                    answers[index] = value
            continue
    return answers


def read_word_text(path):
    if path.read_bytes()[:4] == b'PK\x03\x04':
        with zipfile.ZipFile(path) as archive:
            root = ET.fromstring(archive.read('word/document.xml'))
        return '\n'.join(''.join(n.text or '' for n in p.iter(W + 't')) for p in root.iter(W + 'p'))
    import olefile
    with olefile.OleFileIO(path) as ole:
        wd = ole.openstream('WordDocument').read()
        flags = struct.unpack_from('<H', wd, 10)[0]
        table = ole.openstream('1Table' if flags & 0x0200 else '0Table').read()
        offset, length = struct.unpack_from('<II', wd, 0x1A2)
        clx = table[offset:offset + length]
        pos = 0
        while pos < len(clx):
            tag = clx[pos]; pos += 1
            if tag == 1:
                pos += 2 + struct.unpack_from('<H', clx, pos)[0]
                continue
            if tag != 2:
                break
            size = struct.unpack_from('<I', clx, pos)[0]; pos += 4
            pcdt = clx[pos:pos + size]
            count = (size - 4) // 12
            cps = struct.unpack_from('<' + 'I' * (count + 1), pcdt, 0)
            chunks = []
            for i in range(count):
                fc = struct.unpack_from('<I', pcdt, 4 * (count + 1) + i * 8 + 2)[0]
                compressed = bool(fc & 0x40000000)
                start = (fc & 0x3fffffff) // (2 if compressed else 1)
                chars = cps[i + 1] - cps[i]
                chunks.append(wd[start:start + chars * (1 if compressed else 2)].decode('cp1252' if compressed else 'utf-16le'))
            return ''.join(chunks)
    raise ValueError('No readable Word piece table')


def paragraph_runs(paragraph):
    raw = []
    for run in paragraph.iter(W + 'r'):
        text = ''.join((n.text or '') if n.tag == W + 't' else '\t' if n.tag == W + 'tab' else '\n'
                       for n in run if n.tag in (W + 't', W + 'tab', W + 'br'))
        u = run.find(W + 'rPr/' + W + 'u')
        raw.append((text, u is not None and u.get(W + 'val') not in ('none', '0')))
    return split_runs(raw)


def canonical(text):
    return re.sub(r'[\s_＿]+', '', text)


def resolve_block(block, paragraphs):
    """Use the section heading and ordered lines to disambiguate repeated fields."""
    title = canonical(block['title'])
    anchors = [i for i, (text, _) in enumerate(paragraphs) if canonical(text) == title]
    if not anchors:
        first = canonical(block['lines'][0])
        anchors = [i - 1 for i, (text, _) in enumerate(paragraphs) if canonical(text) == first]
    solutions = []
    for anchor in anchors:
        cursor, selected = anchor + 1, []
        for line in block['lines']:
            found = next((i for i in range(cursor, min(len(paragraphs), anchor + 100))
                          if canonical(paragraphs[i][0]) == canonical(line)), None)
            if found is None:
                break
            selected.append(paragraphs[found][1])
            cursor = found + 1
        if len(selected) == len(block['lines']):
            solutions.append((cursor - anchor, selected))
    if not solutions:
        return None
    shortest = min(size for size, _ in solutions)
    unique = {json.dumps(runs, ensure_ascii=False): runs for size, runs in solutions if size == shortest}
    return next(iter(unique.values())) if len(unique) == 1 else None


def build(inventory, standard_roots):
    source = (ROOT / 'assets/physicochemical-templates.js').read_text(encoding='utf-8')
    templates = json.loads(re.search(r'const PHYSICOCHEMICAL_TEMPLATES = (.*);', source).group(1))
    records, standards = {}, {}
    for path in inventory.glob('*.json'):
        meta = json.loads(path.read_text(encoding='utf-8-sig'))
        if isinstance(meta, dict) and meta.get('sourceFile') and meta.get('status') == 'ok':
            records[(meta['kind'], meta['sourceFile'])] = (path, meta)
    for directory in standard_roots:
        for path in directory.glob('*.doc*'):
            identity = standard_identity(path.name)
            if identity:
                standards.setdefault(identity, []).append(path)
    layouts, audit = {}, []
    for template in templates:
        entry = records.get((template['kind'], template['sourceFile']))
        candidates = standards.get(standard_identity(template['sourceFile']), []) if standard_identity(template['sourceFile']) else []
        # Duplicates are acceptable only if byte-identical; choose no arbitrary variant.
        candidates_by_hash = {hashlib.sha256(p.read_bytes()).hexdigest(): p for p in candidates}
        standard = next(iter(candidates_by_hash.values())) if len(candidates_by_hash) == 1 else None
        paragraphs, read_error = [], ''
        if standard:
            try:
                paragraphs = re.split(r'[\r\n\x07\x0b]+', read_word_text(standard))
            except Exception as exc:
                read_error = str(exc)
        blocks, missing, filled, blank_count = [], [], 0, 0
        lookup, ordered_paragraphs, width_px = {}, [], 664
        if entry:
            path, meta = entry
            # A stale cache cannot silently redefine the source fields.
            source_path = Path(meta['sourcePath'])
            if source_path.is_file() and hashlib.sha256(source_path.read_bytes()).hexdigest().upper() == meta['sha256Before'].upper():
                doc = ET.parse(path.with_suffix('.xml'))
                sections = list(doc.iter(W + 'sectPr'))
                if sections:
                    page, margins = sections[-1].find(W + 'pgSz'), sections[-1].find(W + 'pgMar')
                    if page is not None and margins is not None:
                        width_px = round((int(page.get(W + 'w')) - int(margins.get(W + 'left', 0))
                                          - int(margins.get(W + 'right', 0))) / 15, 3)
                for p in doc.iter(W + 'p'):
                    runs = paragraph_runs(p)
                    ordered_paragraphs.append((''.join(r['text'] for r in runs), runs))
                    lookup.setdefault(canonical(''.join(r['text'] for r in runs)), []).append(runs)
        for block in template['blocks']:
            lines = []
            resolved = resolve_block(block, ordered_paragraphs)
            for line_index, text in enumerate(block['lines']):
                matches = lookup.get(canonical(text), [])
                unique = {json.dumps(r, ensure_ascii=False): r for r in matches}
                if resolved:
                    runs = json.loads(json.dumps(resolved[line_index]))
                elif len(unique) == 1:
                    runs = json.loads(next(iter(unique)))
                else:
                    runs = split_runs([(text, False)])
                    missing.append(text)
                values = match_answers(runs, paragraphs) if resolved or len(unique) == 1 else [''] * sum(r['blank'] for r in runs)
                for run in runs:
                    if run['blank']:
                        value = values.pop(0)
                        run['answer'] = value
                        blank_count += 1
                        filled += bool(value)
                lines.append({'runs': runs})
            blocks.append({'title': block['title'], 'lines': lines})
        status = 'verified' if standard and paragraphs and not missing else 'partial' if filled else 'review'
        layouts[template['id']] = {'blocks': blocks, 'standardFile': standard.name if standard and paragraphs else '',
                                  'status': status, 'filled': filled, 'blankCount': blank_count,
                                  'layoutVerified': not missing, 'widthPx': width_px}
        audit.append({'id': template['id'], 'record': template['sourceFile'], 'standard': str(standard) if standard else '',
                      'standardCandidates': [str(p) for p in candidates], 'readError': read_error,
                      'missingLines': missing, 'filled': filled, 'blankCount': blank_count, 'status': status})
    asset = ROOT / 'assets/physicochemical-answers.js'
    asset.write_text('/* Generated by tools/build_physicochemical_answers.py; local Word records and exact matching standards. */\n'
                     + 'const PHYSICOCHEMICAL_ANSWER_LAYOUTS = ' + json.dumps({'version': 1, 'templates': layouts}, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    report = ROOT / 'output/physicochemical-qa/answer-mapping.json'
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'templates': len(layouts), 'layoutVerified': sum(v['layoutVerified'] for v in layouts.values()),
                      'standards': sum(bool(v['standardFile']) for v in layouts.values()),
                      'filled': sum(v['filled'] for v in layouts.values()), 'blankCount': sum(v['blankCount'] for v in layouts.values()),
                      'recordsWithAnswers': sum(v['filled'] > 0 for v in layouts.values())}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', type=Path, default=ROOT / 'output/record-table-inventory')
    parser.add_argument('--standards', type=Path, action='append', required=True)
    args = parser.parse_args()
    build(args.inventory, args.standards)
