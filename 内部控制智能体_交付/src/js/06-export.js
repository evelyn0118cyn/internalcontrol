/* =============================================================================
 * 06-export.js — 成果导出
 *   · 成果数据集：控制点评估表 / 缺陷分类清单 / 加权评分明细 / 评价结论
 *   · CSV（带 BOM，Excel 直接打开不乱码）
 *   · Excel（SheetJS 多工作表，一个文件四份成果）
 *   · 打印 / 保存为 PDF（独立打印文档，A4 横向，排版与页面一致）
 *   · 一键下载全部成果（ZIP，内置 ZIP 打包器，图片用无压缩 deflate stored 方式）
 * 所有导出内容由同一份结果对象生成，保证「页面上看到的」与「导出的」完全一致。
 * ========================================================================== */
(function (global) {
  'use strict';
  var IC = global.IC;
  var U = IC.U;

  var EX = IC.EXPORT = {};
  var FILE_PREFIX = '华诚集团内控评价_';

  /* ==========================================================================
   * 一、成果数据集（四份成果统一结构）
   * ====================================================================== */
  EX.buildDatasets = function (result, ctx) {
    ctx = ctx || {};
    var evals = result.points.map(function (p) {
      return [
        p.id, p.name, p.flow, p.risk, p.dept,
        p.designResult, p.operatingResult, p.conclusion,
        p.reason, p.defectIds.join('、') || '—'
      ];
    });
    var defects = result.defects.map(function (d) {
      return [
        d.id, d.summary, d.cpCount, d.cpIds.join('、'), d.nature,
        d.quantLevel + '（' + U.fix2(d.amount) + ' 万元）',
        d.redlines.length ? d.redlines.join('；') : '无',
        d.level, d.dept, d.advice
      ];
    });
    var scoreCp = result.score.cpRows.map(function (r) {
      return [
        r.id, r.name, r.risk, r.weight, r.design, r.operating,
        U.fix2(r.score), U.fix2(r.weighted), r.counted ? '计入分母' : '不计入'
      ];
    });
    var scoreDf = result.defects.map(function (d) {
      return [
        d.id, d.summary, d.level, d.weight, d.possibility, d.impact,
        d.R, U.fix2(d.weight * d.R), d.riskBand
      ];
    });
    var s = result.score;
    var concl = [
      ['评价结论', s.verdict],
      ['是否触发一票否决', s.veto ? '是（存在 ' + s.majorIds.length + ' 项重大缺陷：' + s.majorIds.join('、') + '）' : '否'],
      ['加权总分', U.fix2(s.total) + '（结论以定性判定为准）'],
      ['加权得分', U.fix2(s.weightedScore)],
      ['缺陷扣分', '-' + U.fix2(s.deduct)],
      ['覆盖率', result.stats.coverage + '%（' + result.stats.cpCount + ' / ' + result.stats.standard + ' 个控制点）'],
      ['控制点判定', '有效 ' + result.stats.validCount + ' / 无效 ' + result.stats.invalidCount + ' / 证据不足 ' + result.stats.insuffCount],
      ['缺陷构成', '重大 ' + s.counts['重大'] + ' 项 / 重要 ' + s.counts['重要'] + ' 项 / 一般 ' + s.counts['一般'] + ' 项（合并后共 ' + s.defectCount + ' 条）'],
      ['评价期间', ctx.period || '—'],
      ['被评价主体', ctx.entity || IC.C.ENTITY],
      ['评价人', ctx.evaluator || IC.C.EVALUATOR],
      ['评分口径', '总分 = 100×Σ(控制点权重×有效性得分)/Σ(控制点权重) − Σ(缺陷权重×风险值)÷缺陷条数×2；缺陷权重 一般1/重要3/重大8；控制点权重 高3/中2/低1'],
      ['生成时间', result.at]
    ];

    return {
      eval: { name: '控制点有效性评估表', sheet: '控制点有效性评估表', head: ['控制点编号', '控制点名称', '所属流程', '风险等级', '责任部门', '设计有效性', '运行有效性', '综合判定', '判定依据', '关联缺陷'], rows: evals },
      defect: { name: '缺陷分类清单', sheet: '缺陷分类清单', head: ['缺陷编号', '根因摘要', '涉及控制点数', '关联控制点', '设计/运行', '定量等级', '定性红线', '最终等级', '责任部门', '整改建议'], rows: defects },
      score: { name: '加权风险评分明细', sheet: '评分明细', head: ['控制点编号', '控制点名称', '风险等级', '控制点权重', '设计有效性', '运行有效性', '有效性得分', '加权分', '计入说明'], rows: scoreCp },
      scoreDefect: { name: '缺陷扣分明细', sheet: '缺陷扣分明细', head: ['缺陷编号', '根因摘要', '最终等级', '缺陷权重', '可能性', '影响程度', '风险值R', '权重×R', '风险区间'], rows: scoreDf },
      conclusion: { name: '内控评价结论', sheet: '评价结论', head: ['项目', '内容'], rows: concl },
      meta: { entity: ctx.entity || IC.C.ENTITY, period: ctx.period || '', evaluator: ctx.evaluator || IC.C.EVALUATOR, at: result.at }
    };
  };

  /* ==========================================================================
   * 二、CSV
   * ====================================================================== */
  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  EX.toCSV = function (ds) {
    var lines = [];
    if (ds.title) lines.push(csvCell(ds.title));
    if (ds.head) lines.push(ds.head.map(csvCell).join(','));
    (ds.rows || []).forEach(function (r) { lines.push(r.map(csvCell).join(',')); });
    return '\ufeff' + lines.join('\r\n');
  };

  EX.downloadCSV = function (ds, filename) {
    var csv = EX.toCSV(ds);
    return U.download(filename + '.csv', csv, 'text/csv;charset=utf-8');
  };

  /* ==========================================================================
   * 三、Excel（SheetJS）
   * ====================================================================== */
  EX.buildWorkbook = function (datasets) {
    if (!IC.env.hasXLSX()) throw new Error('Excel 导出组件（SheetJS）未加载，请改用 CSV 导出');
    var XLSX = global.XLSX;
    var wb = XLSX.utils.book_new();
    var order = ['eval', 'defect', 'score', 'scoreDefect', 'conclusion'];
    order.forEach(function (k) {
      var ds = datasets[k];
      if (!ds) return;
      var aoa = [];
      if (k === 'conclusion') {
        aoa.push(['华诚集团内部控制评价结论']);
        aoa.push([]);
        aoa = aoa.concat(ds.rows);
      } else {
        aoa.push([ds.name]);
        aoa.push(ds.head);
        aoa = aoa.concat(ds.rows);
      }
      var ws = XLSX.utils.aoa_to_sheet(aoa);
      // 列宽
      var widths = (ds.head || ['A', 'B']).map(function (h, i) {
        var maxLen = String(h).length * 2;
        (ds.rows || []).slice(0, 200).forEach(function (r) {
          var len = String(r[i] === undefined ? '' : r[i]).length;
          if (len > maxLen) maxLen = len;
        });
        return { wch: Math.min(46, Math.max(10, maxLen + 2)) };
      });
      ws['!cols'] = widths;
      ws['!merges'] = k === 'conclusion' ? [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }] : [{ s: { r: 0, c: 0 }, e: { r: 0, c: (ds.head.length - 1) } }];
      XLSX.utils.book_append_sheet(wb, ws, ds.sheet.slice(0, 31));
    });
    return wb;
  };

  EX.downloadWorkbook = function (datasets, filename) {
    try {
      var wb = EX.buildWorkbook(datasets);
      var out = global.XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
      return U.download(filename + '.xlsx', new global.Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    } catch (e) {
      return false;
    }
  };

  /* ==========================================================================
   * 四、打印 / 保存为 PDF
   * ====================================================================== */
  /**
   * 打开独立打印视图（浏览器「打印 → 另存为 PDF」即得 PDF，无需额外库）
   * @param {string} title 文档标题
   * @param {string} htmlBody 正文 HTML
   */
  EX.printDocument = function (title, htmlBody, opts) {
    var o = opts || {};
    var win = global.open('', '_blank');
    if (!win) {
      // 弹窗被拦截：降级为当前页面打印
      EX.printCurrentPage(title);
      return false;
    }
    var styleText = [
      '@page{size:A4 ' + (o.landscape === false ? 'portrait' : 'landscape') + ';margin:10mm}',
      'body{font-family:"Microsoft YaHei","PingFang SC",sans-serif;color:#1F2A3A;margin:0;font-size:10.5px;line-height:1.6}',
      'h1{font-size:16px;color:#1B3A6B;margin:0 0 2px}',
      '.doc-h{border-bottom:2px solid #1B3A6B;padding-bottom:6px;margin-bottom:10px}',
      '.doc-meta{font-size:9.5px;color:#5A6B82}',
      'h2{font-size:12.5px;color:#1B3A6B;margin:14px 0 6px;border-left:3px solid #2E6BE6;padding-left:7px}',
      'table{width:100%;border-collapse:collapse;font-size:9.5px;margin-bottom:8px}',
      'th{background:#EEF3FA;color:#1B3A6B;text-align:left;padding:4px 6px;border:1px solid #D6E0EC;font-weight:700}',
      'td{padding:4px 6px;border:1px solid #E3E8EF;vertical-align:top}',
      'tr{page-break-inside:avoid}',
      '.vb{display:inline-block;padding:0 6px;border-radius:3px;font-size:9px;font-weight:700}',
      '.vb-ok{background:#E6F6EC;color:#1F9D55}.vb-bad{background:#FDECEC;color:#C62828}.vb-ins{background:#FFF4E2;color:#C77700}',
      '.vb-major{background:#C62828;color:#fff}.vb-important{background:#F59E0B;color:#fff}.vb-general{background:#7C8DB5;color:#fff}',
      '.verdict{font-size:15px;font-weight:800;padding:8px 12px;border-radius:5px;margin:6px 0 10px}',
      '.verdict.invalid{background:#FDECEC;color:#C62828;border:1px solid #F2C4C4}',
      '.verdict.valid{background:#E6F6EC;color:#1F9D55;border:1px solid #BFE5CC}',
      '.verdict.basic{background:#FFF4E2;color:#C77700;border:1px solid #F3DDB8}',
      '.kv{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:10px;margin-bottom:10px}',
      '.kv div{min-width:120px}.kv span{color:#5A6B82}',
      '.note{background:#EEF3EA;border:1px solid #D8E4F5;border-radius:4px;padding:6px 9px;font-size:9.5px;color:#5A6B82;margin-bottom:8px}',
      '.alert{border:2px solid #C62828;border-radius:6px;margin:8px 0;overflow:hidden}',
      '.alert-h{background:#C62828;color:#fff;padding:5px 10px;font-weight:700;font-size:11px}',
      '.alert-r{display:flex;border-top:1px solid #F3E3E3;font-size:10px}',
      '.alert-r span{width:110px;background:#FFF6F6;color:#9B2C2C;font-weight:700;padding:4px 8px;flex:none}',
      '.alert-r div{padding:4px 8px}',
      'ol,ul{margin:4px 0 8px;padding-left:20px;font-size:10px}',
      '.foot{margin-top:14px;border-top:1px dashed #C7D2E0;padding-top:6px;font-size:9px;color:#8A98AC}',
      '@media print{.pb{page-break-before:always}}'
    ].join('\n');
    win.document.open();
    win.document.write('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + U.esc(title) +
      '</title><style>' + styleText + '</style></head><body>' + htmlBody +
      '<div class="foot">本文件由「华诚集团内部控制评价智能体」生成 · ' + U.esc(U.nowStamp()) +
      ' · 判定与评分由内置规则引擎计算，同输入同输出；内部制度条款以集团正式文本为准，请核对。</div>' +
      '</body></html>');
    win.document.close();
    global.setTimeout(function () {
      try { win.focus(); win.print(); } catch (e) { /* 用户可手动 Ctrl+P */ }
    }, 400);
    return true;
  };

  EX.printCurrentPage = function (title) {
    try {
      var old = global.document.title;
      if (title) global.document.title = title;
      global.print();
      global.setTimeout(function () { global.document.title = old; }, 800);
      return true;
    } catch (e) { return false; }
  };

  /* ---------- 各成果的打印 HTML ---------- */
  function h(v) { return U.esc(v); }
  function vb(v) {
    if (v === '有效') return '<span class="vb vb-ok">有效</span>';
    if (v === '无效') return '<span class="vb vb-bad">无效</span>';
    if (v === '证据不足') return '<span class="vb vb-ins">证据不足</span>';
    if (v === '重大') return '<span class="vb vb-major">重大</span>';
    if (v === '重要') return '<span class="vb vb-important">重要</span>';
    if (v === '一般') return '<span class="vb vb-general">一般</span>';
    return h(v);
  }
  EX.vbHtml = vb;

  function docHeader(meta, subtitle) {
    return '<div class="doc-h"><h1>华诚集团内部控制评价 · ' + h(subtitle) + '</h1>' +
      '<div class="doc-meta">被评价主体：' + h(meta.entity) + '　评价期间：' + h(meta.period || '—') +
      '　评价人：' + h(meta.evaluator) + '　生成时间：' + h(meta.at) + '</div></div>';
  }

  EX.printEval = function (result, datasets) {
    var ds = datasets.eval;
    var head = ds.head.map(function (x) { return '<th>' + h(x) + '</th>'; }).join('');
    var rows = result.points.map(function (p) {
      return '<tr><td>' + h(p.id) + '</td><td>' + h(p.name) + '</td><td>' + h(p.flow) + '</td><td>' + h(p.risk) +
        '</td><td>' + h(p.dept) + '</td><td>' + vb(p.designResult) + '</td><td>' + vb(p.operatingResult) +
        '</td><td>' + vb(p.conclusion) + '</td><td>' + h(p.reason) + '</td><td>' + h(p.defectIds.join('、') || '—') + '</td></tr>';
    }).join('');
    var bodyHtml = docHeader(datasets.meta, '控制点有效性评估表（' + result.points.length + ' 行）') +
      '<div class="note">覆盖率 ' + result.stats.coverage + '%（' + result.stats.cpCount + ' / ' + result.stats.standard +
      '）｜有效 ' + result.stats.validCount + ' · 无效 ' + result.stats.invalidCount + ' · 证据不足 ' + result.stats.insuffCount +
      '｜逐点评估，不抽样、不遗漏。</div>' +
      '<table><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table>';
    return EX.printDocument('控制点有效性评估表', bodyHtml);
  };

  EX.printDefect = function (result, datasets) {
    var rows = result.defects.map(function (d) {
      return '<tr><td>' + h(d.id) + '</td><td>' + h(d.summary) + '</td><td>' + d.cpCount + '</td><td>' + h(d.cpIds.join('、')) +
        '</td><td>' + h(d.nature) + '</td><td>' + h(d.quantLevel) + '（' + U.fix2(d.amount) + ' 万元）</td><td>' +
        (d.redlines.length ? d.redlines.map(h).join('<br>') : '无') + '</td><td>' + vb(d.level) + '</td><td>' + h(d.dept) +
        '</td><td>' + h(d.advice) + '</td></tr>';
    }).join('');
    var bodyHtml = docHeader(datasets.meta, '缺陷分类清单（根因合并后 ' + result.defects.length + ' 条）') +
      '<div class="note">双标准认定：定量金额阈值与定性红线取较高等级（定性红线优先）。同一「根因标签 + 责任部门 + 流程」的失效控制点已合并为一条缺陷，并保留关联控制点清单与合并前数量。</div>' +
      '<table><thead><tr><th>缺陷编号</th><th>根因摘要</th><th>涉及控制点数</th><th>关联控制点</th><th>设计/运行</th><th>定量等级</th><th>定性红线</th><th>最终等级</th><th>责任部门</th><th>整改建议</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="10">未识别缺陷</td></tr>') + '</tbody></table>';
    return EX.printDocument('缺陷分类清单', bodyHtml);
  };

  EX.printScore = function (result, datasets) {
    var s = result.score;
    var steps = s.steps.map(function (st) { return '<li><b>' + h(st.title) + '</b>：' + st.body.replace(/<span class="hl(-ok|-blue)?">/g, '<b>').replace(/<\/span>/g, '</b>') + '</li>'; }).join('');
    var cpRows = result.score.cpRows.map(function (r) {
      return '<tr><td>' + h(r.id) + '</td><td>' + h(r.name) + '</td><td>' + h(r.risk) + '</td><td>' + r.weight +
        '</td><td>' + vb(r.design) + '</td><td>' + vb(r.operating) + '</td><td>' + U.fix2(r.score) + '</td><td>' + U.fix2(r.weighted) + '</td><td>' + (r.counted ? '计入分母' : '不计入') + '</td></tr>';
    }).join('');
    var dfRows = result.defects.map(function (d) {
      return '<tr><td>' + h(d.id) + '</td><td>' + h(d.summary) + '</td><td>' + vb(d.level) + '</td><td>' + d.weight +
        '</td><td>' + d.possibility + '</td><td>' + d.impact + '</td><td>' + d.R + '</td><td>' + U.fix2(d.weight * d.R) + '</td><td>' + h(d.riskBand) + '</td></tr>';
    }).join('');
    var bodyHtml = docHeader(datasets.meta, '加权风险评分明细') +
      '<div class="note">总分 = 100×Σ(控制点权重×有效性得分)/Σ(控制点权重) − Σ(缺陷权重×风险值)÷缺陷条数×2；结果保留 2 位小数并固定四舍五入，保证同输入同输出。</div>' +
      '<h2>计算过程</h2><ol>' + steps + '</ol>' +
      '<h2>评分结果</h2><div class="kv"><div><span>加权得分</span> <b>' + U.fix2(s.weightedScore) + '</b></div>' +
      '<div><span>缺陷扣分</span> <b>-' + U.fix2(s.deduct) + '</b></div><div><span>总分</span> <b>' + U.fix2(s.total) + '</b></div>' +
      '<div><span>缺陷条数</span> <b>' + s.defectCount + '</b></div></div>' +
      '<h2>控制点加权明细</h2><table><thead><tr><th>控制点编号</th><th>名称</th><th>风险等级</th><th>控制点权重</th><th>设计</th><th>运行</th><th>有效性得分</th><th>加权分</th><th>计入说明</th></tr></thead><tbody>' + cpRows + '</tbody></table>' +
      '<h2>缺陷扣分明细</h2><table><thead><tr><th>缺陷编号</th><th>根因摘要</th><th>最终等级</th><th>缺陷权重</th><th>可能性</th><th>影响程度</th><th>风险值R</th><th>权重×R</th><th>风险区间</th></tr></thead><tbody>' + (dfRows || '<tr><td colspan="9">未识别缺陷</td></tr>') + '</tbody></table>';
    return EX.printDocument('加权风险评分明细', bodyHtml);
  };

  /** 结论文档（含法规引用、缺陷列举、评分摘要、预警卡） */
  EX.buildConclusionHTML = function (result, ctx) {
    ctx = ctx || {};
    var s = result.score;
    var policy = (result.policies || ctx.policies || []);
    var majorDefects = result.defects.filter(function (d) { return d.level === '重大'; });
    var listDefects = result.defects.slice(0, 12);
    var regs = collectRegs(result);

    return docHeader({ entity: ctx.entity || IC.C.ENTITY, period: ctx.period || '—', evaluator: ctx.evaluator || IC.C.EVALUATOR, at: result.at }, '内部控制评价结论') +
      '<div class="verdict ' + s.verdictKey + '">评价结论：' + h(s.verdict) + '　（' +
      (s.veto ? '一票否决：存在 ' + s.majorIds.length + ' 项重大缺陷' : '无重大缺陷，按加权总分判定') + '）</div>' +
      '<div class="kv"><div><span>加权总分</span> <b>' + U.fix2(s.total) + '</b></div>' +
      '<div><span>加权得分</span> ' + U.fix2(s.weightedScore) + '</div>' +
      '<div><span>缺陷扣分</span> -' + U.fix2(s.deduct) + '</div>' +
      '<div><span>覆盖率</span> ' + result.stats.coverage + '%</div>' +
      '<div><span>控制点</span> 有效 ' + result.stats.validCount + ' / 无效 ' + result.stats.invalidCount + ' / 证据不足 ' + result.stats.insuffCount + '</div>' +
      '<div><span>缺陷</span> 重大 ' + s.counts['重大'] + ' / 重要 ' + s.counts['重要'] + ' / 一般 ' + s.counts['一般'] + '</div></div>' +
      '<h2>一、主要缺陷</h2><ol>' + (listDefects.length ? listDefects.map(function (d) {
        return '<li><b>' + h(d.id) + '（' + h(d.level) + '）</b>' + h(d.summary) + '：关联 ' + h(d.cpIds.join('、')) +
          '，责任部门：' + h(d.dept) + (d.amount > 0 ? '，涉及金额 ' + U.fix2(d.amount) + ' 万元' : '') +
          (d.redlines.length ? '，定性红线：' + h(d.redlines.join('；')) : '') + '</li>';
      }).join('') : '<li>未发现缺陷。请确认自评表是否完整填报。</li>') + '</ol>' +
      (result.defects.length > 12 ? '<div class="note">其余 ' + (result.defects.length - 12) + ' 条缺陷详见《缺陷分类清单》。</div>' : '') +
      '<h2>二、法规与制度依据</h2><ul>' + regs.map(function (r) {
        return '<li>' + h(r.law + ' ' + r.label) + '：' + h(r.text) + '</li>';
      }).join('') +
      (policy.length ? policy.map(function (pp) {
        return '<li>' + h(pp.name + ' ' + pp.clause) + '：' + h(pp.text) + '（内部制度条款以集团正式文本为准，请核对）</li>';
      }).join('') : '') +
      '</ul>' +
      '<h2>三、整改要求</h2><ol>' +
      '<li>重大缺陷：1 个月内制定整改方案，明确责任人、整改措施与完成时限，报审计委员会备案。</li>' +
      '<li>重要缺陷：3 个月内完成整改，整改结果经验证后闭环销项。</li>' +
      '<li>一般缺陷：纳入年度整改计划，按季度跟踪整改进度。</li>' +
      '<li>证据不足的控制点：由责任部门补充执行证据后重新评价，补充前不视为控制有效。</li></ol>' +
      (majorDefects.length ? '<h2>四、⚠️ 红色预警</h2>' + majorDefects.map(function (d) {
        return '<div class="alert"><div class="alert-h">红色预警 · ' + h(d.id) + ' · ' + h(d.rootCauseTag) + '</div>' +
          '<div class="alert-r"><span>缺陷描述</span><div>' + h(d.summary) + '</div></div>' +
          '<div class="alert-r"><span>涉及控制点</span><div>' + h(d.cpIds.join('、')) + '</div></div>' +
          '<div class="alert-r"><span>法规依据</span><div>' + h(d.regs ? d.regs.map(function (r) { return r.law + ' ' + r.label; }).join('；') : '') + '</div></div>' +
          '<div class="alert-r"><span>责任部门</span><div>' + h(d.dept) + '</div></div>' +
          '<div class="alert-r"><span>整改建议</span><div>' + h(d.advice) + '</div></div>' +
          '<div class="alert-r"><span>风险等级</span><div>' + h(d.level + '（风险值 R=' + d.R + '，' + d.riskBand + '风险）') + '</div></div></div>';
      }).join('') : '') +
      '<div class="note">说明：本结论的等级判定、评分与一票否决均由内置规则引擎计算，可复现；大模型仅参与文字表述。' +
      '覆盖率 ' + result.stats.coverage + '%' + (result.stats.coverage < 100 ? '，未覆盖部分控制点，结论仅供参考，不可作为年度正式评价。' : '。') + '</div>';
  };

  function collectRegs(result) {
    var ids = {};
    result.defects.forEach(function (d) {
      (d.redlineDetail || []).forEach(function (rl) {
        (rl.cite || []).forEach(function (id) { ids[id] = (ids[id] || 0) + 1; });
      });
    });
    var out = [];
    if (!Object.keys(ids).length) {
      out = [IC.KB.getReg('REG-EVAL-17'), IC.KB.getReg('REG-BASIC-28')];
    } else {
      // 固定顺序：按法规库中的定义顺序输出，保证可复现
      IC.KB.regulations.forEach(function (r) {
        if (ids[r.id]) out.push(r);
      });
      out.unshift(IC.KB.getReg('REG-EVAL-17'));
    }
    // 去重
    var seen = {}, res = [];
    out.forEach(function (r) { if (r && !seen[r.id]) { seen[r.id] = 1; res.push(r); } });
    return res;
  }
  EX.collectRegs = collectRegs;

  EX.printConclusion = function (result, ctx) {
    return EX.printDocument('内控评价结论', EX.buildConclusionHTML(result, ctx));
  };

  EX.printAlert = function (result, ctx) {
    var majorDefects = result.defects.filter(function (d) { return d.level === '重大'; });
    if (!majorDefects.length) return false;
    var bodyHtml = docHeader({ entity: (ctx || {}).entity || IC.C.ENTITY, period: (ctx || {}).period || '—', evaluator: IC.C.EVALUATOR, at: result.at },
      '重大缺陷红色预警卡') +
      majorDefects.map(function (d) {
        return '<div class="alert"><div class="alert-h">红色预警 · ' + h(d.id) + ' · ' + h(d.rootCauseTag) + ' · 重大缺陷</div>' +
          '<div class="alert-r"><span>缺陷描述</span><div>' + h(d.summary) + '</div></div>' +
          '<div class="alert-r"><span>涉及控制点</span><div>' + h(d.cpIds.join('、')) + '（共 ' + d.cpCount + ' 个）' + '</div></div>' +
          '<div class="alert-r"><span>法规依据</span><div>' + (d.redlineDetail || []).map(function (rl) {
            return h(rl.name + '：' + (rl.cite || []).map(function (id) { var r = IC.KB.getReg(id); return r ? r.law + r.label : ''; }).join('；'));
          }).join('<br>') + '</div></div>' +
          '<div class="alert-r"><span>责任部门</span><div>' + h(d.dept) + '</div></div>' +
          '<div class="alert-r"><span>整改建议</span><div>' + h(d.advice) + '</div></div>' +
          '<div class="alert-r"><span>风险等级</span><div>' + h(d.level + '（可能性 ' + d.possibility + ' × 影响程度 ' + d.impact + ' = 风险值 R ' + d.R + '，' + d.riskBand + '风险）') + '</div></div></div>';
      }).join('');
    return EX.printDocument('重大缺陷红色预警卡', bodyHtml);
  };

  /* ==========================================================================
   * 五、ZIP 打包（内置最小实现：store 无压缩 + CRC32）
   * ====================================================================== */
  function crc32(buf) {
    var table = crc32.table;
    if (!table) {
      table = crc32.table = (function () {
        var t = new Int32Array(256);
        for (var n = 0; n < 256; n++) {
          var c = n;
          for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
          t[n] = c;
        }
        return t;
      })();
    }
    var crc = -1;
    for (var i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
    return (crc ^ -1) >>> 0;
  }

  function strToU8(s) {
    if (typeof global.TextEncoder !== 'undefined') return new global.TextEncoder().encode(s);
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 128) out.push(c);
      else if (c < 2048) { out.push(192 | (c >> 6), 128 | (c & 63)); }
      else { out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); }
    }
    return new Uint8Array(out);
  }

  /** files: [{name, data: Uint8Array}] → Blob */
  EX.buildZip = function (files) {
    var localParts = [], centralParts = [], offset = 0;
    var now = new Date();
    var dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() / 2)) & 0xFFFF;
    var dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

    files.forEach(function (f) {
      var nameBytes = strToU8(f.name);
      var data = f.data;
      var crc = crc32(data);
      var lh = new Uint8Array(30 + nameBytes.length);
      var dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);          // version needed
      dv.setUint16(6, 0x0800, true);      // UTF-8 flag
      dv.setUint16(8, 0, true);           // stored
      dv.setUint16(10, dosTime, true);
      dv.setUint16(12, dosDate, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      localParts.push(lh, data);

      var ch = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      centralParts.push(ch);
      offset += lh.length + data.length;
    });

    var centralSize = centralParts.reduce(function (s, p) { return s + p.length; }, 0);
    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    return new global.Blob(localParts.concat(centralParts, [end]), { type: 'application/zip' });
  };

  EX.downloadAll = function (result, ctx) {
    var datasets = EX.buildDatasets(result, ctx);
    var stamp = (ctx && ctx.period ? String(ctx.period).replace(/[\\/:*?"<>|\s]/g, '') : U.dateOnly());
    var files = [];
    var names = { eval: '①控制点有效性评估表', defect: '②缺陷分类清单', score: '③加权风险评分明细', conclusion: '④内控评价结论' };

    // 四份成果 CSV
    ['eval', 'defect', 'score', 'conclusion'].forEach(function (k) {
      files.push({ name: names[k] + '.csv', data: strToU8(EX.toCSV(datasets[k])) });
      if (k === 'score') {
        files.push({ name: '③缺陷扣分明细.csv', data: strToU8(EX.toCSV(datasets.scoreDefect)) });
      }
    });

    // Excel（一个文件四张表）
    try {
      if (IC.env.hasXLSX()) {
        var wb = EX.buildWorkbook(datasets);
        var out = global.XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
        files.push({ name: '内部控制评价全部成果.xlsx', data: new Uint8Array(out) });
      }
    } catch (e) { /* Excel 失败不影响 CSV */ }

    // 结论文本
    var textLines = [
      '华诚集团内部控制评价结论',
      '被评价主体：' + (ctx && ctx.entity || IC.C.ENTITY) + '　评价期间：' + (ctx && ctx.period || '—'),
      '生成时间：' + result.at,
      '',
      '【评价结论】' + result.score.verdict,
      '【是否触发一票否决】' + (result.score.veto ? '是（存在 ' + result.score.majorIds.length + ' 项重大缺陷 ' + result.score.majorIds.join('、') + '）' : '否'),
      '【加权总分】' + U.fix2(result.score.total) + '（结论以定性判定为准）',
      '【加权得分】' + U.fix2(result.score.weightedScore) + '　【缺陷扣分】-' + U.fix2(result.score.deduct),
      '【覆盖率】' + result.stats.coverage + '%（' + result.stats.cpCount + '/' + result.stats.standard + '）',
      '',
      '【主要缺陷】'
    ];
    result.defects.forEach(function (d, i) {
      textLines.push('  ' + (i + 1) + '. ' + d.id + '（' + d.level + '）' + d.summary + '：关联 ' + d.cpIds.join('、') + '，责任部门：' + d.dept);
    });
    if (!result.defects.length) textLines.push('  未发现缺陷。');
    textLines.push('');
    textLines.push('【评分过程】');
    result.score.steps.forEach(function (st) {
      textLines.push('  ' + st.title + '：' + st.body.replace(/<[^>]+>/g, ''));
    });
    files.push({ name: names.conclusion + '.txt', data: strToU8('\ufeff' + textLines.join('\r\n')) });

    // 证明材料
    var logText = IC.LLM.buildLogText();
    files.push({ name: 'useractivity.log', data: strToU8(logText) });
    files.push({
      name: '评分口径与数据说明.txt',
      data: strToU8('\ufeff' + [
        '华诚集团内部控制评价 · 评分口径与数据说明',
        '生成时间：' + U.nowStamp(),
        '',
        '一、逐点评估口径（双维度 checklist）',
        '  设计有效性：有明确控制措施 / 有责任人和频率 / 覆盖关键风险点 / 留有可核查痕迹（4 项全满足=设计有效）',
        '  运行有效性：按期执行 / 有执行证据 / 偏差未出现或已整改（3 项全满足=运行有效）',
        '  两项均有效=有效；任一无效=无效并生成候选缺陷；关键证据缺失=证据不足并计入待补清单',
        '',
        '二、缺陷认定双标准',
        '  定量：< ' + result.params.importantAmount + ' 万元 = 一般；≥ ' + result.params.importantAmount + ' 万元 = 重要；≥ ' + result.params.majorAmount + ' 万元 = 重大',
        '  定性红线：命中任意一条直接判重大（不相容职务未分离、高管舞弊、管理层凌驾、审计委员会失效、非标内控审计意见、重大信息未披露、损失无法追回、同一缺陷连续两年未整改）',
        '  最终等级 = 定量与定性取较高者（定性红线优先）',
        '',
        '三、根因合并',
        '  同一「根因标签 + 责任部门 + 流程」的失效控制点合并为一条缺陷，保留关联控制点编号与合并前数量',
        '',
        '四、评分公式',
        '  总分 = 100×Σ(控制点权重×有效性得分)/Σ(控制点权重) − Σ(缺陷权重×风险值)÷缺陷条数×' + result.params.defectFactor,
        '  缺陷权重：一般 ' + result.params.weightGeneral + ' / 重要 ' + result.params.weightImportant + ' / 重大 ' + result.params.weightMajor,
        '  控制点权重：高 ' + result.params.cpWeightHigh + ' / 中 ' + result.params.cpWeightMid + ' / 低 ' + result.params.cpWeightLow,
        '  有效性得分：双有效 1.0 / 一项无效 0.5 / 两项无效 0',
        '  风险值 R = 可能性 × 影响程度（1–25）',
        '',
        '五、结论判定',
        '  一票否决：存在任意 1 条重大缺陷 → 结论「无效」',
        '  无重大缺陷：总分 ≥ ' + result.params.passLine + ' → 有效；≥ ' + result.params.basicLine + ' → 基本有效（需整改）；< ' + result.params.basicLine + ' → 无效',
        '',
        '六、数据来源',
        '  控制点清单 ' + result.stats.cpCount + ' 条 / 自评表 ' + result.stats.selfCount + ' 条 / 缺陷记录 ' + result.stats.defectRecordCount + ' 条',
        '  覆盖率 ' + result.stats.coverage + '%',
        '',
        '七、声明',
        '  判定与评分由内置规则引擎计算，同输入同输出；大模型仅参与文字表述，不参与等级与评分。',
        '  内部制度条款使用占位条款，具体条款以集团正式文本为准，请核对。',
        '  数据只在本机：材料仅保存在浏览器内存与本地存储。'
      ].join('\r\n'))
    });

    var blob = EX.buildZip(files);
    var ok = U.download(FILE_PREFIX + stamp + '_全部成果.zip', blob);
    IC.LLM.log({
      type: 'export',
      action: '一键下载全部成果（ZIP）',
      input: '四份成果 + 日志 + 说明，共 ' + files.length + ' 个文件',
      output: ok ? '已生成 ZIP 下载' : '浏览器拒绝下载',
      expected: ok
    });
    return ok;
  };

  /* ==========================================================================
   * 六、模板下载
   * ====================================================================== */
  EX.buildImportTemplate = function () {
    if (!IC.env.hasXLSX()) return false;
    var XLSX = global.XLSX;
    var wb = XLSX.utils.book_new();
    ['controls', 'selfassessment', 'defects'].forEach(function (k) {
      var rows = IC.buildTemplateRows(k);
      var ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = rows[0].map(function () { return { wch: 22 }; });
      var name = { controls: '控制点清单', selfassessment: '内控自评表', defects: '缺陷记录表' }[k];
      XLSX.utils.book_append_sheet(wb, ws, name);
    });
    var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    var ok = U.download(FILE_PREFIX + '导入模板.xlsx', new global.Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    IC.LLM.log({ type: 'export', action: '下载导入模板', input: '三份材料表头', output: ok ? '已下载 xlsx 模板' : '失败', expected: ok });
    return ok;
  };

})(typeof window !== 'undefined' ? window : this);
