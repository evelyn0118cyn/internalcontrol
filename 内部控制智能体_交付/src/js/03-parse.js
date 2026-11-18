/* =============================================================================
 * 03-parse.js — 材料解析与字段校验
 *   · parseTableRows    ：二维表 → 记录（自动识别表头别名，支持列名模糊匹配）
 *   · parsePasteText    ：制表符 / 逗号 / 竖线分隔的粘贴文本 → 二维表
 *   · parseCSVText      ：CSV（支持引号转义）
 *   · parseXlsxFile     ：读 Excel / CSV（SheetJS，双行表头自动识别，失败降级为 CSV 或提示）
 *   · normalizeControls / normalizeSelfAssessment / normalizeDefects
 *   · validateMaterials ：字段完整性校验，逐条给出提示
 * 所有函数均为纯函数（除读文件外），不做校验以外的副作用。
 * ========================================================================== */
(function (global) {
  'use strict';
  var IC = global.IC;
  var U = IC.U;

  /* ------------------------------------------------------------ 字段别名表 */
  var SCHEMA = IC.SCHEMA = {
    controls: {
      key: 'controls',
      label: '控制点清单',
      fileHints: '控制点清单 / 控制点表 / 内控控制点',
      fields: [
        { k: 'id', name: '控制点编号', required: true, alias: ['控制点编号', '编号', '控制编号', '点编号', 'id', 'code', '控制点id'] },
        { k: 'name', name: '控制点名称', required: true, alias: ['控制点名称', '名称', '控制点', '控制点描述', 'name'] },
        { k: 'flow', name: '所属流程', required: true, alias: ['所属流程', '业务流程', '所属业务流程', '流程', 'flow', '业务循环'] },
        { k: 'risk', name: '风险等级', required: true, alias: ['风险等级', '风险', '等级', 'risk', '风险级别'] },
        { k: 'dept', name: '责任部门', required: true, alias: ['责任部门', '部门', '主管部门', 'dept', 'responsibledept'] },
        { k: 'method', name: '控制方式', required: false, alias: ['控制方式', '方式', '控制类型', 'method', '控制手段'] },
        { k: 'freq', name: '控制频率', required: false, alias: ['控制频率', '频率', '频次', 'freq', 'frequency'] },
        { k: 'design', name: '控制描述', required: false, alias: ['控制描述', '控制措施', '控制要求', 'design', '制度要求', '控制活动'] }
      ]
    },
    selfassessment: {
      key: 'selfassessment',
      label: '内控自评表',
      fileHints: '自评表 / 内控自评 / 自我评价',
      fields: [
        { k: 'cpId', name: '控制点编号', required: true, alias: ['控制点编号', '编号', '控制编号', 'id', 'code', '控制点id', '控制点'] },
        { k: 'concl', name: '自评结论', required: true, alias: ['自评结论', '结论', '评价结论', '自评结果', 'concl', 'result'] },
        { k: 'evidence', name: '执行证据说明', required: true, alias: ['执行证据说明', '执行证据', '证据说明', '证据', 'evidence', '执行情况', '执行说明'] },
        { k: 'deviation', name: '偏差与整改情况', required: false, alias: ['偏差与整改情况', '偏差及整改', '整改情况', '偏差', 'deviation', '整改'] },
        { k: 'person', name: '自评人', required: false, alias: ['自评人', '填报人', '评估人', 'person', '责任人'] },
        { k: 'date', name: '自评日期', required: false, alias: ['自评日期', '日期', 'date', '评价日期'] }
      ]
    },
    defects: {
      key: 'defects',
      label: '缺陷记录表',
      fileHints: '缺陷记录 / 缺陷表 / 问题清单',
      fields: [
        { k: 'desc', name: '缺陷描述', required: true, alias: ['缺陷描述', '描述', '缺陷事项', 'desc', '问题描述', '缺陷内容'] },
        { k: 'cps', name: '涉及控制点编号', required: true, alias: ['涉及控制点编号', '涉及控制点', '控制点编号', 'cps', '关联控制点', '涉及控制点列表'] },
        { k: 'amount', name: '涉及金额（万元）', required: false, alias: ['涉及金额（万元）', '涉及金额', '金额', 'amount', '涉及金额万元', '影响金额'] },
        { k: 'times', name: '发生次数', required: false, alias: ['发生次数', '次数', '频次', 'times', '发生频次'] },
        { k: 'source', name: '发现方式', required: false, alias: ['发现方式', '来源', 'source', '发现途径', '发现渠道'] },
        { k: 'date', name: '发现日期', required: false, alias: ['发现日期', '日期', 'date'] },
        { k: 'redline', name: '定性红线', required: false, alias: ['定性红线', '红线', '定性情形', 'redline', '定性标准', '定性判断'] },
        { k: 'rootCause', name: '根因标签', required: false, alias: ['根因标签', '根因', 'rootcause', '原因', '原因分类'] }
      ]
    }
  };

  IC.SCHEMA_LIST = ['controls', 'selfassessment', 'defects'];

  /* ------------------------------------------------------------ 表头归一 */
  function normHeader(h) {
    return U.clean(h)
      .replace(/[\s\u3000]/g, '')
      .replace(/[（(][^）)]*[）)]/g, '')     // 去掉括号内容，如「涉及金额（万元）」→「涉及金额」
      .replace(/[:：*＊]/g, '')
      .toLowerCase();
  }

  /** 模糊匹配列：返回最佳匹配字段 key（找不到返回 null） */
  function matchField(header, schema) {
    var h = normHeader(header);
    if (!h) return null;
    var best = null, bestScore = 0;
    schema.fields.forEach(function (f) {
      var cands = [f.name].concat(f.alias);
      cands.forEach(function (c) {
        var cn = normHeader(c);
        if (!cn) return;
        var score = 0;
        if (h === cn) score = 100 + cn.length;
        else if (h.indexOf(cn) >= 0 || cn.indexOf(h) >= 0) score = 50 + Math.min(h.length, cn.length);
        if (score > bestScore) { bestScore = score; best = f.k; }
      });
    });
    return bestScore >= 50 ? best : null;
  }

  IC.matchField = matchField;
  IC.normHeader = normHeader;

  /* ------------------------------------------------------------ 粘贴文本解析 */
  /** 判断分隔符：制表符优先，其次竖线，其次逗号，其次连续空格 */
  function detectDelimiter(lines) {
    var sample = lines.slice(0, Math.min(6, lines.length)).join('\n');
    var tab = (sample.match(/\t/g) || []).length;
    var pipe = (sample.match(/\|/g) || []).length;
    var comma = (sample.match(/,/g) || []).length;
    var fullcomma = (sample.match(/，/g) || []).length;
    if (tab > 0) return '\t';
    if (pipe > 0) return '|';
    if (comma > 0 || fullcomma > 0) return ',';
    return null;
  }

  /** 按分隔符拆行（支持引号包裹） */
  function splitLine(line, delim) {
    if (!delim) {
      // 连续两个以上空格视为分隔
      return line.split(/\s{2,}/);
    }
    if (delim !== ',') {
      return line.split(delim).map(function (x) { return U.unquote(x); });
    }
    // CSV：处理双引号转义
    var out = [], cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (ch === '"') {
        if (inQ && line.charAt(i + 1) === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if ((ch === ',' || ch === '，') && !inQ) {
        out.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map(function (x) { return U.unquote(x); });
  }

  IC.parsePasteText = function (text) {
    var raw = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\ufeff/g, '');
    var lines = raw.split('\n').filter(function (l) { return U.clean(l) !== ''; });
    if (!lines.length) return [];
    var delim = detectDelimiter(lines);
    return lines.map(function (l) { return splitLine(l, delim); });
  };

  IC.parseCSVText = function (text) {
    return IC.parsePasteText(text);
  };

  /* ------------------------------------------------------------ 二维表 → 记录 */
  /**
   * 把二维表映射成记录：
   *   1) 在前 3 行内寻找"表头行"（命中表头关键词最多的行）
   *   2) 表头行 → 字段 key 映射；其余行按映射取值
   *   3) 若表格无表头（全部按位置对齐），则按 schema.fields 顺序兜底
   */
  IC.parseTableRows = function (rows, schema) {
    if (!rows || !rows.length) return { records: [], mapping: {}, headerFound: false, headerRow: -1 };
    var scanRows = Math.min(3, rows.length);
    var best = { idx: -1, hits: 0, mapping: {} };
    for (var r = 0; r < scanRows; r++) {
      var mapping = {}, hits = 0;
      (rows[r] || []).forEach(function (cell, ci) {
        var fk = matchField(cell, schema);
        if (fk && !mapping[fk]) { mapping[fk] = ci; hits++; }
      });
      if (hits > best.hits) best = { idx: r, hits: hits, mapping: mapping };
    }
    var headerFound = best.hits >= Math.min(2, schema.fields.filter(function (f) { return f.required; }).length);
    var mapping = headerFound ? best.mapping : {};
    if (!headerFound) {
      // 无表头：按顺序对齐必填字段 + 可选字段
      schema.fields.forEach(function (f, i) { mapping[f.k] = i; });
    }
    var start = headerFound ? best.idx + 1 : 0;
    var records = [];
    for (var i = start; i < rows.length; i++) {
      var row = rows[i] || [];
      if (!row.some(function (c) { return U.clean(c) !== ''; })) continue;
      var rec = {};
      schema.fields.forEach(function (f) {
        var ci = mapping[f.k];
        rec[f.k] = (ci === undefined || ci === null) ? '' : U.clean(row[ci]);
      });
      records.push(rec);
    }
    return { records: records, mapping: mapping, headerFound: headerFound, headerRow: best.idx };
  };

  /* ------------------------------------------------------------ Excel 读取 */
  /**
   * 读取 Excel / CSV 文件
   * @param {File} file
   * @param {Function} cb (err, rows, info)
   */
  IC.parseXlsxFile = function (file, cb) {
    var name = String(file && file.name || '');
    var ext = (name.split('.').pop() || '').toLowerCase();
    var isText = ext === 'csv' || ext === 'txt';
    var reader = new global.FileReader();

    reader.onerror = function () {
      cb('文件读取失败，请重试或改用 CSV / 粘贴文本', null, null);
    };

    reader.onload = function (e) {
      var buf = e.target.result;
      // ---- CSV / TXT：直接按文本解析 ----
      if (isText) {
        var text = decodeTextBuffer(buf);
        cb(null, IC.parsePasteText(text), { sheet: '(文本)', via: 'text', fileName: name });
        return;
      }
      // ---- Excel：使用 SheetJS ----
      if (!(IC.env.hasXLSX())) {
        cb('未加载 Excel 解析库（SheetJS）。请改用 CSV 文件或粘贴文本导入。', null, null);
        return;
      }
      try {
        var wb = global.XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true, cellText: false });
        if (!wb || !wb.SheetNames || !wb.SheetNames.length) {
          cb('文件中没有可读取的工作表，请检查文件内容', null, null);
          return;
        }
        var sheetName = pickSheet(wb, name);
        var ws = wb.Sheets[sheetName];
        var rows = global.XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });
        rows = (rows || []).map(function (r) {
          return (r || []).map(function (c) {
            if (c === null || c === undefined) return '';
            if (c instanceof Date) {
              return c.getFullYear() + '-' + pad2(c.getMonth() + 1) + '-' + pad2(c.getDate());
            }
            return U.clean(String(c));
          });
        });
        cb(null, rows, { sheet: sheetName, via: 'xlsx', fileName: name, sheets: wb.SheetNames });
      } catch (err) {
        cb('文件格式不支持或已损坏，请改用 CSV 或粘贴文本导入（错误：' + (err && err.message ? err.message : err) + '）', null, null);
      }
    };

    if (isText) reader.readAsArrayBuffer(file);
    else reader.readAsArrayBuffer(file);

    function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  };

  function pickSheet(wb, fileName) {
    // 优先选择名字里带材料关键词的工作表
    var keywords = ['控制点', '自评', '缺陷', '清单', '评价'];
    for (var k = 0; k < keywords.length; k++) {
      for (var i = 0; i < wb.SheetNames.length; i++) {
        if (wb.SheetNames[i].indexOf(keywords[k]) >= 0 && fileName.indexOf(keywords[k]) >= 0) return wb.SheetNames[i];
      }
    }
    // 否则选择第一个非空工作表
    for (var j = 0; j < wb.SheetNames.length; j++) {
      var ws = wb.Sheets[wb.SheetNames[j]];
      if (ws && ws['!ref']) return wb.SheetNames[j];
    }
    return wb.SheetNames[0];
  }

  /** 文本解码：优先 UTF-8，含替换字符时尝试 GBK */
  function decodeTextBuffer(buf) {
    var bytes = new Uint8Array(buf);
    var utf8 = '';
    try {
      utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    } catch (e) {
      utf8 = '';
    }
    if (utf8.indexOf('\ufffd') >= 0) {
      try {
        var gbk = new TextDecoder('gbk').decode(bytes);
        if (gbk.indexOf('\ufffd') < 0) return gbk;
      } catch (e2) { /* 浏览器不支持 gbk，保持 utf8 */ }
    }
    // 去掉 BOM
    return utf8.replace(/^\ufeff/, '');
  }
  IC.decodeTextBuffer = decodeTextBuffer;

  /* ------------------------------------------------------------ 材料归一化 */
  var RISK_MAP = {
    '高': '高', '高风险': '高', '高等级': '高', 'h': '高', 'high': '高', '3': '高',
    '中': '中', '中风险': '中', '中等级': '中', 'm': '中', 'medium': '中', 'mid': '中', '2': '中', '一般风险': '中',
    '低': '低', '低风险': '低', '低等级': '低', 'l': '低', 'low': '低', '1': '低'
  };

  IC.normRisk = function (v) {
    var s = U.clean(v).toLowerCase().replace(/\s/g, '');
    if (!s) return '';
    if (RISK_MAP[s]) return RISK_MAP[s];
    if (/高/.test(s)) return '高';
    if (/低/.test(s)) return '低';
    if (/中/.test(s)) return '中';
    return '';
  };

  /** 控制点清单归一化 */
  IC.normalizeControls = function (records) {
    return (records || []).map(function (r, i) {
      return {
        id: U.normCpId(r.id),
        name: U.clean(r.name),
        flow: U.clean(r.flow),
        risk: IC.normRisk(r.risk),
        dept: U.clean(r.dept),
        method: U.clean(r.method) || '人工',
        freq: U.clean(r.freq) || '按笔',
        design: U.clean(r.design),
        note: '',
        _row: i + 1
      };
    });
  };

  /** 自评表归一化 */
  IC.normalizeSelfAssessment = function (records) {
    return (records || []).map(function (r, i) {
      return {
        cpId: U.normCpId(r.cpId),
        concl: U.clean(r.concl),
        evidence: U.clean(r.evidence),
        deviation: U.clean(r.deviation),
        person: U.clean(r.person),
        date: U.clean(r.date),
        _row: i + 1
      };
    });
  };

  /** 缺陷记录归一化（金额统一到万元口径） */
  IC.normalizeDefects = function (records) {
    return (records || []).map(function (r, i) {
      var ids = U.splitIds(r.cps);
      return {
        desc: U.clean(r.desc),
        cps: ids,
        cpsRaw: U.clean(r.cps),
        amount: U.moneyWan(r.amount),
        amountRaw: U.clean(r.amount),
        times: U.num(r.times, 1),
        source: U.clean(r.source) || '自评',
        date: U.clean(r.date),
        redline: U.clean(r.redline),
        rootCause: U.clean(r.rootCause),
        _row: i + 1
      };
    });
  };

  /* ------------------------------------------------------------ 字段校验 */
  /**
   * 校验单份材料
   * @param {string} matKey
   * @param {Array} records 已归一化的记录
   * @param {Object} ctx { cpIds: {}, allCpIds: [] }
   * @returns {{level:'ok'|'warn'|'bad', issues:[{type,msg,row}], stats:{}}}
   */
  IC.validateMaterials = function (matKey, records, ctx) {
    var schema = SCHEMA[matKey];
    var issues = [];
    var list = records || [];
    var missing = {};

    function miss(fieldName, row) {
      var key = fieldName;
      missing[key] = (missing[key] || 0) + 1;
      if (issues.length < 40) {
        issues.push({ type: 'error', msg: '第 ' + row + ' 行缺少「' + fieldName + '」' + (matKey === 'selfassessment' ? '，无法判定该控制点执行情况' : '，请补充'), row: row });
      }
    }

    if (!list.length) {
      return { level: 'bad', issues: [{ type: 'error', msg: '未导入任何数据，请上传 Excel 或粘贴文本' }], missing: {}, stats: {} };
    }

    var cpIds = ctx && ctx.cpIds ? ctx.cpIds : {};

    list.forEach(function (r, i) {
      var row = r._row || (i + 1);
      schema.fields.forEach(function (f) {
        var v = r[f.k];
        var empty = Array.isArray(v) ? v.length === 0 : U.isEmpty(v === null || v === undefined ? '' : String(v));
        if (f.required && empty) miss(f.name, row);
      });
      // 控制点编号格式校验
      if (r.id !== undefined && U.isEmpty(r.id) === false) {
        if (!/^[A-Z]{1,4}-\d{2,5}$/.test(r.id)) {
          issues.push({ type: 'warn', msg: '第 ' + row + ' 行控制点编号「' + r.id + '」不是标准格式（如 C-001），已尝试规范化', row: row });
        }
      }
      if (r.risk !== undefined && !r.risk) {
        issues.push({ type: 'warn', msg: '第 ' + row + ' 行风险等级无法识别，请填写 高 / 中 / 低，否则该控制点权重按「中」计入', row: row });
      }
      // 自评表：检查控制点编号是否存在于清单
      if (matKey === 'selfassessment' && r.cpId && ctx && ctx.cpIds) {
        if (!ctx.cpIds[r.cpId]) {
          issues.push({ type: 'warn', msg: '第 ' + row + ' 行控制点「' + r.cpId + '」不在控制点清单中，该条将被忽略', row: row });
        }
      }
      if (matKey === 'defects') {
        if (r.cps && r.cps.length && ctx && ctx.cpIds) {
          r.cps.forEach(function (id) {
            if (!ctx.cpIds[id]) issues.push({ type: 'warn', msg: '第 ' + row + ' 行涉及控制点「' + id + '」不在控制点清单中', row: row });
          });
        }
        if (r.amount === 0 && U.isEmpty(r.amountRaw)) {
          issues.push({ type: 'warn', msg: '第 ' + row + ' 行未填写涉及金额，按 0 万元（流程性缺陷）处理', row: row });
        }
      }
    });

    // 去重提示（同一控制点重复填列）
    if (matKey === 'controls' || matKey === 'selfassessment') {
      var seen = {}, dup = [];
      list.forEach(function (r) {
        var id = r.id || r.cpId;
        if (!id) return;
        if (seen[id]) dup.push(id);
        seen[id] = 1;
      });
      if (dup.length) {
        issues.push({ type: 'warn', msg: '出现重复控制点编号：' + U.uniq(dup).join('、') + '，评估时以最后一条为准', row: null });
      }
    }

    var errCount = issues.filter(function (x) { return x.type === 'error'; }).length;
    var level = errCount > 0 ? 'bad' : (issues.length > 0 ? 'warn' : 'ok');
    return { level: level, issues: issues, missing: missing, stats: { count: list.length } };
  };

  /** 字段缺列提示（针对表头整体缺失某列时的友好提示） */
  IC.missingColumnIssues = function (matKey, mapping) {
    var schema = SCHEMA[matKey];
    var issues = [];
    schema.fields.forEach(function (f) {
      if (f.required && (mapping[f.k] === undefined || mapping[f.k] === null)) {
        issues.push({ type: 'error', msg: '缺少「' + f.name + '」列，请补充后再导入' });
      } else if (!f.required && (mapping[f.k] === undefined || mapping[f.k] === null)) {
        issues.push({ type: 'warn', msg: '缺少「' + f.name + '」列（可选，缺失时按默认值处理）' });
      }
    });
    return issues;
  };

  /** 解析 + 归一化 + 校验的一体化入口 */
  IC.ingestRows = function (matKey, rows, ctx) {
    var parsed = IC.parseTableRows(rows, SCHEMA[matKey]);
    var records;
    if (matKey === 'controls') records = IC.normalizeControls(parsed.records);
    else if (matKey === 'selfassessment') records = IC.normalizeSelfAssessment(parsed.records);
    else records = IC.normalizeDefects(parsed.records);

    var colIssues = [];
    if (!parsed.headerFound) {
      colIssues.push({ type: 'warn', msg: '未识别到表头行，已按列顺序解析，请核对字段是否错位' });
    } else {
      colIssues = IC.missingColumnIssues(matKey, parsed.mapping).filter(function (i) { return i.type === 'error'; });
    }
    var v = IC.validateMaterials(matKey, records, ctx);
    v.issues = (v.issues || []).filter(function (i) {
      // 缺列的全局提示代替逐行提示，避免刷屏
      if (v.missing && v.missing[Object.keys(v.missing)[0]] >= records.length) return false;
      return true;
    });
    v.issues = colIssues.concat(v.issues);
    if (colIssues.some(function (i) { return i.type === 'error'; })) v.level = 'bad';
    v.headerFound = parsed.headerFound;
    v.mapping = parsed.mapping;
    return { records: records, validation: v, parsed: parsed };
  };

  /** 解析粘贴文本并归一化（供 UI 调用） */
  IC.ingestText = function (matKey, text, ctx) {
    var rows = IC.parsePasteText(text);
    if (!rows.length) {
      return { records: [], validation: { level: 'bad', issues: [{ type: 'error', msg: '粘贴内容为空，请粘贴表格文本' }], missing: {}, stats: {} } };
    }
    return IC.ingestRows(matKey, rows, ctx);
  };

  /* ------------------------------------------------------------ 模板与示例文本 */
  IC.buildTemplateRows = function (matKey) {
    var schema = SCHEMA[matKey];
    var head = schema.fields.map(function (f) { return f.name; });
    var sample = {
      controls: ['C-001', '采购申请审批', '采购与付款', '高', '采购部', '人工+系统', '每笔', '采购申请须经部门负责人与采购部负责人分级审批并留痕'],
      selfassessment: ['C-001', '有效', '每笔采购申请均有审批单与系统留痕', '无偏差', '王敏', '2025-01-15'],
      defects: ['付款审批存在先付后批', 'C-009、C-010', '260', '3', '自评', '2025-07-10', '无', '授权审批流于形式']
    }[matKey];
    return [head, sample || []];
  };

  IC.buildSamplePaste = function (matKey) {
    var rows = IC.buildTemplateRows(matKey);
    return rows.map(function (r) { return r.join('\t'); }).join('\n');
  };

})(typeof window !== 'undefined' ? window : this);
