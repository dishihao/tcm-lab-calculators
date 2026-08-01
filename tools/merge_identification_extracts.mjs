import fs from 'node:fs';

const [, , outputPath, ...inputPaths] = process.argv;
if (!outputPath || inputPaths.length < 1) {
  throw new Error('用法：node tools/merge_identification_extracts.mjs 输出.json 分段1.json [分段2.json ...]');
}

const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const parts = inputPaths.map(read);
const records = parts.flatMap(part => part.records || []);
const ambiguous = parts.flatMap(part => part.ambiguous || []);
const errors = parts.flatMap(part => part.errors || []);
const scopeFileCounts = new Set(parts.map(part => part.scan && part.scan.scopeFileCount).filter(Number.isFinite));
const scans = [];
for (let index = 0; index < parts.length; index += 1) {
  const part = parts[index];
  if (part.scan) {
    scans.push(part.scan);
    continue;
  }
  const previousEnd = index === 0 ? -1 : scans[index - 1].startIndex + scans[index - 1].processedFiles - 1;
  const nextKnown = parts.slice(index + 1).find(candidate => candidate.scan)?.scan;
  if (!nextKnown) throw new Error(`分段 ${inputPaths[index]} 缺少 scan 元数据，且无法从后一段推导范围`);
  const startIndex = previousEnd + 1;
  const processedFiles = nextKnown.startIndex - startIndex;
  scans.push({
    scope: nextKnown.scope,
    startIndex,
    scopeFileCount: nextKnown.scopeFileCount,
    selectedFileCount: processedFiles,
    processedFiles
  });
}
const ranges = scans.map(scan => [scan.startIndex, scan.startIndex + scan.processedFiles - 1]);

const output = {
  generatedAt: new Date().toISOString(),
  records,
  ambiguous,
  errors,
  scan: {
    scope: 'All',
    ranges,
    scopeFileCount: scopeFileCounts.size === 1 ? [...scopeFileCounts][0] : null,
    selectedFileCount: scans.reduce((sum, scan) => sum + scan.selectedFileCount, 0),
    processedFiles: scans.reduce((sum, scan) => sum + scan.processedFiles, 0)
  }
};

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
console.log(JSON.stringify({
  outputPath,
  records: records.length,
  ambiguous: ambiguous.length,
  errors: errors.length,
  scan: output.scan
}, null, 2));
