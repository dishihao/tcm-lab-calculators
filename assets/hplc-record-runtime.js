(function(window){
  'use strict';
  function layout(template){
    if(!template||template.tech!=='hplc')return null;
    const catalog=window.HPLC_RECORD_LAYOUTS;
    const entry=catalog?.templates[template.id];
    if(entry?.status!=='mapped')return null;
    const tables=entry.tableKeys.map(key=>({...catalog.tables[key],templateId:template.id}));
    const referenceTable=tables.find(table=>table.tableRole==='reference');
    const sampleTable=tables.find(table=>table.tableRole==='sample');
    if(!referenceTable||!sampleTable)throw new Error('液相原记录表格不完整');
    return {templateId:template.id,referenceTable,sampleTable,bindings:tables.flatMap(table=>table.bindings),referenceConcentrationField:referenceTable.referenceConcentrationField||'assay.Cref',referenceConcentrationScale:referenceTable.referenceConcentrationScale||1,quantification:sampleTable.quantification};
  }
  function render(template,role,adapters){
    const value=layout(template);
    if(!value)return '<div class="note hplc-record-review">该记录的成分或表格对应关系需要核对，暂不套用计算表。</div>';
    return window.GcWordTableRenderer.render(role==='reference'?value.referenceTable:value.sampleTable,adapters);
  }
  window.HplcRecordTables=Object.freeze({layout,render});
})(window);
