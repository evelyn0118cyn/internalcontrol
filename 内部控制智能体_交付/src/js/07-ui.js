/* =============================================================================
 * 07-ui.js — 界面与交互
 *   ① 顶栏 / 红色预警横幅 / 三栏布局 / 步骤导航
 *   ② 材料导入（上传 Excel / 粘贴文本 / 填表单）+ 字段校验 + 参数设置 + 内部制度补充
 *   ③ 逐点评估（进度条、分批推进、可复现）
 *   ④ 四个成果页签：控制点评估表 / 缺陷清单 / 评分明细 / 评价结论（含预警卡）
 *   ⑤ 结论速览卡、待补清单、筛选排序、图表（ECharts）
 *   ⑥ 大模型 API 设置、语义增强、降级提示
 *   ⑦ 内嵌测试示例（12 个控制点，预期 vs 实际并排比对）
 *   ⑧ 导出（CSV / Excel / PDF / 一键下载全部成果）、操作日志、历史评估记录
 * ========================================================================== */
(function (global) {
  'use strict';
  var IC = global.IC;
  var U = IC.U;
  var LLM = IC.LLM;
  var EX = IC.EXPORT;
  var doc = global.document;

  var UI = IC.UI = {};

  /* ==========================================================================
   * 状态
   * ====================================================================== */
  var S = UI.state = {
    materials: { controls: [], selfassessment: [], defects: [] },
    validation: { controls: null, selfassessment: null, defects: null },
    parsedInfo: { controls: null, selfassessment: null, defects: null },
    params: U.clone(IC.DEFAULT_PARAMS),
    userPolicies: [],
    result: null,           // 规则引擎结果
    llmResult: null,        // 大模型增强后的结果（副本）
    llmStatus: { used: false, ok: false, degraded: false, message: '', at: '' },
    running: false,
    activeView: 'import',
    filters: {
      eval: { conclusion: '', level: '', flow: '', dept: '', kw: '', sort: '', dir: '' },
      defect: { level: '', nature: '', kw: '', sort: '', dir: '' },
      score: { sort: '', dir: '' }
    },
    charts: { pie: null, matrix: null },
    testState: { loaded: false, ran: false, preMat: null, preResult: null, preParams: null }
  };

  /* ==========================================================================
   * 小工具
   * ====================================================================== */
  function $(sel, scopeEl) { return (scopeEl || doc).querySelector(sel); }
  function $$(sel, scopeEl) { return Array.prototype.slice.call((scopeEl || doc).querySelectorAll(sel)); }
  function on(el, evt, fn) { if (el) el.addEventListener(evt, fn); }
  function esc(s) { return U.esc(s); }

  function toast(msg, type, ms) {
    var wrap = $('#toasts');
    if (!wrap) return;
    var d = doc.createElement('div');
    d.className = 'toast ' + (type || '');
    d.textContent = msg;
    wrap.appendChild(d);
    global.setTimeout(function () { d.classList.add('on'); }, 10);
    global.setTimeout(function () {
      d.classList.remove('on');
      global.setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 260);
    }, ms || 2600);
  }
  UI.toast = toast;

  function openModal(id) {
    var m = $('#' + id);
    if (m) m.hidden = false;
  }
  function closeModal(id) {
    var m = $('#' + id);
    if (m) m.hidden = true;
  }
  UI.openModal = openModal;
  UI.closeModal = closeModal;

  function vbadge(v) {
    var map = { '有效': 'vb-ok', '无效': 'vb-bad', '证据不足': 'vb-ins', '重大': 'vb-major', '重要': 'vb-important', '一般': 'vb-general', '无': 'vb-none' };
    return '<span class="vb ' + (map[v] || 'vb-soft') + '">' + esc(v) + '</span>';
  }

  function riskCls(r) {
    return r === '高' ? 'risk-h' : (r === '中' ? 'risk-m' : 'risk-l');
  }

  /* ==========================================================================
   * 初始化
   * ====================================================================== */
  UI.init = function () {
    bindTopbar();
    bindStepNav();
    bindImport();
    bindParams();
    bindInternalPolicy();
    bindRun();
    bindEvalView();
    bindDefectView();
    bindScoreView();
    bindConclusionView();
    bindExport();
    bindApi();
    bindGeneralModal();
    bindTestModule();

    loadParams();
    loadInternalPolicy();
    loadMaterialsFromStorage();
    renderLedger();
    renderParamsWarnings();
    updateStepNav();
    updateApiBadge();
    renderTestExpected();

    // 启动提示：教学测试密钥
    var notice = IC.LS.get(IC.C.LS.notice, {});
    if (!notice.never && !notice.shown) {
      global.setTimeout(function () {
        openModal('modalKeyNotice');
        notice.shown = true;
        IC.LS.set(IC.C.LS.notice, notice);
      }, 400);
    }

    // 记录启动日志
    LLM.log({
      type: 'ui',
      action: '打开应用',
      input: '版本 ' + IC.version + ' · 协议 ' + IC.env.protocol,
      output: '界面就绪（XLSX ' + (IC.env.hasXLSX() ? '可用' : '不可用') + ' / ECharts ' + (IC.env.hasECharts() ? '可用' : '不可用') + '）',
      expected: true
    });

    // 若有上次评估结果，恢复展示（历史结果记忆）
    var last = IC.LS.get(IC.C.LS.history, []);
    if (Array.isArray(last) && last.length && last[0] && last[0].snapshot) {
      // 仅恢复「结果摘要」，不自动跳转，避免用户误以为刚跑过
      S._lastHistory = last[0];
    }
  };

  /* ==========================================================================
   * 顶栏 / 弹层 / 步骤导航
   * ====================================================================== */
  function bindTopbar() {
    on($('#btnApiSettings'), 'click', function () { fillApiForm(); openModal('modalApi'); });
    on($('#btnEmbeddedTest'), 'click', function () { showView('test'); });
    on($('#btnHelp'), 'click', showHelp);
    on($('#btnGotoAlert'), 'click', function () {
      showView('conclusion');
      global.setTimeout(function () {
        var el = $('#alertCards');
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 120);
    });
  }

  function bindStepNav() {
    $$('#stepnav .step-item').forEach(function (btn) {
      on(btn, 'click', function () {
        var step = btn.getAttribute('data-step');
        if (step === '1') showView('import');
        else if (step === '2') {
          if (!S.result) { showView('import'); toast('请先导入材料并点击「开始逐点评估」', 'warn'); return; }
          showView('eval');
        } else {
          if (!S.result) { showView('import'); toast('请先完成逐点评估', 'warn'); return; }
          showView('conclusion');
        }
      });
    });
    $$('#wsnav .ws-item').forEach(function (btn) {
      on(btn, 'click', function () {
        var v = btn.getAttribute('data-view');
        if ((v === 'eval' || v === 'defect' || v === 'score' || v === 'conclusion') && !S.result) {
          showView('import');
          toast('请先导入材料并点击「开始逐点评估」', 'warn');
          return;
        }
        showView(v);
      });
    });
  }

  var VIEW_ORDER = ['import', 'eval', 'defect', 'score', 'conclusion', 'test'];

  function showView(name) {
    if (VIEW_ORDER.indexOf(name) < 0) name = 'import';
    S.activeView = name;
    $$('.view').forEach(function (v) {
      v.classList.toggle('on', v.getAttribute('data-view-panel') === name);
    });
    $$('#wsnav .ws-item').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-view') === name || (name === 'test' && b.getAttribute('data-view') === 'import'));
    });
    // 图表在切换可见后重绘（ECharts 需要容器有尺寸）
    if (name === 'defect') global.setTimeout(renderCharts, 60);
    if (name === 'score') renderScoreView();
    if (name === 'eval') renderEvalView();
    if (name === 'conclusion') renderConclusionView();
    updateStepNav();
    if (global.scrollTo) global.scrollTo({ top: 0, behavior: 'smooth' });
  }
  UI.showView = showView;

  function updateStepNav() {
    var hasMaterials = S.materials.controls.length > 0 || S.materials.selfassessment.length > 0 || S.materials.defects.length > 0;
    var hasResult = !!S.result;
    var st = {
      1: hasMaterials ? 'done' : 'on',
      2: hasResult ? 'done' : (hasMaterials ? 'on' : ''),
      3: hasResult ? 'on' : ''
    };
    $$('#stepnav .step-item').forEach(function (btn) {
      var step = btn.getAttribute('data-step');
      var state = st[step];
      btn.removeAttribute('data-act');
      if (state) btn.setAttribute('data-act', state === 'on' ? 'on' : 'done');
      var sEl = $('.step-s', btn);
      if (sEl) {
        sEl.textContent = state === 'done' ? '已完成' : (state === 'on' ? (step === '2' ? '待执行' : '进行中') : '未开始');
      }
    });
  }

  /* ==========================================================================
   * 材料导入
   * ====================================================================== */
  var MAT_KEYS = ['controls', 'selfassessment', 'defects'];
  var MAT_LABEL = { controls: '控制点清单', selfassessment: '内控自评表', defects: '缺陷记录表' };

  function bindImport() {
    MAT_KEYS.forEach(function (k) {
      var input = $('#file-' + k);
      on(input, 'change', function () {
        var f = input.files && input.files[0];
        if (f) handleFile(k, f);
        input.value = '';
      });
      var dz = $('.dropzone[data-drop="' + k + '"]');
      if (dz) {
        ['dragenter', 'dragover'].forEach(function (e) {
          on(dz, e, function (ev) { ev.preventDefault(); dz.classList.add('hover'); });
        });
        ['dragleave', 'drop'].forEach(function (e) {
          on(dz, e, function (ev) { ev.preventDefault(); dz.classList.remove('hover'); });
        });
        on(dz, 'drop', function (ev) {
          var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
          if (f) handleFile(k, f);
        });
      }
    });

    $$('[data-paste-target]').forEach(function (btn) {
      on(btn, 'click', function () {
        var k = btn.getAttribute('data-paste-target');
        $$('.seg-i[data-paste-target="' + k + '"], .seg-i[data-form-target="' + k + '"]').forEach(function (b) {
          b.classList.toggle('on', b === btn);
        });
        var pane = $('.pane[data-pane="' + k + '"]');
        var formPane = $('.pane[data-pane="' + k + '-form"]');
        if (pane) pane.hidden = false;
        if (formPane) formPane.hidden = true;
      });
    });
    $$('[data-form-target]').forEach(function (btn) {
      on(btn, 'click', function () {
        var k = btn.getAttribute('data-form-target');
        $$('.seg-i[data-paste-target="' + k + '"], .seg-i[data-form-target="' + k + '"]').forEach(function (b) {
          b.classList.toggle('on', b === btn);
        });
        var pane = $('.pane[data-pane="' + k + '"]');
        var formPane = $('.pane[data-pane="' + k + '-form"]');
        if (pane) pane.hidden = true;
        if (formPane) formPane.hidden = false;
        renderForm(k);
      });
    });

    $$('[data-act="parse-paste"]').forEach(function (btn) {
      on(btn, 'click', function () { parsePaste(btn.getAttribute('data-mat')); });
    });
    $$('[data-act="sample-paste"]').forEach(function (btn) {
      on(btn, 'click', function () {
        var k = btn.getAttribute('data-mat');
        var ta = $('#ta-' + k);
        if (ta) ta.value = IC.buildSamplePaste(k);
      });
    });
    $$('[data-act="form-add"]').forEach(function (btn) {
      on(btn, 'click', function () { formAdd(btn.getAttribute('data-mat')); });
    });
    $$('[data-act="form-save"]').forEach(function (btn) {
      on(btn, 'click', function () { formSave(btn.getAttribute('data-mat')); });
    });
    $$('[data-act="preview"]').forEach(function (btn) {
      on(btn, 'click', function () { previewMaterial(btn.getAttribute('data-mat')); });
    });

    on($('#btnLoadDemo'), 'click', loadDemo);
    on($('#btnClearAll'), 'click', clearAll);
    on($('#btnDownloadTpl'), 'click', function () {
      if (!EX.buildImportTemplate()) toast('模板需要 Excel 组件支持，请改用「填入格式示例」复制表头', 'bad');
    });
    on($('#btnHistory'), 'click', showHistory);
    on($('#btnLog'), 'click', showLogs);
  }

  /** 材料上下文（用于跨表校验） */
  function matCtx() {
    var ids = {};
    S.materials.controls.forEach(function (c) { ids[c.id] = c; });
    return { cpIds: ids, allCpIds: S.materials.controls.map(function (c) { return c.id; }) };
  }

  function handleFile(k, file) {
    var nameExt = (file.name.split('.').pop() || '').toLowerCase();
    if (['xlsx', 'xls', 'csv', 'txt'].indexOf(nameExt) < 0) {
      toast('文件格式不支持，请改用 CSV 或粘贴文本', 'bad');
      LLM.log({ type: 'import', action: '导入' + MAT_LABEL[k], input: file.name, output: '格式不支持', expected: false });
      return;
    }
    toast('正在解析 ' + file.name + '…');
    IC.parseXlsxFile(file, function (err, rows, info) {
      if (err) {
        toast(err, 'bad', 4200);
        setIssues(k, { level: 'bad', issues: [{ type: 'error', msg: err }] });
        LLM.log({ type: 'import', action: '导入' + MAT_LABEL[k], input: file.name, output: err, expected: false });
        return;
      }
      var ctx = matCtx();
      // 若导入的是控制点清单，则本批记录本身就是上下文的来源
      if (k === 'controls') ctx = { cpIds: {}, allCpIds: [] };
      var ing = IC.ingestRows(k, rows, ctx);
      applyMaterials(k, ing.records, ing.validation, { fileName: file.name, sheet: info && info.sheet, via: info && info.via });
      LLM.log({
        type: 'import',
        action: '导入' + MAT_LABEL[k],
        input: file.name + '（' + (rows ? rows.length : 0) + ' 行）',
        output: '解析 ' + ing.records.length + ' 条，校验 ' + ing.validation.level,
        expected: ing.validation.level !== 'bad'
      });
      if (ing.validation.level === 'bad') toast(MAT_LABEL[k] + '有字段缺失，请核对下方提示', 'warn', 3600);
      else toast(MAT_LABEL[k] + '导入成功：' + ing.records.length + ' 条', 'ok');
    });
  }

  function parsePaste(k) {
    var ta = $('#ta-' + k);
    var text = ta ? ta.value : '';
    if (!U.clean(text)) { toast('请先粘贴表格文本', 'warn'); return; }
    var ctx = k === 'controls' ? { cpIds: {}, allCpIds: [] } : matCtx();
    var ing = IC.ingestText(k, text, ctx);
    applyMaterials(k, ing.records, ing.validation, { via: 'paste' });
    LLM.log({
      type: 'import',
      action: '粘贴导入' + MAT_LABEL[k],
      input: U.clean(text).slice(0, 120),
      output: '解析 ' + ing.records.length + ' 条，校验 ' + ing.validation.level,
      expected: ing.validation.level !== 'bad'
    });
    if (ing.records.length) toast(MAT_LABEL[k] + '解析完成：' + ing.records.length + ' 条', ing.validation.level === 'bad' ? 'warn' : 'ok');
    else toast('未能解析出数据行，请检查表头与分隔符', 'bad', 3600);
  }

  function applyMaterials(k, records, validation, info) {
    S.materials[k] = records || [];
    S.validation[k] = validation || null;
    S.parsedInfo[k] = info || null;
    renderMaterialCard(k);
    renderIssues(k);
    renderLedger();
    updateStepNav();
    persistMaterials();
    // 冷启动提示：若这次导入使材料齐备，给出下一步引导
    // （不自动运行，避免替用户做决定）
  }

  function renderMaterialCard(k) {
    var card = $('.import-card[data-mat="' + k + '"]');
    if (!card) return;
    var n = S.materials[k].length;
    var v = S.validation[k];
    var tag = $('#tag-' + k);
    var cnt = $('#count-' + k);
    if (cnt) cnt.textContent = n + ' 条';
    card.classList.toggle('has-data', n > 0);
    card.classList.toggle('bad', !!(v && v.level === 'bad'));
    if (tag) {
      tag.className = 'tag' + (n === 0 ? '' : (v && v.level === 'bad' ? ' bad' : (v && v.level === 'warn' ? ' warn' : ' ok')));
      tag.textContent = n === 0 ? '未导入' : (v && v.level === 'bad' ? '字段缺失' : (v && v.level === 'warn' ? '已导入（有提示）' : '已导入'));
    }
    // 表单视图同步数据
    if ($('.pane[data-pane="' + k + '-form"]') && !$('.pane[data-pane="' + k + '-form"]').hidden) renderForm(k);
  }

  function setIssues(k, v) {
    S.validation[k] = v;
    renderIssues(k);
  }

  function renderIssues(k) {
    var box = $('#issues-' + k);
    if (!box) return;
    var v = S.validation[k];
    if (!v || !v.issues || !v.issues.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    var issueHtml = v.issues.map(function (i) {
      return '<div class="issue-i' + (i.type === 'warn' ? ' warn' : '') + '"><b>' + (i.type === 'warn' ? '提示' : '错误') + '</b><span>' + esc(i.msg) + '</span></div>';
    }).join('');
    box.innerHTML = issueHtml;
  }

  function renderLedger() {
    var c = S.materials.controls.length;
    var s = S.materials.selfassessment.length;
    var d = S.materials.defects.length;
    $('#ledgerCp').textContent = c ? c + ' 条' : '—';
    $('#ledgerSa').textContent = s ? s + ' 条' : '—';
    $('#ledgerDf').textContent = d ? d + ' 条' : '—';
    var cov = S.result ? S.result.stats.coverage + '%' : (c ? (U.round(c * 100 / IC.C.STANDARD_CP_COUNT, 1) + '%（待评估）') : '—');
    $('#ledgerCov').textContent = cov;
    updateLlmBadge();
  }

  function updateLlmBadge() {
    var el = $('#ledgerLlm');
    if (!el) return;
    if (S.llmStatus.used && S.llmStatus.ok) el.textContent = '已启用（语义增强）';
    else if (S.llmStatus.used && S.llmStatus.degraded) el.textContent = '降级（规则引擎）';
    else el.textContent = $('#chkUseLlm') && $('#chkUseLlm').checked ? '已配置（按需调用）' : '规则引擎模式';
  }

  function persistMaterials() {
    IC.LS.set(IC.C.LS.materials, {
      at: U.nowStamp(),
      controls: S.materials.controls,
      selfassessment: S.materials.selfassessment,
      defects: S.materials.defects
    });
  }

  function loadMaterialsFromStorage() {
    var m = IC.LS.get(IC.C.LS.materials, null);
    if (!m) return;
    var ok = false;
    MAT_KEYS.forEach(function (k) {
      if (Array.isArray(m[k]) && m[k].length) {
        S.materials[k] = m[k];
        var ctx = k === 'controls' ? { cpIds: {}, allCpIds: [] } : matCtx();
        // 重新归一化校验（旧版本的字段可能缺失）
        var norm = k === 'controls' ? IC.normalizeControls(m[k]) : (k === 'selfassessment' ? IC.normalizeSelfAssessment(m[k]) : IC.normalizeDefects(m[k]));
        S.materials[k] = norm;
        S.validation[k] = IC.validateMaterials(k, norm, ctx);
        renderMaterialCard(k);
        renderIssues(k);
        ok = true;
      }
    });
    if (ok) {
      renderLedger();
      var sum = S.materials.controls.length + ' 个控制点 / ' + S.materials.selfassessment.length + ' 条自评 / ' + S.materials.defects.length + ' 条缺陷记录';
      global.setTimeout(function () { toast('已恢复上次导入的材料：' + sum, '', 3200); }, 800);
    }
  }

  /* ---------- 填表单 ---------- */
  function renderForm(k) {
    var box = $('#form-' + k);
    if (!box) return;
    var schema = IC.SCHEMA[k];
    var rows = S.materials[k].length ? S.materials[k] : [blankRecord(k)];
    // 只需保证至少一行用于录入
    if (!rows.length) rows = [blankRecord(k)];
    box.innerHTML = rows.map(function (r, i) {
      var cells = schema.fields.map(function (f) {
        var v = r[f.k];
        if (Array.isArray(v)) v = v.join('、');
        var wide = (f.k === 'evidence' || f.k === 'deviation' || f.k === 'desc' || f.k === 'design' || f.k === 'advice');
        return '<input class="inp' + (wide ? ' span2' : '') + '" data-f="' + f.k + '" placeholder="' + esc(f.name) + '" value="' + esc(v === undefined || v === null ? '' : v) + '">';
      }).join('');
      return '<div class="form-row" data-i="' + i + '">' + cells +
        '<button type="button" class="linkbtn del" data-del="' + i + '" title="删除本行">删除</button></div>';
    }).join('');
    $$('.del', box).forEach(function (b) {
      on(b, 'click', function () {
        var row = b.closest('.form-row');
        if (row && row.parentNode) row.parentNode.removeChild(row);
      });
    });
  }

  function blankRecord(k) {
    var o = {};
    IC.SCHEMA[k].fields.forEach(function (f) { o[f.k] = ''; });
    o._row = 1;
    return o;
  }

  function formAdd(k) {
    var box = $('#form-' + k);
    if (!box) return;
    if (!box.children.length) renderForm(k);
    var schema = IC.SCHEMA[k];
    var idx = box.children.length;
    var cells = schema.fields.map(function (f) {
      var wide = (f.k === 'evidence' || f.k === 'deviation' || f.k === 'desc' || f.k === 'design');
      return '<input class="inp' + (wide ? ' span2' : '') + '" data-f="' + f.k + '" placeholder="' + esc(f.name) + '">';
    }).join('');
    var div = doc.createElement('div');
    div.className = 'form-row';
    div.setAttribute('data-i', idx);
    div.innerHTML = cells + '<button type="button" class="linkbtn del" title="删除本行">删除</button>';
    box.appendChild(div);
    on($('.del', div), 'click', function () { if (div.parentNode) div.parentNode.removeChild(div); });
  }

  function formSave(k) {
    var box = $('#form-' + k);
    if (!box) return;
    var records = [];
    $$('.form-row', box).forEach(function (row, i) {
      var rec = {};
      var empty = true;
      $$('input[data-f]', row).forEach(function (inp) {
        var v = U.clean(inp.value);
        rec[inp.getAttribute('data-f')] = v;
        if (v) empty = false;
      });
      if (!empty) { rec._row = records.length + 1; records.push(rec); }
    });
    var ctx = k === 'controls' ? { cpIds: {}, allCpIds: [] } : matCtx();
    var norm = k === 'controls' ? IC.normalizeControls(records) : (k === 'selfassessment' ? IC.normalizeSelfAssessment(records) : IC.normalizeDefects(records));
    var v = IC.validateMaterials(k, norm, ctx);
    applyMaterials(k, norm, v, { via: 'form' });
    LLM.log({ type: 'import', action: '表单录入' + MAT_LABEL[k], input: records.length + ' 行', output: '校验 ' + v.level, expected: v.level !== 'bad' });
    toast(MAT_LABEL[k] + '已保存：' + norm.length + ' 条', v.level === 'bad' ? 'warn' : 'ok');
  }

  /* ---------- 预览 / 清空 / 示例 ---------- */
  function previewMaterial(k) {
    var list = S.materials[k];
    if (!list.length) { toast('尚未导入' + MAT_LABEL[k], 'warn'); return; }
    var schema = IC.SCHEMA[k];
    var head = schema.fields.map(function (f) { return '<th>' + esc(f.name) + '</th>'; }).join('');
    var rows = list.slice(0, 300).map(function (r) {
      return '<tr>' + schema.fields.map(function (f) {
        var v = r[f.k];
        if (Array.isArray(v)) v = v.join('、');
        return '<td>' + esc(v === undefined || v === null ? '' : v) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    showGeneral(MAT_LABEL[k] + '（共 ' + list.length + ' 条' + (list.length > 300 ? '，仅显示前 300 条' : '') + '）',
      '<div class="table-wrap" style="max-height:60vh"><table class="grid compact"><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></div>');
  }

  function clearAll() {
    S.materials = { controls: [], selfassessment: [], defects: [] };
    S.validation = { controls: null, selfassessment: null, defects: null };
    S.parsedInfo = { controls: null, selfassessment: null, defects: null };
    S.result = null;
    S.llmResult = null;
    S.testState.preMat = null;
    S.testState.preResult = null;
    MAT_KEYS.forEach(function (k) { renderMaterialCard(k); renderIssues(k); });
    IC.LS.del(IC.C.LS.materials);
    $('#ta-controls').value = '';
    $('#ta-selfassessment').value = '';
    $('#ta-defects').value = '';
    renderLedger();
    renderSideCard();
    renderAlertBanner();
    updateStepNav();
    $('#validateBox').hidden = true;
    $('#progressWrap').hidden = true;
    hideCharts();
    LLM.log({ type: 'ui', action: '清空全部材料', input: '三份材料', output: '已清空并删除本地缓存', expected: true });
    toast('已清空全部材料', 'ok');
  }

  function loadDemo() {
    S.materials.controls = IC.DEMO.controls.map(function (c) { return U.clone(c); });
    S.materials.selfassessment = IC.DEMO.selfassessment.map(function (r) { return U.clone(r); });
    S.materials.defects = IC.DEMO.defects.map(function (r) {
      var o = U.clone(r);
      o.cps = U.splitIds(r.cps);
      o.amount = U.moneyWan(r.amount);
      return o;
    });
    var ctx = matCtx();
    MAT_KEYS.forEach(function (k) {
      S.validation[k] = IC.validateMaterials(k, S.materials[k], k === 'controls' ? {} : ctx);
      renderMaterialCard(k);
      renderIssues(k);
    });
    renderLedger();
    updateStepNav();
    toast('已载入示例材料：120 个控制点 / 120 条自评 / 9 条缺陷记录（演示数据）', 'ok', 4200);
    LLM.log({ type: 'import', action: '载入示例材料（120 控制点）', input: '内置演示数据', output: '控制点 120 / 自评 120 / 缺陷 9', expected: true });
    // 同步展示到粘贴框，便于用户查看与修改
    $('#ta-controls').value = rowsToText(S.materials.controls, 'controls');
    $('#ta-selfassessment').value = rowsToText(S.materials.selfassessment, 'selfassessment');
    $('#ta-defects').value = rowsToText(S.materials.defects, 'defects');
    if (S.result) { S.result = null; S.llmResult = null; renderSideCard(); renderAlertBanner(); }
  }

  function rowsToText(list, k) {
    var schema = IC.SCHEMA[k];
    var out = [schema.fields.map(function (f) { return f.name; }).join('\t')];
    list.forEach(function (r) {
      out.push(schema.fields.map(function (f) {
        var v = r[f.k];
        if (Array.isArray(v)) v = v.join('、');
        return v === undefined || v === null ? '' : v;
      }).join('\t'));
    });
    return out.join('\n');
  }
  UI.rowsToText = rowsToText;

  /* ---------- 参数 ---------- */
  var PARAM_FIELDS = [
    ['p-major', 'majorAmount'], ['p-important', 'importantAmount'],
    ['p-w-general', 'weightGeneral'], ['p-w-important', 'weightImportant'], ['p-w-major', 'weightMajor'],
    ['p-cp-high', 'cpWeightHigh'], ['p-cp-mid', 'cpWeightMid'], ['p-cp-low', 'cpWeightLow'],
    ['p-line-pass', 'passLine'], ['p-line-basic', 'basicLine'], ['p-defect-factor', 'defectFactor']
  ];

  function bindParams() {
    PARAM_FIELDS.forEach(function (p) {
      var el = $('#' + p[0]);
      on(el, 'change', function () {
        readParamsFromInputs();
        IC.LS.set(IC.C.LS.params, S.params);
        renderParamsWarnings();
        renderLedger();
        if (S.result) toast('参数已更新，点击「开始逐点评估」重新计算', 'warn', 3200);
      });
    });
    on($('#btnResetParams'), 'click', function () {
      S.params = U.clone(IC.DEFAULT_PARAMS);
      fillParamInputs();
      IC.LS.set(IC.C.LS.params, S.params);
      renderParamsWarnings();
      toast('已恢复默认评分参数', 'ok');
    });
  }

  function loadParams() {
    var saved = IC.LS.get(IC.C.LS.params, null);
    S.params = IC.sanitizeParams(saved && saved.params ? saved.params : (saved || IC.DEFAULT_PARAMS));
    fillParamInputs();
    var prefs = IC.LS.get(IC.C.LS.prefs, {});
    if (prefs.allowPartial) $('#chkAllowPartial').checked = true;
    if (prefs.useLlm === false) $('#chkUseLlm').checked = false;
    else $('#chkUseLlm').checked = true;
    on($('#chkAllowPartial'), 'change', function () {
      var p = IC.LS.get(IC.C.LS.prefs, {});
      p.allowPartial = $('#chkAllowPartial').checked;
      IC.LS.set(IC.C.LS.prefs, p);
    });
    on($('#chkUseLlm'), 'change', function () {
      var p = IC.LS.get(IC.C.LS.prefs, {});
      p.useLlm = $('#chkUseLlm').checked;
      IC.LS.set(IC.C.LS.prefs, p);
      updateLlmBadge();
    });
  }

  function fillParamInputs() {
    PARAM_FIELDS.forEach(function (p) {
      var el = $('#' + p[0]);
      if (el) el.value = S.params[p[1]];
    });
  }

  function readParamsFromInputs() {
    var raw = {};
    PARAM_FIELDS.forEach(function (p) {
      var el = $('#' + p[0]);
      if (el) raw[p[1]] = U.num(el.value, IC.DEFAULT_PARAMS[p[1]]);
    });
    S.params = IC.sanitizeParams(raw);
    fillParamInputs();
  }

  function renderParamsWarnings() {
    var w = IC.paramWarnings(S.params);
    var el = $('#pWarnWeight');
    if (!el) return;
    el.className = 'tiny' + (w.length ? ' tiny-warn' : '');
    el.textContent = w.length ? w.join(' ') : '校验通过：重大缺陷权重 ' + S.params.weightMajor + ' ≥ 一般缺陷权重 ' + S.params.weightGeneral + ' 的 5 倍（' + (S.params.weightMajor / S.params.weightGeneral).toFixed(1) + ' 倍）。';
  }

  /* ---------- 内部制度补充 ---------- */
  function bindInternalPolicy() {
    on($('#btnSaveInternal'), 'click', function () {
      var raw = $('#taInternal').value;
      S.userPolicies = IC.KB.parseInternal(raw);
      IC.LS.set(IC.C.LS.internal, { raw: raw, at: U.nowStamp() });
      $('#internalState').textContent = S.userPolicies.length
        ? '当前使用：用户粘贴条款 ' + S.userPolicies.length + ' 条（已替换占位条款）'
        : '当前使用：内置占位条款';
      toast(S.userPolicies.length ? '已应用 ' + S.userPolicies.length + ' 条内部制度条款' : '已恢复内置占位条款', 'ok');
      LLM.log({ type: 'ui', action: '保存内部制度补充条款', input: raw.slice(0, 100), output: S.userPolicies.length + ' 条', expected: true });
      if (S.result) renderConclusionView();
    });
    on($('#btnResetInternal'), 'click', function () {
      $('#taInternal').value = '';
      S.userPolicies = [];
      IC.LS.del(IC.C.LS.internal);
      $('#internalState').textContent = '当前使用：内置占位条款';
      toast('已清除补充条款，恢复内置占位条款', 'ok');
      if (S.result) renderConclusionView();
    });
  }

  function loadInternalPolicy() {
    var saved = IC.LS.get(IC.C.LS.internal, null);
    if (saved && saved.raw) {
      $('#taInternal').value = saved.raw;
      S.userPolicies = IC.KB.parseInternal(saved.raw);
      if (S.userPolicies.length) $('#internalState').textContent = '当前使用：用户粘贴条款 ' + S.userPolicies.length + ' 条（已替换占位条款）';
    }
  }

  function activePolicies() {
    return S.userPolicies && S.userPolicies.length ? S.userPolicies : IC.KB.internalPolicies;
  }

  /* ==========================================================================
   * 逐点评估（运行）
   * ====================================================================== */
  function bindRun() {
    on($('#btnRun'), 'click', function () { runEvaluation(false); });
  }

  function validationSummary() {
    var msgs = [];
    var bad = 0;
    MAT_KEYS.forEach(function (k) {
      var v = S.validation[k];
      if (!v) return;
      (v.issues || []).forEach(function (i) {
        if (i.type === 'error') bad++;
        if (msgs.length < 12) msgs.push(MAT_LABEL[k] + '：' + i.msg);
      });
    });
    return { bad: bad, msgs: msgs };
  }

  function showValidate(level, title, lines) {
    var box = $('#validateBox');
    if (!box) return;
    box.hidden = false;
    box.className = 'validate ' + (level === 'ok' ? 'ok' : (level === 'bad' ? 'bad' : ''));
    box.innerHTML = '<b>' + esc(title) + '</b>' + (lines && lines.length ? '<ul>' + lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' : '');
  }

  function runEvaluation(isTest) {
    if (S.running) return;
    readParamsFromInputs();
    var cps = S.materials.controls;
    var sas = S.materials.selfassessment;
    if (!cps.length) {
      showValidate('bad', '材料校验未通过', ['缺少控制点清单：请导入或粘贴控制点清单后再开始评估。']);
      toast('缺少控制点清单，无法开始评估', 'bad', 3600);
      return;
    }
    if (!sas.length) {
      showValidate('bad', '材料校验未通过', ['缺少内控自评表：没有执行证据无法判定运行有效性。', '若确实无自评表，评估结果将全部为「证据不足」并列入待补清单。']);
      toast('缺少内控自评表，无法判定运行有效性', 'bad', 3600);
      return;
    }
    var allowPartial = $('#chkAllowPartial').checked;
    if (cps.length < IC.C.STANDARD_CP_COUNT && !allowPartial) {
      var tip = '当前导入 ' + cps.length + ' 个控制点，缺少 ' + (IC.C.STANDARD_CP_COUNT - cps.length) +
        ' 个（标准口径 120 个）。勾选「允许仅评估已导入部分」后可继续，结论页将标注覆盖率，且结论不得作为年度正式评价。';
      showValidate('', '控制点数量不足 120 个', [tip, '是否仅评估已导入部分？请在「开始逐点评估」上方勾选确认。']);
      toast('控制点不足 120 个：请勾选「允许仅评估已导入部分」', 'warn', 4200);
      $('#chkAllowPartial').focus();
      return;
    }

    var vs = validationSummary();
    if (vs.bad > 0) {
      showValidate('bad', '字段校验发现 ' + vs.bad + ' 处必填项缺失（仍可继续评估，缺失项将按「证据不足」处理）', vs.msgs);
    } else {
      showValidate('ok', '字段校验通过：控制点 ' + cps.length + ' 条、自评记录 ' + sas.length + ' 条、缺陷记录 ' + S.materials.defects.length + ' 条', []);
    }

    S.running = true;
    var btn = $('#btnRun');
    btn.disabled = true;
    btn.textContent = '评估中…';
    var wrap = $('#progressWrap');
    wrap.hidden = false;
    var total = cps.length;
    var done = 0;
    var stepsEl = $('#progressLabel');
    var startAt = Date.now();

    LLM.log({
      type: 'eval',
      action: '开始逐点评估',
      input: '控制点 ' + cps.length + ' / 自评 ' + sas.length + ' / 缺陷记录 ' + S.materials.defects.length + '；参数 ' + JSON.stringify(S.params),
      output: '运行中',
      expected: true
    });

    // 分批推进：每批最多 8 个控制点，真实地逐点计算（可复现），仅用于让进度可见
    var BATCH = Math.max(1, Math.ceil(total / 40));
    function tick() {
      done = Math.min(total, done + BATCH);
      var pct = Math.round(done * 100 / total);
      $('#progressLabel').textContent = '已评估 ' + done + ' / ' + total;
      $('#progressPct').textContent = pct + '%';
      $('#progressFill').style.width = pct + '%';
      $('#progressSub').textContent = done < total
        ? '正在按 checklist 逐项判断设计有效性与运行有效性…（' + cps[Math.min(done, total - 1)].id + ' ' + cps[Math.min(done, total - 1)].name + '）'
        : '正在识别缺陷、按根因合并、加权评分…';
      if (done < total) {
        global.setTimeout(tick, 12);
      } else {
        finish();
      }
    }

    function finish() {
      var materials = {
        controls: S.materials.controls,
        selfassessment: S.materials.selfassessment,
        defects: S.materials.defects
      };
      var t0 = Date.now();
      var result;
      try {
        result = IC.runAll(materials, S.params, { allowPartial: allowPartial });
      } catch (e) {
        S.running = false;
        btn.disabled = false;
        btn.textContent = '▶ 开始逐点评估';
        toast('评估过程出现异常：' + (e && e.message ? e.message : e), 'bad', 5000);
        LLM.log({ type: 'eval', action: '逐点评估', input: '—', output: '异常：' + (e && e.message), expected: false });
        return;
      }
      var ruleMs = Date.now() - t0;
      result.materials = null;
      result.policies = activePolicies();
      S.result = result;
      S.llmResult = null;

      var elapsed = ((Date.now() - startAt) / 1000).toFixed(1);
      renderAll(result);
      saveHistory(result, elapsed);

      LLM.log({
        type: 'eval',
        action: '逐点评估完成',
        input: '控制点 ' + total + ' 个',
        output: '有效 ' + result.stats.validCount + ' / 无效 ' + result.stats.invalidCount + ' / 证据不足 ' + result.stats.insuffCount +
          '；缺陷 ' + result.defects.length + ' 条（重大 ' + result.score.counts['重大'] + '）；总分 ' + U.fix2(result.score.total) + '；结论 ' + result.score.verdict,
        expected: true,
        extra: '耗时 ' + elapsed + 's（规则引擎 ' + ruleMs + 'ms）'
      });

      setStepDone();
      if (isTest) {
        global.setTimeout(function () { renderTestActual(result); }, 120);
      }

      // 语义增强（可选）
      if ($('#chkUseLlm').checked) {
        enhanceWithLLM(result);
      }
      postRunUi(result, elapsed);
    }

    function postRunUi(result, elapsed) {
      S.running = false;
      var btn = $('#btnRun');
      btn.disabled = false;
      btn.textContent = '↻ 重新逐点评估';
      $('#progressSub').textContent = '评估完成：' + total + ' 个控制点 · 耗时 ' + elapsed + ' 秒 · 判定与评分由规则引擎计算（可复现）';
      if (result.score.veto) {
        toast('⚠️ 检测到 ' + result.score.counts['重大'] + ' 项重大缺陷，触发红色预警', 'bad', 5000);
      } else {
        toast('评估完成：结论「' + result.score.verdict + '」，总分 ' + U.fix2(result.score.total), result.score.verdictKey === 'valid' ? 'ok' : 'warn', 4200);
      }
    }

    function setStepDone() {
      updateStepNav();
      var el = $('.step-item[data-step="3"]');
      if (el) el.setAttribute('data-act', 'done');
    }

    tick();
  }
  UI.runEvaluation = runEvaluation;

  /* ---------- 大模型语义增强（失败降级，不影响规则结果） ---------- */
  function enhanceWithLLM(baseResult) {
    var cfg = LLM.getConfig();
    S.llmStatus = { used: true, ok: false, degraded: false, message: '', at: U.nowStamp() };
    updateLlmBadge();
    $('#sideNote').textContent = '大模型语义增强中…判定与评分仍以规则引擎为准。';

    var cpsNeeding = baseResult.points.filter(function (p) { return p.id; });
    // 分批：每批 12 个控制点，最多 6 批（控制调用次数与耗时）
    var batches = [];
    var MAX_BATCHES = 6;
    for (var i = 0; i < cpsNeeding.length && batches.length < MAX_BATCHES; i += 12) {
      batches.push(cpsNeeding.slice(i, i + 12));
    }
    var allMap = {};
    var firstError = '';

    function runBatch(idx) {
      if (idx >= batches.length) { afterReason(); return; }
      var batch = batches[idx].map(function (p) {
        return {
          id: p.id, name: p.name, design: p.design, evidence: p.evidence,
          deviation: p.deviation, designResult: p.designResult,
          operatingResult: p.operatingResult, conclusion: p.conclusion
        };
      });
      LLM.reasonBatch(batch).then(function (r) {
        if (r.ok) {
          Object.keys(r.map).forEach(function (k) { allMap[k] = r.map[k]; });
        } else if (!firstError) {
          firstError = r.error || '调用失败';
        }
        runBatch(idx + 1);
      });
    }

    function afterReason() {
      var got = Object.keys(allMap).length;
      if (!got) {
        S.llmStatus.ok = false;
        S.llmStatus.degraded = true;
        S.llmStatus.message = '大模型调用失败，已切换为规则引擎结果，结论与评分不受影响';
        LLM.log({ type: 'llm', action: '语义增强失败（降级）', input: '—', output: firstError, expected: false });
        updateLlmBadge();
        $('#sideNote').textContent = '⚠️ 大模型调用失败，已切换为规则引擎结果，结论与评分不受影响（原因：' + firstError + '）';
        toast('大模型调用失败，已切换为规则引擎结果，结论与评分不受影响', 'warn', 5000);
        return;
      }
      // 应用：仅替换「判定依据」文字，不动任何判定与分数
      var enhanced = U.clone(baseResult);
      enhanced.points.forEach(function (p) {
        if (allMap[p.id]) {
          var suffix = '；LLM：' + allMap[p.id];
          p.reason = p.reason + suffix;
          p.reasonByLlm = allMap[p.id];
        }
      });
      S.llmResult = enhanced;
      S.llmStatus.ok = true;
      S.llmStatus.degraded = got < cpsNeeding.length;
      S.llmStatus.message = '已对 ' + got + ' 个控制点生成语义判定依据（等级与评分仍以规则引擎为准）';
      updateLlmBadge();
      $('#sideNote').textContent = '数据只在本机：材料保存在浏览器内存与本地存储；本页仅将控制点描述与自评证据文本发送至大模型 API 用于文字润色，不发送其他任何数据。';
      toast('大模型语义增强完成（' + got + ' 个控制点），判定与评分不受影响', 'ok', 3600);
      if (S.activeView === 'eval') renderEvalView();
      if (S.activeView === 'conclusion') renderConclusionView();
    }

    runBatch(0);
  }

  /* ==========================================================================
   * 渲染：总入口
   * ====================================================================== */
  function currentResult() {
    return S.llmResult || S.result;
  }

  function renderAll(result) {
    renderSideCard();
    renderAlertBanner();
    renderEvalView();
    renderDefectView();
    renderScoreView();
    renderConclusionView();
    renderCharts();
    renderPending();
  }

  /* ---------- 结论速览卡 ---------- */
  function renderSideCard() {
    var r = currentResult();
    var vEl = $('#sideVerdict');
    if (!r) {
      $('#sideBadge').textContent = '未评估';
      $('#sideSub').textContent = '导入材料后开始逐点评估';
      vEl.setAttribute('data-level', 'none');
      ['#sideTotal', '#sideWeighted', '#sideDeduct', '#sideCoverage', '#sideEvalSplit', '#sideDefectCount', '#sideDefectSplit', '#sideVeto', '#sideAlert'].forEach(function (s) {
        var el = $(s); if (el) el.textContent = '—';
      });
      $('#sideStamp').textContent = '—';
      $('#sideAlertBox').hidden = true;
      $('#btnSideDownload').disabled = true;
      $('#btnSidePrint').disabled = true;
      return;
    }
    var s = r.score;
    var levelKey = s.verdictKey;
    vEl.setAttribute('data-level', levelKey);
    $('#sideBadge').textContent = s.verdict;
    $('#sideSub').textContent = s.veto
      ? '一票否决：存在 ' + s.majorIds.length + ' 项重大缺陷'
      : '无重大缺陷，按加权总分判定';
    $('#sideTotal').textContent = U.fix2(s.total);
    $('#sideWeighted').textContent = U.fix2(s.weightedScore);
    $('#sideDeduct').textContent = '-' + U.fix2(s.deduct);
    $('#sideCoverage').textContent = r.stats.coverage + '%（' + r.stats.cpCount + '/' + r.stats.standard + '）';
    $('#sideEvalSplit').textContent = r.stats.validCount + ' / ' + r.stats.invalidCount + ' / ' + r.stats.insuffCount;
    $('#sideDefectCount').textContent = s.defectCount + ' 条';
    $('#sideDefectSplit').textContent = s.counts['重大'] + ' / ' + s.counts['重要'] + ' / ' + s.counts['一般'];
    $('#sideVeto').textContent = s.veto ? '触发（' + s.majorIds.join('、') + '）' : '未触发';
    $('#sideVeto').style.color = s.veto ? 'var(--danger)' : 'var(--ok)';
    $('#sideAlert').textContent = s.veto ? '⚠️ 红色预警' : '无';
    $('#sideAlert').style.color = s.veto ? 'var(--danger)' : 'var(--text)';
    $('#sideStamp').textContent = r.at;
    var box = $('#sideAlertBox');
    if (s.veto) {
      box.hidden = false;
      var majors = r.defects.filter(function (d) { return d.level === '重大'; });
      $('#sideAlertDetail').innerHTML = majors.slice(0, 3).map(function (d) {
        return '<div>' + esc(d.id) + '　' + esc(U.oneLine(d.summary).slice(0, 42)) + '…</div>';
      }).join('') + (majors.length > 3 ? '<div>另有 ' + (majors.length - 3) + ' 项，见预警卡</div>' : '');
    } else {
      box.hidden = true;
    }
    $('#btnSideDownload').disabled = false;
    $('#btnSidePrint').disabled = false;
  }

  function renderAlertBanner() {
    var r = currentResult();
    var banner = $('#alertBanner');
    if (!banner) return;
    if (r && r.score.veto) {
      banner.hidden = false;
      $('#alertTitle').textContent = '检测到 ' + r.score.counts['重大'] + ' 项重大缺陷，触发红色预警';
      $('#alertSub').textContent = '结论已按一票否决判为「无效」（' + r.score.majorIds.join('、') + '），请立即查看红色预警卡并启动整改。';
    } else {
      banner.hidden = true;
    }
  }

  /* ---------- 待补清单 ---------- */
  function renderPending() {
    var r = currentResult();
    var box = $('#sidePending');
    var cnt = $('#sidePendingCount');
    if (!r) {
      box.innerHTML = '<div class="empty-mini">暂无证据不足的控制点</div>';
      cnt.textContent = '0 项';
      return;
    }
    var list = r.pending || [];
    cnt.textContent = list.length + ' 项';
    if (!list.length) {
      box.innerHTML = '<div class="empty-mini">暂无证据不足的控制点</div>';
      return;
    }
    box.innerHTML = list.map(function (p) {
      return '<div class="pending-i"><b>' + esc(p.id) + '</b> ' + esc(p.name) + '（' + esc(p.dept) + '）<br>' + esc(p.reason) + '</div>';
    }).join('');
  }

  /* ==========================================================================
   * 视图 2：控制点评估表
   * ====================================================================== */
  function bindEvalView() {
    ['#f-eval-conclusion', '#f-eval-level', '#f-eval-flow', '#f-eval-dept'].forEach(function (sel) {
      on($(sel), 'change', function () {
        S.filters.eval[$(sel).id.replace('f-eval-', '')] = $(sel).value;
        renderEvalView();
      });
    });
    var kw = $('#f-eval-kw');
    var timer = null;
    on(kw, 'input', function () {
      global.clearTimeout(timer);
      timer = global.setTimeout(function () {
        S.filters.eval.kw = kw.value;
        renderEvalView();
      }, 180);
    });
    on($('#btnEvalReset'), 'click', function () {
      S.filters.eval = { conclusion: '', level: '', flow: '', dept: '', kw: '', sort: '', dir: '' };
      $('#f-eval-conclusion').value = '';
      $('#f-eval-level').value = '';
      $('#f-eval-flow').value = '';
      $('#f-eval-dept').value = '';
      $('#f-eval-kw').value = '';
      renderEvalView();
    });
    $$('#tblEval thead th.sortable').forEach(function (th) {
      on(th, 'click', function () {
        var key = th.getAttribute('data-sort');
        var f = S.filters.eval;
        if (f.sort === key) f.dir = f.dir === 'asc' ? 'desc' : 'asc';
        else { f.sort = key; f.dir = 'asc'; }
        renderEvalView();
      });
    });
  }

  var EVAL_SORT_KEY = {
    id: function (p) { return p.id; },
    name: function (p) { return p.name; },
    flow: function (p) { return p.flow; },
    risk: function (p) { return ({ '高': 3, '中': 2, '低': 1 })[p.risk] || 0; },
    dept: function (p) { return p.dept; },
    design: function (p) { return p.designResult === '有效' ? 1 : 0; },
    operating: function (p) { return p.operatingResult === '有效' ? 2 : (p.operatingResult === '证据不足' ? 1 : 0); },
    conclusion: function (p) { return p.conclusion === '有效' ? 2 : (p.conclusion === '无效' ? 1 : 0); },
    defect: function (p) { return ({ '重大': 3, '重要': 2, '一般': 1, '无': 0 })[p.level] || 0; }
  };

  function renderEvalView() {
    var r = currentResult();
    var tb = $('#tbEval');
    if (!tb) return;
    if (!r) {
      tb.innerHTML = '<tr><td colspan="10"><div class="empty-state">尚未评估。请先导入三份材料并点击「▶ 开始逐点评估」。</div></td></tr>';
      $('#evalStats').innerHTML = '';
      $('#evalFoot').textContent = '尚未评估';
      return;
    }
    // 筛选下拉选项
    fillSelect($('#f-eval-flow'), r.points.map(function (p) { return p.flow; }), S.filters.eval.flow, '全部流程');
    fillSelect($('#f-eval-dept'), r.points.map(function (p) { return p.dept; }), S.filters.eval.dept, '全部部门');

    // 统计
    $('#evalStats').innerHTML = [
      statBox('控制点总数', r.stats.cpCount, ''),
      statBox('有效', r.stats.validCount, 'ok'),
      statBox('无效', r.stats.invalidCount, 'bad'),
      statBox('证据不足', r.stats.insuffCount, 'warn'),
      statBox('覆盖率', r.stats.coverage + '%', r.stats.coverage >= 100 ? 'ok' : 'warn')
    ].join('');

    var f = S.filters.eval;
    var list = r.points.filter(function (p) {
      if (f.conclusion && p.conclusion !== f.conclusion) return false;
      if (f.level && (f.level === '无' ? p.level !== '无' : p.level !== f.level)) return false;
      if (f.flow && p.flow !== f.flow) return false;
      if (f.dept && p.dept !== f.dept) return false;
      if (f.kw) {
        var kw = f.kw.toLowerCase();
        var hay = (p.id + ' ' + p.name + ' ' + p.reason + ' ' + p.dept + ' ' + p.flow).toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });
    if (f.sort && EVAL_SORT_KEY[f.sort]) {
      list = U.sortBy(list, EVAL_SORT_KEY[f.sort], f.dir || 'asc');
    }
    // 排序指示
    $$('#tblEval thead th.sortable').forEach(function (th) {
      var k = th.getAttribute('data-sort');
      if (f.sort === k) th.setAttribute('data-dir', f.dir || 'asc');
      else th.removeAttribute('data-dir');
    });

    tb.innerHTML = list.map(function (p) {
      var cls = p.conclusion === '无效' ? 'row-invalid' : (p.conclusion === '证据不足' ? 'row-insufficient' : '');
      return '<tr class="' + cls + '">' +
        '<td class="mono">' + esc(p.id) + '</td>' +
        '<td>' + esc(p.name) + '</td>' +
        '<td>' + esc(p.flow) + '</td>' +
        '<td class="' + riskCls(p.risk) + '">' + esc(p.risk) + '</td>' +
        '<td>' + esc(p.dept) + '</td>' +
        '<td>' + vbadge(p.designResult) + '</td>' +
        '<td>' + vbadge(p.operatingResult) + '</td>' +
        '<td>' + vbadge(p.conclusion) + '</td>' +
        '<td class="reason">' + esc(p.reason) + '</td>' +
        '<td>' + (p.defectIds.length ? p.defectIds.map(function (id) { return '<span class="chip-l">' + esc(id) + '</span>'; }).join('') + vbadge(p.level) : '<span class="tiny">—</span>') + '</td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="10"><div class="empty-state">没有符合筛选条件的控制点</div></td></tr>';

    $('#evalFoot').textContent = '显示 ' + list.length + ' / ' + r.points.length + ' 个控制点' +
      (list.length !== r.points.length ? '（已按筛选条件过滤）' : '') + ' · 覆盖率 ' + r.stats.coverage + '%';
  }

  function statBox(label, val, cls) {
    return '<div class="stat ' + (cls || '') + '"><span>' + esc(label) + '</span><b>' + esc(val) + '</b></div>';
  }

  function fillSelect(sel, values, current, allLabel) {
    if (!sel) return;
    var uniq = U.uniq(values).sort(function (a, b) { return String(a).localeCompare(String(b), 'zh-CN'); });
    var optHtml = '<option value="">' + esc(allLabel || '全部') + '</option>' + uniq.map(function (v) {
      return '<option value="' + esc(v) + '"' + (v === current ? ' selected' : '') + '>' + esc(v) + '</option>';
    }).join('');
    if (sel.innerHTML !== optHtml) sel.innerHTML = optHtml;
    sel.value = current || '';
  }

  /* ==========================================================================
   * 视图 3：缺陷清单 + 图表
   * ====================================================================== */
  function bindDefectView() {
    on($('#f-defect-level'), 'change', function () { S.filters.defect.level = this.value; renderDefectView(); });
    on($('#f-defect-nature'), 'change', function () { S.filters.defect.nature = this.value; renderDefectView(); });
    var kw = $('#f-defect-kw');
    var timer = null;
    on(kw, 'input', function () {
      global.clearTimeout(timer);
      timer = global.setTimeout(function () { S.filters.defect.kw = kw.value; renderDefectView(); }, 180);
    });
    on($('#btnDefectReset'), 'click', function () {
      S.filters.defect = { level: '', nature: '', kw: '', sort: '', dir: '' };
      $('#f-defect-level').value = '';
      $('#f-defect-nature').value = '';
      $('#f-defect-kw').value = '';
      renderDefectView();
    });
    $$('#tblDefect thead th.sortable').forEach(function (th) {
      on(th, 'click', function () {
        var key = th.getAttribute('data-sort');
        var f = S.filters.defect;
        if (f.sort === key) f.dir = f.dir === 'asc' ? 'desc' : 'asc';
        else { f.sort = key; f.dir = key === 'cpCount' ? 'desc' : 'asc'; }
        renderDefectView();
      });
    });
  }

  var DEFECT_SORT_KEY = {
    id: function (d) { return d.id; },
    summary: function (d) { return d.summary; },
    cpCount: function (d) { return d.cpCount; },
    nature: function (d) { return d.nature; },
    quantLevel: function (d) { return IC.C.LEVEL_ORDER[d.quantLevel] || 0; },
    redline: function (d) { return d.redlines.length ? d.redlines.join('、') : '无'; },
    level: function (d) { return IC.C.LEVEL_ORDER[d.level] || 0; },
    dept: function (d) { return d.dept; }
  };

  function renderDefectView() {
    var r = currentResult();
    var tb = $('#tbDefect');
    if (!tb) return;
    if (!r) {
      tb.innerHTML = '<tr><td colspan="10"><div class="empty-state">尚未评估。</div></td></tr>';
      $('#defectStats').innerHTML = '';
      $('#defectFoot').textContent = '尚未评估';
      return;
    }
    $('#defectStats').innerHTML = [
      statBox('缺陷条数（合并后）', r.defects.length, ''),
      statBox('重大', r.score.counts['重大'], r.score.counts['重大'] ? 'bad' : 'ok'),
      statBox('重要', r.score.counts['重要'], 'warn'),
      statBox('一般', r.score.counts['一般'], ''),
      statBox('失效控制点（合并前）', r.stats.invalidCount, ''),
      statBox('定性红线命中', r.defects.filter(function (d) { return d.redlines.length; }).length, r.defects.some(function (d) { return d.redlines.length; }) ? 'bad' : 'ok')
    ].join('');

    var f = S.filters.defect;
    var list = r.defects.filter(function (d) {
      if (f.level && d.level !== f.level) return false;
      if (f.nature && d.nature !== f.nature) return false;
      if (f.kw) {
        var kw = f.kw.toLowerCase();
        var hay = (d.id + ' ' + d.summary + ' ' + d.cpIds.join(' ') + ' ' + d.dept + ' ' + d.rootCauseTag).toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });
    if (f.sort && DEFECT_SORT_KEY[f.sort]) list = U.sortBy(list, DEFECT_SORT_KEY[f.sort], f.dir || 'asc');
    $$('#tblDefect thead th.sortable').forEach(function (th) {
      var k = th.getAttribute('data-sort');
      if (f.sort === k) th.setAttribute('data-dir', f.dir || 'asc'); else th.removeAttribute('data-dir');
    });

    tb.innerHTML = list.map(function (d) {
      return '<tr class="' + (d.level === '重大' ? 'row-invalid' : '') + '">' +
        '<td class="mono">' + esc(d.id) + '</td>' +
        '<td><div>' + esc(d.summary) + '</div><div class="tiny">根因标签：' + esc(d.rootCauseTag) + ' · 流程：' + esc(d.flow) + '</div></td>' +
        '<td class="num">' + d.cpCount + (d.fromMergedCount > 1 ? '<div class="tiny">合并 ' + d.fromMergedCount + ' 项</div>' : '') + '</td>' +
        '<td>' + d.cpIds.map(function (id) { return '<span class="chip-l">' + esc(id) + '</span>'; }).join('') + '</td>' +
        '<td>' + esc(d.nature) + '</td>' +
        '<td>' + vbadge(d.quantLevel) + '<div class="tiny">' + U.moneyText(d.amount) + '</div></td>' +
        '<td>' + (d.redlines.length ? d.redlines.map(function (x) { return '<span class="vb vb-major">' + esc(x) + '</span>'; }).join(' ') : '<span class="tiny">无</span>') + '</td>' +
        '<td>' + vbadge(d.level) + '</td>' +
        '<td>' + esc(d.dept) + '</td>' +
        '<td class="reason">' + esc(d.advice) + '</td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="10"><div class="empty-state">没有符合筛选条件的缺陷</div></td></tr>';

    $('#defectFoot').textContent = '显示 ' + list.length + ' / ' + r.defects.length + ' 条缺陷 · 排序固定为「等级降序 → 涉及金额降序 → 缺陷编号升序」';
    renderCharts();
  }

  /* ---------- 图表 ---------- */
  function hideCharts() {
    if (S.charts.pie) { S.charts.pie.dispose(); S.charts.pie = null; }
    if (S.charts.matrix) { S.charts.matrix.dispose(); S.charts.matrix = null; }
  }

  function renderCharts() {
    var r = currentResult();
    if (!r) return;
    if (!IC.env.hasECharts()) {
      $('#chartNote').textContent = '图表组件（ECharts）未加载，缺陷等级分布与风险矩阵以表格数据为准。';
      return;
    }
    var echarts = global.echarts;
    var pieEl = $('#chartPie');
    var mxEl = $('#chartMatrix');
    if (!pieEl || !mxEl || !pieEl.offsetWidth) return;

    // 饼图：缺陷等级分布
    if (!S.charts.pie) S.charts.pie = echarts.init(pieEl);
    var major = r.score.counts['重大'], imp = r.score.counts['重要'], gen = r.score.counts['一般'];
    S.charts.pie.setOption({
      title: { text: '缺陷等级分布', subtext: '合并后共 ' + r.defects.length + ' 条', left: 'center', textStyle: { fontSize: 13, color: '#1B3A6B', fontFamily: 'Microsoft YaHei' }, subtextStyle: { fontSize: 11, color: '#8A98AC' } },
      tooltip: { trigger: 'item', formatter: '{b}：{c} 条（{d}%）' },
      legend: { bottom: 4, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11, color: '#5A6B82' } },
      color: ['#C62828', '#F59E0B', '#7C8DB5'],
      series: [{
        type: 'pie', radius: ['42%', '62%'], center: ['50%', '52%'],
        avoidLabelOverlap: true,
        label: { formatter: '{b}\n{c} 条', fontSize: 11, color: '#1F2A3A' },
        labelLine: { length: 8, length2: 8 },
        data: [
          { value: major, name: '重大' },
          { value: imp, name: '重要' },
          { value: gen, name: '一般' }
        ].filter(function (x) { return x.value > 0; })
      }]
    }, true);

    // 热力图：风险矩阵 可能性 × 影响程度
    if (!S.charts.matrix) S.charts.matrix = echarts.init(mxEl);
    var data = [];
    var cells = {};
    r.defects.forEach(function (d) {
      var key = d.possibility + '-' + d.impact;
      cells[key] = (cells[key] || 0) + 1;
    });
    for (var poss = 1; poss <= 5; poss++) {
      for (var impd = 1; impd <= 5; impd++) {
        data.push([impd - 1, poss - 1, cells[impd + '-' + poss] || 0]);
      }
    }
    S.charts.matrix.setOption({
      title: { text: '风险矩阵（可能性 × 影响程度）', subtext: '方块数字 = 该风险格内的缺陷条数', left: 'center', textStyle: { fontSize: 13, color: '#1B3A6B', fontFamily: 'Microsoft YaHei' }, subtextStyle: { fontSize: 11, color: '#8A98AC' } },
      tooltip: {
        position: 'top',
        formatter: function (p) {
          var R = (p.data[1] + 1) * (p.data[0] + 1);
          var band = IC.riskBand(R);
          return '可能性 ' + (p.data[1] + 1) + ' × 影响程度 ' + (p.data[0] + 1) + ' = R ' + R + '（' + band + '风险）<br>缺陷 ' + p.data[2] + ' 条';
        }
      },
      grid: { left: 46, right: 20, top: 56, bottom: 40 },
      xAxis: { type: 'category', data: ['1', '2', '3', '4', '5'], name: '影响程度', nameTextStyle: { fontSize: 11, color: '#8A98AC' }, axisLabel: { fontSize: 11, color: '#5A6B82' }, splitArea: { show: true } },
      yAxis: { type: 'category', data: ['1', '2', '3', '4', '5'], name: '可能性', nameTextStyle: { fontSize: 11, color: '#8A98AC' }, axisLabel: { fontSize: 11, color: '#5A6B82' }, splitArea: { show: true } },
      visualMap: {
        min: 0, max: 25, orient: 'horizontal', left: 'center', bottom: 2, itemWidth: 10, itemHeight: 70,
        text: ['高', '低'], textStyle: { fontSize: 10, color: '#5A6B82' },
        inRange: { color: ['#E8F0FE', '#BFD3F5', '#F6D48A', '#F09B66', '#D9534F'] }
      },
      series: [{
        type: 'heatmap', data: data,
        label: { show: true, fontSize: 11, color: '#1F2A3A', formatter: function (p) { return p.data[2] ? p.data[2] : ''; } },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(27,58,107,.35)' } }
      }]
    }, true);
  }

  on(global, 'resize', function () {
    if (S.charts.pie) S.charts.pie.resize();
    if (S.charts.matrix) S.charts.matrix.resize();
  });

  /* ==========================================================================
   * 视图 4：加权评分明细
   * ====================================================================== */
  function bindScoreView() {
    $$('#tblScoreCp thead th.sortable').forEach(function (th) {
      on(th, 'click', function () {
        var key = th.getAttribute('data-sort');
        var f = S.filters.score;
        if (f.sort === key) f.dir = f.dir === 'asc' ? 'desc' : 'asc';
        else { f.sort = key; f.dir = 'asc'; }
        renderScoreView();
      });
    });
  }

  function renderScoreView() {
    var r = currentResult();
    if (!r) {
      $('#scoreSteps').innerHTML = '<div class="empty-state">尚未评估。</div>';
      $('#tbScoreCp').innerHTML = '';
      $('#tbScoreDf').innerHTML = '';
      return;
    }
    var s = r.score;
    // 公式代入（展示当前生效参数）
    $('#scoreSteps').innerHTML = s.steps.map(function (st, i) {
      return '<div class="sstep' + (st.isFinal ? ' is-final' : '') + (st.isVerdict ? ' is-verdict' : '') + '">' +
        '<div class="sstep-n">' + (i + 1) + '</div>' +
        '<div><div class="sstep-t">' + esc(st.title) + '</div><div class="sstep-b">' + st.body + '</div></div></div>';
    }).join('') +
      '<div class="sstep is-verdict"><div class="sstep-n">✓</div><div><div class="sstep-t">评分口径（当前生效参数）</div>' +
      '<div class="sstep-b">缺陷权重：一般 ' + s.params.weightGeneral + ' / 重要 ' + s.params.weightImportant + ' / 重大 ' + s.params.weightMajor +
      '；控制点权重：高 ' + s.params.cpWeightHigh + ' / 中 ' + s.params.cpWeightMid + ' / 低 ' + s.params.cpWeightLow +
      '；金额阈值：重大 ≥ ' + s.params.majorAmount + ' 万元、重要 ≥ ' + s.params.importantAmount + ' 万元；结论线：有效 ≥ ' + s.params.passLine +
      '，基本有效 ≥ ' + s.params.basicLine + '；缺陷扣分系数 ' + s.params.defectFactor + '。</div></div></div>';

    var rows = s.cpRows.slice();
    var f = S.filters.score;
    if (f.sort) {
      var keyMap = {
        id: function (x) { return x.id; }, weight: function (x) { return x.weight; },
        score: function (x) { return x.score; }, weighted: function (x) { return x.weighted; }
      };
      if (keyMap[f.sort]) rows = U.sortBy(rows, keyMap[f.sort], f.dir || 'asc');
    }
    $$('#tblScoreCp thead th.sortable').forEach(function (th) {
      var k = th.getAttribute('data-sort');
      if (f.sort === k) th.setAttribute('data-dir', f.dir || 'asc'); else th.removeAttribute('data-dir');
    });
    $('#tbScoreCp').innerHTML = rows.map(function (x) {
      return '<tr><td class="mono">' + esc(x.id) + '</td><td>' + esc(x.name) + '</td>' +
        '<td class="' + riskCls(x.risk) + '">' + esc(x.risk) + '</td><td class="num">' + x.weight + '</td>' +
        '<td>' + vbadge(x.design) + '</td><td>' + vbadge(x.operating) + '</td>' +
        '<td class="num"><b>' + U.fix2(x.score) + '</b></td><td class="num">' + U.fix2(x.weighted) + '</td>' +
        '<td class="tiny">' + (x.counted ? '计入分母' : '不计入') + '</td></tr>';
    }).join('');
    $('#scoreCpCount').textContent = '共 ' + s.cpRows.length + ' 个控制点 · Σ权重 ' + U.fix2(s.sumWeight) + ' · Σ(权重×得分) ' + U.fix2(s.sumWeighted);

    $('#tbScoreDf').innerHTML = r.defects.map(function (d) {
      return '<tr><td class="mono">' + esc(d.id) + '</td><td>' + esc(d.summary) + '</td><td>' + vbadge(d.level) + '</td>' +
        '<td class="num">' + d.weight + '</td><td class="num">' + d.possibility + '</td><td class="num">' + d.impact + '</td>' +
        '<td class="num"><b>' + d.R + '</b></td><td class="num">' + U.fix2(d.weight * d.R) + '</td>' +
        '<td>' + esc(d.riskBand) + '</td></tr>';
    }).join('') || '<tr><td colspan="9"><div class="empty-state">本次未识别缺陷</div></td></tr>';
  }

  /* ==========================================================================
   * 视图 5：评价结论 + 预警卡
   * ====================================================================== */
  function bindConclusionView() {
  }

  function renderConclusionView() {
    var r = currentResult();
    var body = $('#conclBody');
    var empty = $('#conclEmpty');
    if (!r) {
      if (body) body.hidden = true;
      if (empty) empty.hidden = false;
      $('#alertCardWrap').hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    body.hidden = false;
    var s = r.score;
    var policies = activePolicies();
    var regs = EX.collectRegs(r);

    var conclHtml = [];
    conclHtml.push('<div class="verdict-banner ' + s.verdictKey + '">' +
      '<div class="vb-big">' + esc(s.verdict) + '</div>' +
      '<div class="vb-meta"><b>' + (s.veto ? '一票否决：存在 ' + s.majorIds.length + ' 项重大缺陷（' + s.majorIds.join('、') + '）' : '无重大缺陷，按加权总分判定') + '</b>' +
      '<span>' + esc(s.verdictReason) + '</span></div>' +
      '<div class="vb-score"><b>' + U.fix2(s.total) + '</b><span>加权总分（结论以定性判定为准）</span></div></div>');

    // 覆盖率与提示
    if (r.stats.coverage < 100) {
      conclHtml.push('<div class="concl-note bad">⚠️ 覆盖率 ' + r.stats.coverage + '%（' + r.stats.cpCount + ' / ' + r.stats.standard +
        ' 个控制点，未覆盖 ' + r.stats.missingCp + ' 个）：本结论仅供参考，不可作为年度正式评价报告。</div>');
    }
    if (!r.defects.length) {
      conclHtml.push('<div class="concl-note warn">本次评估未发现缺陷，结论可判「有效」，但请确认自评表是否完整填报（尤其执行证据列），避免因填报不完整掩盖问题。</div>');
    }
    (r.warnings || []).forEach(function (w) {
      if (w.msg.indexOf('覆盖率') === 0) return;
      conclHtml.push('<div class="concl-note warn">' + esc(w.msg) + '</div>');
    });

    conclHtml.push('<div class="kv-list">' +
      kvItem('加权得分', U.fix2(s.weightedScore)) +
      kvItem('缺陷扣分', '-' + U.fix2(s.deduct)) +
      kvItem('缺陷条数', s.defectCount + ' 条（重大 ' + s.counts['重大'] + ' / 重要 ' + s.counts['重要'] + ' / 一般 ' + s.counts['一般'] + '）') +
      kvItem('控制点判定', '有效 ' + r.stats.validCount + ' / 无效 ' + r.stats.invalidCount + ' / 证据不足 ' + r.stats.insuffCount) +
      kvItem('覆盖率', r.stats.coverage + '%') +
      kvItem('评分口径', '风险矩阵加权 + 一票否决') +
      '</div>');

    // ① 主要缺陷
    conclHtml.push('<div class="concl-section"><h3>一、主要缺陷（' + r.defects.length + ' 条，按等级降序）</h3>');
    if (r.defects.length) {
      conclHtml.push('<ol class="concl-list-defect">');
      r.defects.forEach(function (d) {
        conclHtml.push('<li>' + vbadge(d.level) + ' <b>' + esc(d.id) + '</b> ' + esc(d.summary) +
          '：关联 ' + d.cpIds.map(function (id) { return esc(id); }).join('、') +
          '，责任部门：' + esc(d.dept) +
          (d.amount > 0 ? '，涉及金额 ' + U.fix2(d.amount) + ' 万元' : '，无直接金额（流程性缺陷）') +
          (d.redlines.length ? '，<span style="color:#C62828;font-weight:700">定性红线：' + esc(d.redlines.join('；')) + '</span>' : '') +
          '</li>');
      });
      conclHtml.push('</ol>');
    } else {
      conclHtml.push('<div class="tiny">未发现缺陷。</div>');
    }
    conclHtml.push('</div>');

    // ② 法规与制度依据
    conclHtml.push('<div class="concl-section"><h3>二、法规与制度依据</h3><ol>');
    regs.forEach(function (reg) {
      conclHtml.push('<li>' + esc(reg.law + ' ' + reg.label) + '：' + esc(reg.text) + '</li>');
    });
    policies.slice(0, 4).forEach(function (p) {
      conclHtml.push('<li>' + esc(p.name + ' ' + p.clause) + '：' + esc(p.text) + '</li>');
    });
    conclHtml.push('</ol><div class="concl-note">内部制度条款' + (S.userPolicies.length ? '来自你在「内部制度补充」中粘贴的内容' : '为内置占位条款') +
      '，以集团正式文本为准，请核对。法规条款仅引用内置条款表中确有原文的条款；条款号无法确证的标注为「相关条款（以正式文本为准）」。</div></div>');

    // ③ 评分明细摘要
    conclHtml.push('<div class="concl-section"><h3>三、加权评分明细</h3><ol>');
    s.steps.forEach(function (st) {
      conclHtml.push('<li>' + esc(st.title) + '：' + st.body + '</li>');
    });
    conclHtml.push('</ol></div>');

    // ④ 整改要求
    conclHtml.push('<div class="concl-section"><h3>四、整改要求</h3><ol>' +
      '<li><b>重大缺陷</b>：1 个月内制定整改方案，明确责任人、整改措施与完成时限，报审计委员会备案。</li>' +
      '<li><b>重要缺陷</b>：3 个月内完成整改，整改结果经验证后闭环销项。</li>' +
      '<li><b>一般缺陷</b>：纳入年度整改计划，按季度跟踪整改进度。</li>' +
      '<li><b>证据不足的控制点</b>：由责任部门补充执行证据后重新评价，补充前不视为控制有效。</li></ol></div>');

    // ⑤ 结论文字（大模型润色 or 内置）
    conclHtml.push('<div class="concl-section"><h3>五、评价意见</h3><div class="concl-note">' + esc(buildOpinion(r)) + '</div></div>');

    // ⑥ 数据与口径声明
    conclHtml.push('<div class="concl-section"><h3>六、数据与口径声明</h3><div class="concl-note">' +
      '被评价主体：' + esc(IC.C.ENTITY) + '；控制点 ' + r.stats.cpCount + ' 个（逐点评估，不抽样）；自评记录 ' + r.stats.selfCount +
      ' 条；缺陷记录 ' + r.stats.defectRecordCount + ' 条。判定与评分全部由内置规则引擎计算，同输入同输出（可复现）；' +
      '大模型（' + esc(LLM.describe().model) + '）仅参与判定依据等文字表述，不参与等级与评分。生成时间：' + esc(r.at) + '。</div></div>');

    body.innerHTML = conclHtml.join('');
    renderAlertCards(r);
  }

  function kvItem(k, v) {
    return '<div class="kv-item"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>';
  }

  function buildOpinion(r) {
    var s = r.score;
    if (r.opinionText) return r.opinionText;
    var parts = [];
    parts.push('经对' + IC.C.ENTITY + ' ' + r.stats.cpCount + ' 个内部控制点逐点评估（设计有效性与运行有效性双维度），' +
      '其中有效 ' + r.stats.validCount + ' 个、无效 ' + r.stats.invalidCount + ' 个、证据不足 ' + r.stats.insuffCount + ' 个，覆盖率 ' + r.stats.coverage + '%。');
    parts.push('失效控制点按根因合并后形成 ' + s.defectCount + ' 条缺陷，其中重大 ' + s.counts['重大'] + ' 条、重要 ' + s.counts['重要'] +
      ' 条、一般 ' + s.counts['一般'] + ' 条。');
    var majorD = r.defects.filter(function (d) { return d.level === '重大'; });
    if (majorD.length) {
      parts.push('存在重大缺陷（' + majorD.map(function (d) { return d.id; }).join('、') + '），按一票否决规则评价结论为「无效」');
    } else {
      parts.push('未发现重大缺陷，按风险矩阵加权得分为 ' + U.fix2(s.total) + '，评价结论为「' + s.verdict + '」');
    }
    var redlineNames = U.uniq(r.defects.reduce(function (a, d) { return a.concat(d.redlines); }, []));
    if (redlineNames.length) parts.push('其中命中定性红线' + redlineNames.length + '类（' + redlineNames.join('、') + '），已触发红色预警。');
    parts.push('公司应就上述缺陷制定整改方案并跟踪落实。');
    return parts.join('');
  }

  function renderAlertCards(r) {
    var wrap = $('#alertCardWrap');
    var majors = r.defects.filter(function (d) { return d.level === '重大'; });
    if (!majors.length) { wrap.hidden = true; $('#alertCards').innerHTML = ''; return; }
    wrap.hidden = false;
    $('#alertCards').innerHTML = majors.map(function (d) {
      var regText = (d.regs || []).length ? d.regs.map(function (g) { return g.law + ' ' + g.label; }).join('；') : '《企业内部控制评价指引》第十七条';
      return '<div class="alert-card">' +
        '<div class="alert-card-h"><span>⚠️</span><b>红色预警 · ' + esc(d.id) + ' · ' + esc(d.rootCauseTag) + '</b>' +
        '<span class="lvl">风险等级：' + esc(d.level) + '（R=' + d.R + '，' + esc(d.riskBand) + '风险）</span></div>' +
        '<div class="alert-card-b">' +
        alertRow('缺陷描述', esc(d.summary) + (d.quantLevel !== d.level ? '（定量等级为「' + esc(d.quantLevel) + '」，因命中定性红线升级为「重大」）' : '')) +
        alertRow('涉及控制点', d.cpIds.map(function (id) { return '<span class="chip-l">' + esc(id) + '</span>'; }).join('') + '（共 ' + d.cpCount + ' 个）') +
        alertRow('法规依据', esc(regText) + '<div class="tiny">' + (d.redlineDetail || []).map(function (rl) {
          return esc(rl.name) + '：' + esc(IC.KB.cite(rl.cite && IC.KB.getReg(rl.cite[0])));
        }).join('<br>') + '</div>') +
        alertRow('责任部门', esc(d.dept)) +
        alertRow('整改建议', esc(d.advice)) +
        alertRow('风险等级', '<b style="color:#C62828">' + esc(d.level) + '</b>（可能性 ' + d.possibility + ' × 影响程度 ' + d.impact + ' = 风险值 R ' + d.R + '，' + esc(d.riskBand) + '风险）') +
        '</div></div>';
    }).join('');
  }

  function alertRow(label, content) {
    return '<div class="alert-item"><span>' + esc(label) + '</span><div>' + content + '</div></div>';
  }

  /* ==========================================================================
   * 导出
   * ====================================================================== */
  function bindExport() {
    $$('[data-export]').forEach(function (btn) {
      on(btn, 'click', function () { doExport(btn.getAttribute('data-export')); });
    });
    on($('#btnSideDownload'), 'click', function () { doExport('all-csv'); });
    on($('#btnSidePrint'), 'click', function () { doExport('conclusion-pdf'); });
  }

  function exportCtx() {
    var r = currentResult();
    return {
      entity: IC.C.ENTITY,
      period: (S.materials.controls.length ? '2025 年度' : '—'),
      evaluator: IC.C.EVALUATOR,
      at: r ? r.at : U.nowStamp()
    };
  }

  function doExport(kind) {
    var r = currentResult();
    if (!r) { toast('请先完成逐点评估再导出成果', 'warn'); return; }
    var ctx = exportCtx();
    var ds = EX.buildDatasets(r, ctx);
    var stamp = U.dateOnly();
    var ok = false;
    switch (kind) {
      case 'eval-csv': ok = EX.downloadCSV({ title: '华诚集团控制点有效性评估表（' + r.points.length + ' 行）', head: ds.eval.head, rows: ds.eval.rows }, '①控制点有效性评估表_' + stamp); break;
      case 'eval-xlsx': ok = EX.downloadWorkbook({ eval: ds.eval }, '①控制点有效性评估表_' + stamp); break;
      case 'eval-pdf': ok = EX.printEval(r, ds); break;
      case 'defect-csv': ok = EX.downloadCSV({ title: '华诚集团内控缺陷分类清单（合并后 ' + r.defects.length + ' 条）', head: ds.defect.head, rows: ds.defect.rows }, '②缺陷分类清单_' + stamp); break;
      case 'defect-xlsx': ok = EX.downloadWorkbook({ defect: ds.defect }, '②缺陷分类清单_' + stamp); break;
      case 'defect-pdf': ok = EX.printDefect(r, ds); break;
      case 'score-csv':
        ok = EX.downloadCSV({ title: '华诚集团加权风险评分明细', head: ds.score.head, rows: ds.score.rows });
        break;
      case 'score-xlsx': ok = EX.downloadWorkbook({ score: ds.score, scoreDefect: ds.scoreDefect }, '③加权风险评分明细_' + stamp); break;
      case 'score-pdf': ok = EX.printScore(r, ds); break;
      case 'conclusion-csv': ok = EX.downloadCSV({ title: '华诚集团内部控制评价结论', head: ds.conclusion.head, rows: ds.conclusion.rows }, '④内控评价结论_' + stamp); break;
      case 'conclusion-pdf': ok = EX.printConclusion(r, ctx); break;
      case 'alert-pdf': ok = EX.printAlert(r, ctx); break;
      case 'all-csv': ok = EX.downloadAll(r, ctx); break;
      default: break;
    }
    if (kind !== 'all-csv') {
      LLM.log({ type: 'export', action: '导出 ' + kind, input: '结果 ' + r.at, output: ok ? '成功' : '失败', expected: ok });
    }
    if (!ok) toast('导出失败：当前浏览器可能限制了下载或弹窗，请允许后重试', 'bad', 4000);
    else if (kind !== 'all-csv') toast(kind.indexOf('pdf') >= 0 ? '已打开打印视图，请在打印对话框中选择「另存为 PDF」' : '已开始下载', 'ok');
  }

  /* ==========================================================================
   * 大模型 API 设置
   * ====================================================================== */
  function fillApiForm() {
    var c = LLM.getConfig();
    $('#api-provider').value = c.provider;
    $('#api-model').value = c.model;
    $('#api-key').value = c.apiKey;
    $('#api-base').value = c.baseUrl;
    $('#api-temp').value = c.temperature;
    refreshApiCurrent();
    $('#apiTestResult').className = 'test-result';
    $('#apiTestResult').textContent = '';
  }

  function refreshApiCurrent() {
    var d = LLM.describe();
    $('#apiCurrent').innerHTML = '当前生效配置：服务商 <b>' + esc(d.provider) + '</b>　模型 <b>' + esc(d.model) + '</b>' +
      '<br>API Key：<b>' + esc(d.maskedKey) + '</b>' + (d.isTeaching ? '（教学测试密钥）' : '（自定义密钥）') +
      '<br>Base URL：<b>' + esc(d.baseUrl) + '</b>　temperature 固定 0.1';
  }

  function bindApi() {
    $$('[data-close]').forEach(function (el) {
      on(el, 'click', function () { closeModal(el.getAttribute('data-close')); });
    });
    on($('#btnToggleKey'), 'click', function () {
      var inp = $('#api-key');
      inp.type = inp.type === 'password' ? 'text' : 'password';
      this.textContent = inp.type === 'password' ? '显示' : '隐藏';
    });
    on($('#btnApiSave'), 'click', function () {
      var cfg = LLM.saveConfig(readApiForm());
      fillApiForm();
      refreshApiCurrent();
      updateApiBadge();
      toast('配置已保存并立即生效', 'ok');
      LLM.log({ type: 'llm', action: '保存大模型配置', input: cfg.provider + ' / ' + cfg.model + ' / ' + U.maskKey(cfg.apiKey) + ' / ' + cfg.baseUrl, output: '已写入 localStorage', expected: true });
    });
    on($('#btnApiTest'), 'click', function () {
      var btn = this;
      var res = $('#apiTestResult');
      btn.disabled = true;
      res.className = 'test-result loading';
      res.textContent = '正在测试连接…';
      var form = readApiForm();
      LLM.saveConfig(form);
      refreshApiCurrent();
      LLM.testConnection().then(function (r) {
        btn.disabled = false;
        res.className = 'test-result ' + (r.ok ? 'ok' : 'bad');
        res.textContent = r.ok ? '✅ ' + r.message + ' 配置已保存并生效。' : '❌ 连接失败：' + r.message + '。已保留规则引擎模式，结论与评分不受影响。';
        updateApiBadge();
      });
    });
    on($('#btnNoticeNever'), 'click', function () {
      var n = IC.LS.get(IC.C.LS.notice, {});
      n.never = true;
      IC.LS.set(IC.C.LS.notice, n);
      closeModal('modalKeyNotice');
    });
    on($('#btnNoticeGotoApi'), 'click', function () {
      closeModal('modalKeyNotice');
      fillApiForm();
      openModal('modalApi');
    });
  }

  function readApiForm() {
    return {
      provider: $('#api-provider').value,
      model: $('#api-model').value,
      apiKey: $('#api-key').value,
      baseUrl: $('#api-base').value,
      temperature: 0.1
    };
  }

  function updateApiBadge() {
    updateLlmBadge();
  }

  /* ==========================================================================
   * 通用弹层（说明 / 日志 / 历史）
   * ====================================================================== */
  function bindGeneralModal() {
    on($('#btnGeneralCopy'), 'click', function () {
      var text = $('#modalGeneralBody').innerText || '';
      copyText(text);
    });
  }

  function copyText(text) {
    var ta = doc.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    doc.body.appendChild(ta);
    ta.select();
    try { doc.execCommand('copy'); toast('已复制到剪贴板', 'ok'); }
    catch (e) { toast('复制失败，请手动选择文本', 'warn'); }
    doc.body.removeChild(ta);
  }

  function showGeneral(title, bodyHtml) {
    $('#modalGeneralTitle').textContent = title;
    $('#modalGeneralBody').innerHTML = bodyHtml;
    openModal('modalGeneral');
  }

  function showHelp() {
    var bodyHtml = [
      '<div class="notice-line"><b>使用步骤（三步）</b></div>',
      '<ol style="font-size:13px;line-height:2;padding-left:20px;margin:0 0 12px">',
      '<li><b>导入材料</b>：上传三份材料（控制点清单 / 内控自评表 / 缺陷记录表），支持 Excel、CSV、粘贴文本、逐条填表单。可点「载入示例材料」先用演示数据跑通。</li>',
      '<li><b>逐点评估</b>：点击「▶ 开始逐点评估」，系统按 checklist 对每个控制点判断设计有效性与运行有效性，实时显示「已评估 X / 120」。</li>',
      '<li><b>出具结论</b>：自动完成缺陷识别与三级分类、根因合并、风险矩阵加权评分、一票否决结论；有重大缺陷时出现红色横幅与预警卡；四份成果可分别或一键下载。</li>',
      '</ol>',
      '<div class="notice-line"><b>判定口径</b></div>',
      '<ul style="font-size:12.5px;line-height:1.9;padding-left:20px;margin:0 0 12px">',
      '<li>设计有效性：有明确控制措施 / 有责任人和频率 / 覆盖关键风险点 / 留有可核查痕迹（4 项全满足=有效）</li>',
      '<li>运行有效性：按期执行 / 有执行证据 / 偏差未出现或已整改（3 项全满足=有效）</li>',
      '<li>缺陷双标准：定量金额阈值（一般 &lt; 100 万，重要 100–500 万，重大 ≥ 500 万）与定性红线取较高等级，定性红线命中即重大</li>',
      '<li>根因合并：同一「根因标签 + 责任部门 + 流程」的失效控制点合并为一条缺陷，保留关联控制点编号与合并前数量</li>',
      '<li>评分：总分 = 100×Σ(控制点权重×有效性得分)/Σ(控制点权重) − Σ(缺陷权重×风险值)÷缺陷条数×2</li>',
      '<li>结论：存在任意 1 条重大缺陷即一票否决判「无效」；否则 ≥80 有效、60–79 基本有效、&lt;60 无效</li>',
      '</ul>',
      '<div class="notice-line"><b>数据与安全</b></div>',
      '<div class="notice-line tiny">所有材料仅保存在浏览器内存与本地存储，不上传到除大模型 API 之外的任何服务器。大模型仅用于生成判定依据等文字表述，等级判定与评分一律由内置规则引擎计算，可复现。大模型调用失败时自动降级为纯规则模式，结论与评分不受影响。</div>'
    ].join('');
    showGeneral('使用说明', bodyHtml);
  }

  function showLogs() {
    var logs = LLM.getLogs();
    var rows = logs.slice().reverse().map(function (e) {
      return '<tr><td class="mono">' + esc(e.at) + '</td><td>' + esc(e.type) + '</td><td>' + esc(e.action) +
        '</td><td class="reason">' + esc(e.input) + '</td><td class="reason">' + esc(e.output) + '</td><td>' + esc(e.expected) +
        '</td><td class="tiny">' + esc(e.extra) + '</td></tr>';
    }).join('');
    var logHtml = '<div class="row row-tight" style="margin:0 0 10px">' +
      '<button type="button" class="btn btn-ghost btn-sm" id="btnLogDownload">下载 useractivity.log</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="btnLogClear">清空日志</button>' +
      '<span class="tiny">共 ' + logs.length + ' 条操作记录（最近 500 条）</span></div>' +
      '<div class="table-wrap" style="max-height:56vh"><table class="grid compact"><thead><tr><th>时间</th><th>类型</th><th>动作</th><th>输入摘要</th><th>输出摘要</th><th>达成预期</th><th>备注</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="7">暂无日志</td></tr>') + '</tbody></table></div>';
    showGeneral('操作日志（useractivity.log）', logHtml);
    on($('#btnLogDownload'), 'click', function () {
      U.download('useractivity.log', LLM.buildLogText(), 'text/plain;charset=utf-8');
      toast('已下载 useractivity.log', 'ok');
    });
    on($('#btnLogClear'), 'click', function () {
      LLM.clearLogs();
      closeModal('modalGeneral');
      toast('日志已清空', 'ok');
    });
  }

  function showHistory() {
    var hist = IC.LS.get(IC.C.LS.history, []);
    if (!Array.isArray(hist) || !hist.length) {
      showGeneral('历史评估记录', '<div class="empty-state">暂无历史记录。每次评估完成后会自动保存一份结果摘要（记住历史评估记录，方便对比）。</div>');
      return;
    }
    var rows = hist.map(function (h) {
      var s = h.snapshot || {};
      return '<tr><td class="mono">' + esc(h.at) + '</td><td>' + esc(h.period || '—') + '</td>' +
        '<td>' + vbadge(s.verdict || '—') + '</td><td class="num">' + esc(s.total) + '</td>' +
        '<td>' + esc(s.cpCount) + ' / ' + esc(s.coverage) + '%</td>' +
        '<td>' + esc(s.major) + ' / ' + esc(s.important) + ' / ' + esc(s.general) + '</td>' +
        '<td class="tiny">' + esc(s.params || '') + '</td></tr>';
    }).join('');
    var histHtml = '<div class="table-wrap" style="max-height:56vh"><table class="grid compact"><thead><tr>' +
      '<th>评估时间</th><th>期间</th><th>结论</th><th>总分</th><th>控制点 / 覆盖率</th><th>重大/重要/一般</th><th>参数摘要</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>' +
      '<div class="notice-line tiny" style="margin-top:10px">历史记录只保存结论摘要（结论、总分、缺陷计数与关键参数），不保存材料原文；如两期结论不同，可对比总分与缺陷构成变化。</div>' +
      '<div class="row row-tight"><button type="button" class="btn btn-ghost btn-sm" id="btnHistClear">清空历史记录</button></div>';
    showGeneral('历史评估记录（共 ' + hist.length + ' 次）', histHtml);
    on($('#btnHistClear'), 'click', function () {
      IC.LS.del(IC.C.LS.history);
      closeModal('modalGeneral');
      toast('历史记录已清空', 'ok');
    });
  }

  function saveHistory(result, elapsed) {
    var arr = IC.LS.get(IC.C.LS.history, []);
    if (!Array.isArray(arr)) arr = [];
    arr.unshift({
      at: result.at,
      elapsed: elapsed,
      period: '2025 年度',
      snapshot: {
        verdict: result.score.verdict,
        total: U.fix2(result.score.total),
        weighted: U.fix2(result.score.weightedScore),
        deduct: U.fix2(result.score.deduct),
        cpCount: result.stats.cpCount,
        coverage: result.stats.coverage,
        major: result.score.counts['重大'],
        important: result.score.counts['重要'],
        general: result.score.counts['一般'],
        params: '重大≥' + S.params.majorAmount + '万；权重 ' + S.params.weightGeneral + '/' + S.params.weightImportant + '/' + S.params.weightMajor
      }
    });
    if (arr.length > 20) arr = arr.slice(0, 20);
    IC.LS.set(IC.C.LS.history, arr);
  }

  /* ==========================================================================
   * 内嵌测试示例
   * ====================================================================== */
  function bindTestModule() {
    on($('#btnTestLoad'), 'click', loadTestData);
    on($('#btnTestRun'), 'click', function () { runTest(); });
    on($('#btnTestBack'), 'click', function () {
      if (S.testState.preMat) {
        S.materials = U.clone(S.testState.preMat);
        S.result = S.testState.preResult;
        S.llmResult = null;
        S.testState.preMat = null;
        renderAllIfResult();
        toast('已恢复测试前的材料与结果', 'ok');
      }
      showView('import');
    });
  }

  function renderTestExpected() {
    var t = IC.TEST_DATA;
    // 三张数据表
    var tb = $('#tblTestCp tbody');
    if (tb) tb.innerHTML = t.controls.map(function (c) {
      return '<tr><td class="mono">' + esc(c.id) + '</td><td>' + esc(c.name) + '</td><td>' + esc(c.flow) + '</td>' +
        '<td class="' + riskCls(c.risk) + '">' + esc(c.risk) + '</td><td>' + esc(c.dept) + '</td><td>' + esc(c.method) + '</td><td>' + esc(c.freq) + '</td></tr>';
    }).join('');
    var tb2 = $('#tblTestSa tbody');
    if (tb2) tb2.innerHTML = t.selfassessment.map(function (s) {
      return '<tr' + (s.concl === '无效' ? ' class="row-invalid"' : '') + '><td class="mono">' + esc(s.cpId) + '</td>' +
        '<td>' + vbadge(s.concl) + '</td><td class="reason">' + esc(s.evidence) + '</td><td class="reason">' + esc(s.deviation) + '</td></tr>';
    }).join('');
    var tb3 = $('#tblTestDf tbody');
    if (tb3) tb3.innerHTML = t.defects.map(function (d) {
      return '<tr><td class="reason">' + esc(d.desc) + '</td><td>' + esc(d.cps) + '</td><td class="num">' + d.amount + '</td>' +
        '<td class="num">' + d.times + '</td><td>' + esc(d.source) + '</td><td>' + (d.redline ? '<span class="vb vb-major">' + esc(d.redline) + '</span>' : '无') + '</td></tr>';
    }).join('');
    $('#testExpected').textContent = t.expected;
  }

  function loadTestData() {
    if (!S.testState.preMat) {
      S.testState.preMat = { controls: U.clone(S.materials.controls), selfassessment: U.clone(S.materials.selfassessment), defects: U.clone(S.materials.defects) };
      S.testState.preResult = S.result;
    }
    var t = IC.TEST_DATA;
    S.materials.controls = t.controls.map(function (c) { return U.clone(c); });
    S.materials.selfassessment = t.selfassessment.map(function (c) { return U.clone(c); });
    S.materials.defects = t.defects.map(function (c) {
      var o = U.clone(c);
      o.cps = U.splitIds(c.cps);
      return o;
    });
    var ctx = matCtx();
    MAT_KEYS.forEach(function (k) {
      S.validation[k] = IC.validateMaterials(k, S.materials[k], k === 'controls' ? {} : ctx);
      renderMaterialCard(k);
      renderIssues(k);
    });
    $('#ta-controls').value = rowsToText(S.materials.controls, 'controls');
    $('#ta-selfassessment').value = rowsToText(S.materials.selfassessment, 'selfassessment');
    $('#ta-defects').value = rowsToText(S.materials.defects, 'defects');
    $('#chkAllowPartial').checked = true;  // 12 个控制点，测试场景允许部分评估
    renderLedger();
    updateStepNav();
    S.testState.loaded = true;
    $('#testRunState').textContent = '已加载测试数据';
    toast('已加载 12 个控制点的测试数据，可点「▶ 一键运行测试」', 'ok', 3200);
    LLM.log({ type: 'test', action: '加载内嵌测试数据', input: '12 个控制点测试集', output: '已填入三份材料', expected: true });
  }

  function runTest() {
    if (!S.testState.loaded) loadTestData();
    // 测试必须使用默认参数，保证与固定预期一致
    S.params = U.clone(IC.DEFAULT_PARAMS);
    fillParamInputs();
    renderParamsWarnings();
    S.llmResult = null;
    S.testState.ran = true;
    $('#testProgressWrap').hidden = false;
    $('#testProgressLabel').textContent = '已评估 0 / 12';
    $('#testProgressPct').textContent = '0%';
    $('#testProgressFill').style.width = '0%';
    $('#testRunState').textContent = '运行中…';
    $('#testSummary').innerHTML = '';
    $('#testActual').textContent = '评估中…';
    // 进度动画
    var n = 0;
    var tm = global.setInterval(function () {
      n++;
      var pct = Math.round(n * 100 / 12);
      $('#testProgressLabel').textContent = '已评估 ' + Math.min(n, 12) + ' / 12';
      $('#testProgressPct').textContent = pct + '%';
      $('#testProgressFill').style.width = pct + '%';
      if (n >= 12) global.clearInterval(tm);
    }, 40);
    global.setTimeout(function () {
      runEvaluation(true);
    }, 120);
  }

  function renderTestActual(result) {
    var t = IC.TEST_DATA;
    $('#testProgressWrap').hidden = true;
    $('#testRunState').textContent = '已完成 · ' + result.at;
    // 实际结果文本（与预期文本同构，便于逐行比对）
    var actual = [];
    var s = result.score;
    var defects = result.defects;
    actual.push('【预期控制点评估】' + result.stats.cpCount + ' 个全部评估｜有效 ' + result.stats.validCount +
      '｜无效 ' + result.stats.invalidCount + '｜证据不足 ' + result.stats.insuffCount);
    var mergeText = defects.length === 3
      ? '（根因 3 个不同，不合并，缺陷记录表已挂接）'
      : '（合并后 ' + defects.length + ' 条）';
    actual.push('【缺陷合并】' + (defects.map(function (d) { return d.cpIds.join('+'); }).join('、')) + ' → 输出 ' + defects.length + ' 条缺陷' + mergeText);
    actual.push('【缺陷分类】');
    defects.forEach(function (d) {
      actual.push('  ' + d.id + ' ' + d.cpIds.join('+') + ' ' + U.oneLine(d.summary).slice(0, 22) + '：定量=' + d.quantLevel +
        '(' + U.fix2(d.amount) + '万)｜定性红线=' + (d.redlines.length ? d.redlines.join('、') : '无') + ' → 最终=' + d.level);
    });
    actual.push('【加权评分】控制点加权得分 ' + U.fix2(s.weightedScore) + '｜缺陷扣分 -' + U.fix2(s.deduct) + '｜总分 ' + U.fix2(s.total));
    actual.push('【结论】' + (s.veto
      ? '一票否决：存在 ' + s.majorIds.length + ' 项重大缺陷（' + s.majorIds.map(function (id) {
        var d = defects.filter(function (x) { return x.id === id; })[0];
        return id + ' ' + (d ? U.oneLine(d.summary).slice(0, 12) : '');
      }).join('、') + '）→ 结论=' + s.verdict
      : '无重大缺陷 → 结论=' + s.verdict));
    actual.push('【红色预警】' + (s.veto ? '⚠️ 检测到 ' + s.counts['重大'] + ' 项重大缺陷，触发红色预警' : '未触发'));
    $('#testActual').textContent = actual.join('\n');

    // 逐项校验
    var checks = [];
    checks.push({
      name: '控制点评估',
      pass: result.stats.cpCount === 12 && result.stats.validCount === 9 && result.stats.invalidCount === 3 && result.stats.insuffCount === 0,
      detail: '预期 12 个 / 有效 9 / 无效 3 / 证据不足 0；实际 ' + result.stats.cpCount + ' / ' + result.stats.validCount + ' / ' + result.stats.invalidCount + ' / ' + result.stats.insuffCount
    });
    var byCp = {};
    defects.forEach(function (d) { d.cpIds.forEach(function (id) { byCp[id] = d; }); });
    // 注意：控制点编号经规范化后统一为 3 位（C-003），判定时用 U.normCpId 生成键
    var ID3 = U.normCpId('C-03'), ID4 = U.normCpId('C-04'), ID10 = U.normCpId('C-10');
    var expectDefect = {};
    expectDefect[ID3] = '重要';
    expectDefect[ID4] = '重大';
    expectDefect[ID10] = '一般';
    var levelOk = Object.keys(expectDefect).every(function (id) { return byCp[id] && byCp[id].level === expectDefect[id]; });
    checks.push({
      name: '缺陷分类',
      pass: levelOk,
      detail: '预期 C-03=重要(260万)、C-04=重大(红线·不相容职务未分离)、C-10=一般(0万)；实际 ' +
        Object.keys(expectDefect).map(function (id) { return id + '=' + (byCp[id] ? byCp[id].level : '缺失'); }).join('、')
    });
    var redlineOk = !!(byCp[ID4] && byCp[ID4].redlines.join('').indexOf('不相容') >= 0);
    checks.push({
      name: '定性红线（金额不大但性质严重）',
      pass: redlineOk,
      detail: '预期 C-04 命中「不相容职务未分离」直接判重大；实际 ' + (byCp[ID4] ? (byCp[ID4].redlines.join('、') || '无') : '缺失')
    });
    var mergeOk = defects.length === 3 && !!(byCp[ID3] && byCp[ID4] && byCp[ID10]);
    checks.push({
      name: '根因合并规则',
      pass: mergeOk,
      detail: '预期 3 个不同根因不合并、输出 3 条缺陷；实际输出 ' + defects.length + ' 条'
    });
    var scoreOk = U.fix2(s.weightedScore) === '85.19' && U.fix2(s.deduct) === '181.33' && U.fix2(s.total) === '-96.14';
    checks.push({
      name: '加权评分（风险矩阵）',
      pass: scoreOk,
      detail: '预期 85.19 / -181.33 / -96.14；实际 ' + U.fix2(s.weightedScore) + ' / -' + U.fix2(s.deduct) + ' / ' + U.fix2(s.total) +
        (scoreOk ? '' : '（缺陷扣分口径：Σ(权重×R)÷条数×2）')
    });
    checks.push({
      name: '一票否决',
      pass: s.veto && s.verdict === '无效',
      detail: '预期存在 1 项重大缺陷 → 结论=无效；实际 ' + (s.veto ? '一票否决，结论=' + s.verdict : '未触发，结论=' + s.verdict)
    });
    checks.push({
      name: '红色预警',
      pass: s.counts['重大'] === 1,
      detail: '预期 ⚠️ 检测到 1 项重大缺陷，触发红色预警；实际 ' + s.counts['重大'] + ' 项'
    });
    // 可复现：同输入再算一次比对
    var again = IC.runAll({ controls: S.materials.controls, selfassessment: S.materials.selfassessment, defects: S.materials.defects }, U.clone(IC.DEFAULT_PARAMS), {});
    var repro = U.fix2(again.score.total) === U.fix2(s.total) && again.score.verdict === s.verdict &&
      JSON.stringify(again.defects.map(function (d) { return [d.id, d.level, d.R]; })) === JSON.stringify(defects.map(function (d) { return [d.id, d.level, d.R]; }));
    checks.push({ name: '可复现性（同输入两次运行）', pass: repro, detail: repro ? '两次运行结果完全一致' : '两次运行结果不一致，请检查参数是否被修改' });

    var passAll = checks.every(function (c) { return c.pass; });
    $('#testSummary').innerHTML = checks.map(function (c) {
      return '<div class="check-line ' + (c.pass ? 'pass' : 'fail') + '">' +
        '<span class="ck">' + (c.pass ? '✅' : '❌') + '</span>' +
        '<span><span class="ck-name">' + esc(c.name) + '</span><br><span class="ck-detail">' + esc(c.detail) + '</span></span></div>';
    }).join('') +
      '<div class="check-line ' + (passAll ? 'pass' : 'fail') + '"><span class="ck">' + (passAll ? '✅' : '❌') + '</span>' +
      '<span><span class="ck-name">总体结论</span><br><span class="ck-detail">' +
      (passAll ? '7 项检查全部通过，逐点评估、缺陷分类、加权评分、一票否决与红色预警均正常工作。' : '存在未通过的检查项，请查看上方明细。') +
      '</span></span></div>';
    LLM.log({
      type: 'test',
      action: '一键运行内嵌测试',
      input: '12 个控制点测试集（默认参数）',
      output: checks.map(function (c) { return c.name + ':' + (c.pass ? '通过' : '未通过'); }).join('；'),
      expected: passAll
    });
  }

  function renderAllIfResult() {
    if (S.result) {
      renderAll(S.result);
      updateStepNav();
    } else {
      renderSideCard();
      renderAlertBanner();
      renderPending();
      updateStepNav();
    }
  }

  /* 启动 */
  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', function () { UI.init(); });
  } else {
    UI.init();
  }

})(typeof window !== 'undefined' ? window : this);
