"""Private whole-document project context, independent of ten-line excerpts."""
import json
import re
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
DIRECTORY=ROOT/'output'/'record-table-inventory'
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
PKG='{http://schemas.microsoft.com/office/2006/xmlPackage}'
PATTERN=re.compile(r'^(?:\d+[.、])?(杂质|水分|干燥失重|总灰分|酸不溶性灰分|二氧化硫残留量|含量测定|醇溶性浸出物|水溶性浸出物|浸出物)(?=$|[（(:：\d])')
result={}
for file in DIRECTORY.glob('*.xml'):
    if not re.fullmatch('[a-f0-9]{64}',file.stem):continue
    xml=ET.parse(file).getroot()
    part=next(p for p in xml.findall(PKG+'part') if p.get(PKG+'name')=='/word/document.xml')
    body=part.find('.//'+W+'body')
    current=None;paragraphs=[];tables=[];sequence=[]
    for node in body:
        text=''.join(t.text or '' for t in node.iter(W+'t'))
        if node.tag==W+'tbl':
            tables.append(dict(index=len(tables)+1,heading=current,context=paragraphs[-40:]))
            sequence.append(('table',tables[-1]))
        elif text.strip():
            paragraphs.append(text)
            sequence.append(('paragraph',text))
            candidate=re.sub(r'[\s【】]','',text).removeprefix('检查')
            match=PATTERN.match(candidate)
            if not match and len(candidate)<250:
                match=re.search(r'(酸不溶性灰分|总灰分|二氧化硫残留量|含量测定|浸出物)$',candidate)
            if match:current=match.group(1)
    standard=None
    for kind,value in reversed(sequence):
        if kind=='paragraph' and '标准规定' in value and not re.search(r'RSD|理论板数|重复性',value):standard=value
        elif kind=='table':value['followingStandard']=standard
    result[file.stem]=tables
(DIRECTORY/'table-section-contexts.json').write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
print(f'Indexed full-document table sections: {len(result)} records')
