(function(window){
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function layout(template){
    const entry=window.QUANTITATIVE_RECORD_LAYOUTS?.templates[template?.id];
    if(entry?.status!=='mapped')return null;
    const tables=entry.tableKeys.map(key=>({...window.QUANTITATIVE_RECORD_LAYOUTS.tables[key],templateId:template.id}));
    return {tables,bindings:tables.flatMap(table=>table.bindings)};
  }
  const fixedValue=(templateId,field)=>typeof QualityFixedDefaults!=='undefined'?QualityFixedDefaults.value(templateId,field):null;
  const UNIT_BY_PROJECT=Object.freeze({
    impurity:Object.freeze({M:'g',M1:'g',X:'%',RD:'%',MEAN:'%'}),
    moisture:Object.freeze({W0a:'g',W0b:'g',Ws:'g',W1a:'g',W1b:'g',Vwater:'ml',X:'%',RD:'%',MEAN:'%'}),
    ash:Object.freeze({W0a:'g',W0b:'g',Ws:'g',W1a:'g',W1b:'g',X:'%',RD:'%',MEAN:'%'}),
    extract:Object.freeze({Q:'%',W0a:'g',W0b:'g',Ws:'g',V:'ml',Vs:'ml',W1:'g',X:'%',RD:'%',MEAN:'%'}),
    sulfur:Object.freeze({C:'mol/L',Vblank:'ml',VblankCorr:'ml',VblankPrime:'ml',Vsample:'ml',VsampleCorr:'ml',Vprime:'ml',Ws:'g',X:'mg/kg',RD:'%',MEAN:'mg/kg'})
  });
  const compact=value=>String(value||'').replace(/\s+/gu,'').replace(/／/gu,'/');
  function fieldUnit(field){
    const parts=String(field||'').split('.');
    const project=parts[0], key=parts[1]==='out'?parts[2]:parts[1];
    return UNIT_BY_PROJECT[project]?.[key]||'';
  }
  function sourceLabel(table,binding){
    const cell=table.cells.find(item=>item.id===binding.cellId);
    if(!cell)return '';
    return table.cells
      .filter(item=>!item.isGridGap&&item.row===cell.row&&item.column<cell.column&&compact(item.text)&&compact(item.text)!=='/')
      .sort((left,right)=>left.column-right.column)
      [0]?.text||'';
  }
  function unitForBinding(table,binding){
    const unit=fieldUnit(binding.field);
    if(!unit)return '';
    const label=compact(sourceLabel(table,binding));
    return label.includes(compact(unit))?'':unit;
  }
  function withInputUnit(html,unit){
    if(!unit)return html;
    const percentClass=unit==='%'?' word-cell-percent-value':'';
    return `<span class="word-cell-number-with-unit${percentClass}">${html}<span class="word-cell-unit">${escape(unit)}</span></span>`;
  }
  /** 「至恒重」不是小时数，把它后面的「小时」单位去掉，避免读成「至恒重小时」 */
  function withoutTrailingHour(cell){
    const paragraphs=(cell.paragraphs||[]).map(paragraph=>{
      const runs=paragraph.runs||[];
      const edits=[];
      for(let index=1;index<runs.length;index+=1){
        const previous=runs[index-1],run=runs[index];
        if(previous.kind!=='input')continue;
        if(fixedValue(cell.templateId,previous.field)!=='至恒重')continue;
        if(!run||run.kind!=='text'||!String(run.text||'').startsWith('小时'))continue;
        edits.push(index);
      }
      if(!edits.length)return paragraph;
      const next=[...runs];
      for(const index of edits.reverse()){
        const text=String(next[index].text).replace(/^小时/,'');
        if(text)next[index]={...next[index],text};else next.splice(index,1);
      }
      return {...paragraph,runs:next};
    });
    const changed=paragraphs.some((paragraph,index)=>paragraph!==cell.paragraphs[index]);
    return changed?{...cell,paragraphs}:cell;
  }
  function withFixedUnits(table){
    let changed=false;
    const cells=table.cells.map(cell=>{
      if(!(cell.paragraphs||[]).some(paragraph=>(paragraph.runs||[]).some(run=>run.kind==='input'&&fixedValue(table.templateId,run.field)==='至恒重')))return cell;
      const next=withoutTrailingHour({...cell,templateId:table.templateId});
      if(next!==cell)changed=true;
      return next;
    });
    return changed?{...table,cells}:table;
  }
  function render(template,get){
    const record=layout(template);
    if(!record)return '<div class="note record-table-review">该记录的表格或字段需要核对，暂不套用计算表。</div>';
    const input=binding=>withInputUnit(
      `<input class="cell word-cell-input" type="text" autocomplete="off" inputmode="decimal" data-k="${escape(binding.field)}" value="${escape(get(binding.field))}" aria-label="${escape(binding.sourceLabel||binding.field)}">`,
      unitForBinding(record.tables.find(table=>table.bindings.includes(binding))||record.tables[0],binding)
    );
    const output=binding=>{
      const table=record.tables.find(item=>item.bindings.includes(binding))||record.tables[0];
      const unit=unitForBinding(table,binding);
      return `<div class="out empty word-cell-output"${unit?` data-unit="${escape(unit)}"`:''} id="${escape(binding.field)}"></div>`;
    };
    // 标准或原记录已经确定的测定条件（干燥／炽灼温度、时间）按固定文字显示，不需要检验人员修改或填写。
    const inlineInput=run=>{
      const fixed=fixedValue(template.id,run.field);
      if(fixed!=null)return `<span class="word-fixed-text word-standard-value" data-fixed-field="${escape(run.field)}" style="min-width:${run.widthPt||30}pt" aria-label="${escape(run.label||run.field)}">${escape(fixed)}</span>`;
      return `<input type="text" class="inline" autocomplete="off" data-k="${escape(run.field)}" value="${escape(get(run.field))}" style="width:${run.widthPt||30}pt" aria-label="${escape(run.label||run.field)}">`;
    };
    return record.tables.map(table=>`<div class="tscroll word-table-scroll" data-quantitative-record-table>${window.GcWordTableRenderer.render(withFixedUnits(table),{input,output,inlineInput})}</div>`).join('');
  }
  window.QuantitativeRecordTables=Object.freeze({layout,render});
})(window);
