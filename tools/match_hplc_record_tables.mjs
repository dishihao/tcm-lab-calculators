export const normalizedAnalyte = value => String(value ?? '').normalize('NFKC')
  .replace(/\s+/gu, '').replace(/^[.、:：]+/u, '').toLowerCase();

// Only short analyte headings can select among multiple source pairs. Mentions
// in reagent/preparation/standard prose are evidence, not a table identity.
export function nearestAnalyteHeading(context, names) {
  const normalized = names.map(name => [name, normalizedAnalyte(name)]);
  for (const line of [...context].reverse()) {
    const text = normalizedAnalyte(line).replace(/[：:。;；]$/u, '');
    if (!text || text.length > 100) continue;
    const matches = normalized.filter(([, name]) => text === name
      || text === `${name}含量测定` || text === `含量测定${name}`
      || new RegExp(`^[（(]?\\d+[）).、]\\s*${name.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&')}$`, 'u').test(text));
    if (matches.length) return matches.map(([name]) => name);
    // A different short colon-terminated analyte heading blocks any older
    // heading. Do not attach 甘氨酸 to earlier L-羟脯氨酸 when catalog names are wrong.
    if (/[:：]$/u.test(line.trim()) && text.length < 40
        && !/测量|计算|结果|试验|试药|试剂|制备|测定法|仪器|供试品|对照品|系统适用/.test(text)) return [];
  }
  return [];
}

export function matchHplcTables(template, siblings, candidates) {
  const standard=normalizedAnalyte(template.standardText||'');
  const matchingStandard=candidates.filter(table=>standard&&normalizedAnalyte(table.followingStandard||'').includes(standard));
  if(matchingStandard.length)candidates=matchingStandard;
  const correctedName=sourceNameForLimit(template,candidates);
  const selectedName=correctedName||template.name;
  const duplicate=siblings.filter(item=>normalizedAnalyte(item.name)===normalizedAnalyte(template.name)).length>1;
  if(duplicate&&!correctedName&&!matchingStandard.length)return {status:'duplicate-catalog-analyte',tables:[],evidence:'catalog-name-requires-source-review'};
  const names = [...new Set(siblings.map(sibling => sibling.name))];
  if(correctedName)names.push(correctedName);
  const classified = candidates.map(table => ({table,names:nearestAnalyteHeading(table.context,names)}));
  const matched = classified.filter(entry => entry.names.some(name => normalizedAnalyte(name) === normalizedAnalyte(selectedName))).map(entry=>entry.table);
  const tables = matched.length ? matched : candidates.length === 2 && (names.length === 1 || matchingStandard.length === 2) ? candidates : [];
  const reference=tables.filter(table=>table.classification.role === 'reference');
  const sample=tables.filter(table=>table.classification.role === 'sample');
  if (reference.length === 1 && sample.length === 1 && reference[0].index < sample[0].index) {
    return {status:'candidate-pair-needs-review',tables:[reference[0],sample[0]],resolvedName:correctedName||null,evidence:matched.length ? 'nearest-analyte-heading' : 'single-analyte-single-pair'};
  }
  return {status:candidates.length ? 'ambiguous-analyte-tables' : 'no-candidate-table',tables:matched,evidence:'requires-source-review'};
}

export function sourceNameForLimit(template,tables){
  if(!template.limit||template.totalLabel)return null;
  const candidates=[];
  for(const clause of String(template.standardText||'').split(/[，,；;。]/u)){
    const match=clause.match(/(不得少于|不少于|应不低于|不得过|不得超过|不应超过)\s*([\d.]+)/u);
    if(!match||Number(match[2])!==Number(template.limit))continue;
    let name=clause.slice(0,match.index).replace(/[（(][^）)]*[）)]/gu,'').replace(/^含/u,'').trim();
    if(!name||name.length>40||/总量|本品|内控|计算|标准/.test(name))continue;
    if(tables.some(table=>nearestAnalyteHeading(table.context,[name]).length))candidates.push(name);
  }
  return new Set(candidates).size===1?candidates[0]:null;
}
