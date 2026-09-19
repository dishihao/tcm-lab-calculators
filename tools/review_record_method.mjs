const compact=value=>String(value||'').normalize('NFKC').replace(/\s/gu,'').toLowerCase();
export function nonHplcMethod(template,source){
  const target=compact(template.standardText);
  if(!target||target.includes('未自动识别'))return null;
  const lines=source.paragraphs||[];
  const hits=lines.map((line,index)=>compact(line).includes(target)?index:-1).filter(index=>index>=0);
  if(!hits.length)return null;
  const methods=hits.map(hit=>{
  let start=hit-1;
  while(start>=0 && !(lines[start].includes('标准规定')&&!/RSD|理论板数|重复性/u.test(lines[start]))
    && !/^.{0,30}(?:铬|铅|镉|砷|汞|铜)[（(](?:Cr|Pb|Cd|As|Hg|Cu)[）)].*(?:含量|测定)/u.test(lines[start]))start--;
  const section=lines.slice(start+1,hit+1).join('\n');
  if(/(?:照|按)高效液相色谱法|注入液相色谱仪/u.test(section))return null;
  if(/原子吸收|电感耦合等离[子了]/u.test(section))return '元素检验（原子吸收/等离子体方法）';
  if(/气相色谱/u.test(section))return '气相色谱检验';
  if(/紫外.{0,4}分光光度法|紫外-可见分光光度法/u.test(section))return '紫外分光光度检验';
  const other=section.match(/(?:照|按)(杂质|水分|总灰分|酸不溶性灰分|二氧化硫残留量|[醇水]溶性浸出物)(?:测定法|[（(]通则)/u)?.[1];
  if(other)return `${other}检查`;
  return null;
  });
  if(methods.some(method=>!method))return null;
  return [...new Set(methods)].join(' / ');
}
export function hasTrailingMethodWithoutTable(source,name){
  const methods=(source.paragraphs||[]).map((line,index)=>line.includes(name)&&/照高效液相色谱法/u.test(line)?index:-1).filter(index=>index>=0);
  if(methods.length!==1||!source.tables?.length)return false;
  const context=source.tables.at(-1).context||[],matches=[];
  if(!context.length)return false;
  for(let i=0;i<=source.paragraphs.length-context.length;i++)if(context.every((line,j)=>line===source.paragraphs[i+j]))matches.push(i+context.length-1);
  return matches.length===1&&methods[0]>matches[0];
}
