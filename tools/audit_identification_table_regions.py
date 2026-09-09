"""Read exported Word XML to audit actual tables inside identification sections."""
import json
import re
import subprocess
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
INVENTORY = ROOT / 'output' / 'record-table-inventory'
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
PKG = '{http://schemas.microsoft.com/office/2006/xmlPackage}'

def compact(value):
    return re.sub(r'[\s_]+', '', value).replace('（', '(').replace('）', ')')

def boundary(text):
    return bool(re.search(r'【(?:性状|检查|含量测定|浸出物|性味|功能|贮藏)', text)
                or re.match(r'^(?:检验人|复核人)[/／]日期', text)
                or re.match(r'^(?:水分|杂质|总灰分|酸不溶性灰分|二氧化硫|浸出物)', text)
                or re.match(r'^(?:【鉴别】)?\(?[一二三四五六七八九\d]+\)?[.、]?(?:显微|薄层|理化)', text))

def audit():
    command = "const fs=require('fs'),vm=require('vm'),c={};vm.runInNewContext(fs.readFileSync('assets/identification-templates.js','utf8')+';this.d=IDENTIFICATION_TEMPLATES',c);process.stdout.write(JSON.stringify(c.d));"
    templates=json.loads(subprocess.check_output(['node','-e',command],cwd=ROOT).decode('utf-8'))
    sources={}
    for file in INVENTORY.glob('*.json'):
        if not re.fullmatch(r'[a-f0-9]{64}',file.stem): continue
        source=json.loads(file.read_text(encoding='utf-8-sig'))
        sources.setdefault(source['sourceFile'],[]).append(source)
    cache={}; results=[]
    for template in templates:
        matches=sources.get(template['sourceFile'],[])
        same_kind=[source for source in matches if source['kind']==template['kind']]
        if same_kind: matches=same_kind
        if len(matches)!=1:
            results.append(dict(templateId=template['id'],status='source-ambiguous',regions=[]));continue
        source=matches[0]
        if source['id'] not in cache:
            root=ET.parse(INVENTORY/(source['id']+'.xml')).getroot()
            part=next(p for p in root.findall(PKG+'part') if p.get(PKG+'name')=='/word/document.xml')
            body=part.find('.//'+W+'body')
            sequence=[]; table_index=0
            for node in body:
                text=''.join(t.text or '' for t in node.iter(W+'t'))
                if node.tag==W+'tbl': table_index+=1
                sequence.append(dict(type='table' if node.tag==W+'tbl' else 'paragraph',text=compact(text),index=table_index))
            cache[source['id']]=sequence
        sequence=cache[source['id']]; regions=[]
        for block in template['blocks']:
            heading=compact(block['title'])
            starts=[i for i,node in enumerate(sequence) if node['type']=='paragraph' and heading in node['text']]
            if not starts:
                regions.append(dict(heading=block['title'],status='heading-ambiguous',tables=[]));continue
            selected=[]
            for start in starts:
                for node in sequence[start+1:]:
                    if node['type']=='paragraph' and boundary(node['text']): break
                    if node['type']=='table': selected.append(node['index'])
            selected=sorted(set(selected))
            regions.append(dict(heading=block['title'],status='has-tables' if selected else 'no-table',tables=selected))
        status='no-table' if regions and all(region['status']=='no-table' for region in regions) else 'needs-review'
        results.append(dict(templateId=template['id'],project=template['item'],sourceId=source['id'],sourceFile=source['sourceFile'],status=status,regions=regions))
    summary={}
    for result in results:
        summary[result['status']]=summary.get(result['status'],0)+1
    (INVENTORY/'identification-regions.json').write_text(json.dumps(dict(summary=summary,templates=results),ensure_ascii=False,indent=2),encoding='utf-8')
    public={result['templateId']:result['status'] for result in results}
    (ROOT/'assets'/'identification-record-tables.js').write_text(
        '/* Generated from source identification-section table audit. */\nwindow.IDENTIFICATION_RECORD_TABLES='+json.dumps(public,separators=(',',':'))+';\n',encoding='utf-8')
    print(json.dumps(summary))

if __name__=='__main__': audit()
