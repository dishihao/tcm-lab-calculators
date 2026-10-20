/* Standard-reference preview: fixed record width and answers on source underlines. */
(function () {
  'use strict';
  const escape = value => String(value).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
  const scales = { compact:0.75, standard:0.8125, comfortable:1, large:1.125 };
  const labels = { compact:'A−', standard:'标准', comfortable:'A+', large:'大字' };

  function renderRun(run) {
    if (!run.blank) return escape(run.text);
    const value = run.answer || '';
    // Source spacing sets the field width. Answers overlay that space and cannot
    // push the following text or change wrapping when their length changes.
    const spacer = String(run.text).replace(/[_＿\t\u00a0\u3000]/g, char =>
      char === '\t' ? '    ' : char === '\u3000' ? '  ' : char === '_' || char === '＿' ? '\u2002' : ' ');
    return `<span class="standard-blank${value ? ' answered' : ''}" title="${value
      ? '质量标准答案：' + escape(value) : '未自动填入；批次填写项或答案待核对'}">`
      + `<span class="standard-blank-space" aria-hidden="true">${spacer}</span>`
      + (value ? `<span class="standard-answer">${escape(value)}</span>` : '') + '</span>';
  }

  function render(template, requestedScale) {
    const layout = PHYSICOCHEMICAL_ANSWER_LAYOUTS.templates[template.id];
    if (!layout) return '<div class="identification-empty">该记录的下划线布局待核对，暂不填入答案。</div>';
    const scale = Object.hasOwn(scales, requestedScale) ? requestedScale : 'standard';
    const contentWidth = layout.widthPx || 664;
    const totalWidth = contentWidth + 56;
    const code = (template.sourceFile.match(/^[Dd]?\d+/) || ['—'])[0];
    return `<div class="standard-preview">
      <div class="standard-preview-status">
        <b>${escape(template.label)}</b><span>物料编码：${escape(code)}</span>
        <span>红字＝质量标准答案 · 已核实 ${layout.filled} 处</span>
      </div>
      <div class="standard-preview-tools no-print">
        <span>屏幕阅读字号</span>${Object.entries(labels).map(([key, label]) =>
          `<button type="button" data-standard-scale="${key}" aria-pressed="${key === scale}">${label}</button>`).join('')}
        <span class="standard-preview-legend">宋体 12 号 · A4 记录宽度 · 未确认处留空</span>
      </div>
      ${!layout.layoutVerified ? '<div class="standard-review-note">部分原记录下划线格式待核对；这些位置不自动填入答案。</div>' : ''}
      <div class="standard-paper-scroll" tabindex="0" aria-label="理化质量标准记录预览，可横向滚动">
        <div class="standard-paper-size" data-preview-scale="${scales[scale]}" data-paper-width="${totalWidth}" style="width:${totalWidth * scales[scale]}px">
        <article class="standard-paper" style="width:${contentWidth}px; transform:scale(${scales[scale]})">
          ${layout.blocks.map(block => `<section class="identification-block">
            ${block.title ? `<h3>${escape(block.title)}</h3>` : ''}
            <div class="identification-lines">${block.lines.map(line => {
              const original = line.runs.map(run => run.text).join('');
              return `<p data-source-text="${escape(original)}">${line.runs.map(renderRun).join('')}</p>`;
            }).join('')}</div></section>`).join('')}
        </article>
        </div>
      </div>
      <div class="standard-preview-source">${layout.standardFile
        ? `答案来源：${escape(layout.standardFile)}` : '对应质量标准尚未确认，答案保持空白。'}
        <span>仪器编号、实际称量与批次结果保持空白。</span>
      </div>
      <details class="standard-short-answers no-print" hidden>
        <summary></summary><ul></ul>
      </details>
    </div>`;
  }

  function fitAnswers(root = document) {
    root.querySelectorAll('.standard-paper-size').forEach(size => {
      const paper = size.querySelector('.standard-paper');
      size.style.height = `${paper.offsetHeight * Number(size.dataset.previewScale)}px`;
    });
    const short = [];
    root.querySelectorAll('.standard-answer').forEach((answer, index) => {
      answer.hidden = false;
      answer.parentElement.classList.add('answered');
      answer.style.transform = 'translateX(-50%)';
      const available = answer.parentElement.getBoundingClientRect().width;
      const natural = answer.getBoundingClientRect().width;
      if (available > 0 && natural > available) {
        const scale = (available - 1) / natural;
        if (scale < 0.55){
          answer.hidden = true;
          answer.parentElement.classList.remove('answered');
          answer.parentElement.title = `原横线过短，完整标准答案请查看核对说明：${answer.textContent}`;
          short.push({index:index + 1, answer:answer.textContent});
        } else {
          answer.style.transform = `translateX(-50%) scaleX(${scale})`;
        }
      }
    });
    const note = root.querySelector('.standard-short-answers');
    if (note){
      note.hidden = short.length === 0;
      note.querySelector('summary').textContent = `${short.length} 处原横线过短，保留空白；展开查看完整的已核实答案`;
      note.querySelector('ul').innerHTML = short.map(item => `<li>第 ${item.index} 个已核实答案：<b>${escape(item.answer)}</b></li>`).join('');
    }
  }

  function setScale(key) {
    if (!Object.hasOwn(scales, key)) return;
    const paper = document.querySelector('.standard-paper');
    if (paper){
      paper.style.transform = `scale(${scales[key]})`;
      paper.parentElement.dataset.previewScale = scales[key];
      paper.parentElement.style.width = `${Number(paper.parentElement.dataset.paperWidth) * scales[key]}px`;
    }
    document.querySelectorAll('[data-standard-scale]').forEach(button =>
      button.setAttribute('aria-pressed', String(button.dataset.standardScale === key)));
    fitAnswers();
  }
  window.addEventListener('beforeprint', () => fitAnswers());
  window.addEventListener('afterprint', () => fitAnswers());
  window.PhysicochemicalStandards = { render, fitAnswers, setScale };
})();
