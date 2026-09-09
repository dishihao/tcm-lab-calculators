import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Break caught: treating all source tables as GC, losing gridBefore, source
// run typography, vertical continuations, or native OfficeMath.
const root = path.resolve(import.meta.dirname, '..');
const script = path.join(root, 'tools/parse_record_word_tables.ps1');
assert.ok(fs.existsSync(script), 'offline source Word parser exists');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'record-parser-test-'));
try {
  const xml = `<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><pkg:part pkg:name="/word/document.xml"><pkg:xmlData><w:document><w:body><w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:trPr/><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t>样品</w:t></w:r></w:p></w:tc><w:tc><w:tcPr/><w:p><m:oMath><m:sSub><m:e><m:r><m:t>W</m:t></m:r></m:e><m:sub><m:r><m:t>0</m:t></m:r></m:sub></m:sSub></m:oMath></w:p></w:tc></w:tr><w:tr><w:trPr/><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:tcPr/><w:p/></w:tc></w:tr><w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl></w:body></w:document></pkg:xmlData></pkg:part></pkg:package>`;
  fs.writeFileSync(path.join(dir, 'fixture.xml'), xml);
  fs.writeFileSync(path.join(dir, 'fixture.json'), JSON.stringify({ id:'fixture',kind:'原料',sourceFile:'fixture.doc',status:'ok',tables:[{index:1}]}));
  const run = spawnSync('pwsh', ['-NoProfile','-File',script,'-InventoryPath',dir], { encoding:'utf8' });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const out = JSON.parse(fs.readFileSync(path.join(dir,'parsed','fixture.json'),'utf8'));
  const table = out.tables[0];
  assert.equal(table.status, 'ok');
  assert.deepEqual(table.gridPt, [100,100,100]);
  assert.equal(table.leftPaddingPt,5);
  assert.equal(table.cells[0].paragraphs[0].runs[0].properties.bold,true);
  assert.equal(table.cells[0].paragraphs[0].runs[0].properties.fontSizePt,12);
  assert.equal(table.cells[1].paragraphs[0].runs[0].kind,'math');
  assert.equal(table.cells[2].verticalMerge,'continue');
  assert.equal(table.cells[4].gridColumnIndex,2);
  console.log('PASS offline Word parser: geometry, gridBefore, fonts, vertical merge and math');
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
