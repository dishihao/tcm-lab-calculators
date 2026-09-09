(function(window){
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function layout(template){
    const entry=window.QUANTITATIVE_RECORD_LAYOUTS?.templates[template?.id];
    if(entry?.status!=='mapped')return null;
    const tables=entry.tableKeys.map(key=>({...window.QUANTITATIVE_RECORD_LAYOUTS.tables[key],templateId:template.id}));
    return {tables,bindings:tables.flatMap(table=>table.bindings)};
  }
  function render(template,get){
    const record=layout(template);
    if(!record)return '<div class="note record-table-review">该记录的表格或字段需要核对，暂不套用计算表。</div>';
    const input=binding=>`<input class="cell word-cell-input" type="text" autocomplete="off" inputmode="decimal" data-k="${escape(binding.field)}" value="${escape(get(binding.field))}" aria-label="${escape(binding.sourceLabel||binding.field)}">`;
    const output=binding=>`<div class="out empty word-cell-output" id="${escape(binding.field)}"></div>`;
    const inlineInput=run=>`<input type="text" class="inline" autocomplete="off" data-k="${escape(run.field)}" value="${escape(get(run.field))}" style="width:${run.widthPt||30}pt" aria-label="${escape(run.label||run.field)}">`;
    return record.tables.map(table=>`<div class="tscroll word-table-scroll" data-quantitative-record-table>${window.GcWordTableRenderer.render(table,{input,output,inlineInput})}</div>`).join('');
  }
  window.QuantitativeRecordTables=Object.freeze({layout,render});
})(window);
