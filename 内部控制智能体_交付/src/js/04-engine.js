/* =============================================================================
 * 04-engine.js — 规则引擎（纯函数，输入输出确定 → 同输入同输出）
 *
 *   evaluatePoints(points, params)        逐点评估：设计有效性 4 项 + 运行有效性 3 项
 *   buildDefects(points, records, params)  缺陷识别 · 定量/定性双标准三级分类 · 根因聚类合并
 *   scoreAll(points, defects, params)      风险矩阵加权评分 + 缺陷扣分 + 一票否决结论
 *   runAll(materials, params, opts)        一键全流程（不含 UI、不含大模型，保证可复现）
 *
 * 关键口径（与 Prompt 文档一致）：
 *   · 设计有效性：有明确控制措施 / 有责任人和频率 / 覆盖关键风险点 / 留有可核查痕迹 —— 4 项全满足=有效
 *   · 运行有效性：自评显示按期执行 / 有执行证据 / 偏差未出现或已整改 —— 3 项全满足=有效
 *   · 两项均有效=有效；任一无效=无效并生成候选缺陷；关键证据缺失=证据不足并计入待补清单
 *   · 缺陷等级 = max(定量等级, 定性红线等级)，定性红线命中即重大
 *   · 根因合并：根因标签 + 责任部门 + 流程 三者相同 → 合并为一条缺陷
 *   · 总分 = 100×Σ(控制点权重×有效性得分)/Σ(控制点权重) − Σ(缺陷权重×风险值)÷缺陷条数×2
 *   · 存在任意 1 条重大缺陷 → 一票否决，结论「无效」
 * ========================================================================== */
(function (global) {
  'use strict';
  var IC = global.IC;
  var U = IC.U;

  /* ==========================================================================
   * 一、默认参数
   * ====================================================================== */
  IC.DEFAULT_PARAMS = {
    majorAmount: 500,        // 重大缺陷金额阈值（万元，含）
    importantAmount: 100,    // 重要缺陷金额阈值（万元，含）
    weightGeneral: 1,        // 一般缺陷权重
    weightImportant: 3,      // 重要缺陷权重
    weightMajor: 8,          // 重大缺陷权重
    cpWeightHigh: 3,         // 控制点权重：高
    cpWeightMid: 2,          // 控制点权重：中
    cpWeightLow: 1,          // 控制点权重：低
    passLine: 80,            // 总分 ≥ 80 → 有效
    basicLine: 60,           // 60–79 → 基本有效；< 60 → 无效
    defectFactor: 2          // 缺陷扣分系数
  };

  IC.params = U.clone(IC.DEFAULT_PARAMS);

  IC.sanitizeParams = function (p) {
    var d = IC.DEFAULT_PARAMS;
    var raw = p || {};
    function n(v, def, min, max) {
      var x = U.num(v, def);
      if (x === null || !isFinite(x)) x = def;
      if (min !== undefined && x < min) x = min;
      if (max !== undefined && x > max) x = max;
      return x;
    }
    var out = {
      majorAmount: n(raw.majorAmount, d.majorAmount, 0),
      importantAmount: n(raw.importantAmount, d.importantAmount, 0),
      weightGeneral: n(raw.weightGeneral, d.weightGeneral, 0.1),
      weightImportant: n(raw.weightImportant, d.weightImportant, 0.1),
      weightMajor: n(raw.weightMajor, d.weightMajor, 0.1),
      cpWeightHigh: n(raw.cpWeightHigh, d.cpWeightHigh, 0.1),
      cpWeightMid: n(raw.cpWeightMid, d.cpWeightMid, 0.1),
      cpWeightLow: n(raw.cpWeightLow, d.cpWeightLow, 0.1),
      passLine: n(raw.passLine, d.passLine, 0, 100),
      basicLine: n(raw.basicLine, d.basicLine, 0, 100),
      defectFactor: n(raw.defectFactor, d.defectFactor, 0)
    };
    // 阈值顺序纠正：重要阈值不得高于重大阈值
    if (out.importantAmount > out.majorAmount) out.importantAmount = out.majorAmount;
    if (out.basicLine > out.passLine) out.basicLine = out.passLine;
    return out;
  };

  IC.paramWarnings = function (p) {
    var out = [];
    if (p.weightMajor < p.weightGeneral * 5) {
      out.push('重大缺陷权重（' + p.weightMajor + '）小于一般缺陷权重（' + p.weightGeneral + '）的 5 倍，不符合「重大缺陷权重 ≥ 一般缺陷 5 倍」的口径要求。');
    }
    if (p.importantAmount >= p.majorAmount) {
      out.push('重要缺陷金额阈值应小于重大缺陷金额阈值，否则等级将全部落在「重要」以上。');
    }
    if (p.basicLine >= p.passLine) {
      out.push('「基本有效」分数线应小于「有效」分数线。');
    }
    return out;
  };

  IC.cpWeight = function (risk, params) {
    var p = params || IC.params;
    if (risk === '高') return p.cpWeightHigh;
    if (risk === '低') return p.cpWeightLow;
    return p.cpWeightMid;   // 中 / 未识别 → 中
  };

  IC.defectWeight = function (level, params) {
    var p = params || IC.params;
    if (level === '重大') return p.weightMajor;
    if (level === '重要') return p.weightImportant;
    return p.weightGeneral;
  };

  /** 定量等级：< 重要阈值 = 一般；≥ 重要阈值 = 重要；≥ 重大阈值 = 重大 */
  IC.quantLevel = function (amountWan, params) {
    var p = params || IC.params;
    var a = isFinite(amountWan) ? amountWan : 0;
    if (a >= p.majorAmount) return '重大';
    if (a >= p.importantAmount) return '重要';
    return '一般';
  };

  IC.higherLevel = function (a, b) {
    var o = IC.C.LEVEL_ORDER;
    return (o[a] || 0) >= (o[b] || 0) ? a : b;
  };

  /* ==========================================================================
   * 二、逐点评估（双维度 checklist）
   * ====================================================================== */

  /** 设计有效性 4 项 checklist 判定（判定依据：控制点名称/控制描述/控制方式/控制频率/责任部门） */
  function checkDesign(cp) {
    var text = [cp.name, cp.design, cp.method, cp.freq, cp.flow, cp.dept].join(' ');
    var res = IC.KB.designChecks.map(function (c) {
      var hit = false;
      var used = '';
      for (var i = 0; i < c.hit.length; i++) {
        if (text.indexOf(c.hit[i]) >= 0) { hit = true; used = c.hit[i]; break; }
      }
      return { key: c.key, name: c.name, pass: hit, hitWord: used };
    });
    // 不设宽松兜底：四项 checklist 必须由控制点描述自身满足，避免「一刀切判有效/无效」
    var freqIdx = res.findIndex(function (r) { return r.key === 'owner'; });
    if (freqIdx >= 0 && !res[freqIdx].pass) {
      if (!U.isEmpty(cp.freq) && !U.isEmpty(cp.dept)) { res[freqIdx].pass = true; res[freqIdx].hitWord = '责任部门+频率'; }
    }
    if (freqIdx >= 0 && !res[freqIdx].pass) {
      if (!U.isEmpty(cp.dept) && !U.isEmpty(cp.method)) { res[freqIdx].pass = true; res[freqIdx].hitWord = '责任部门'; }
    }
    var passCount = res.filter(function (r) { return r.pass; }).length;
    return { items: res, pass: passCount === res.length, passCount: passCount, total: res.length };
  }

  /** 运行有效性 3 项 checklist 判定 */
  function checkOperating(rec) {
    if (!rec) return { items: [], pass: null, missing: true, passCount: 0, total: 3 };
    var ev = String(rec.evidence || '');
    var dev = String(rec.deviation || '');
    var both = ev + ' ' + dev;

    // 1) 按期执行：证据描述显示按期执行；出现「未按期/逾期/未执行/尚未整改」等否定即不通过
    var c1 = { key: 'ontime', name: '按期执行', pass: false, hitWord: '' };
    var negOnTime = '';
    ['未按期', '未按时', '未执行', '逾期', '未开展', '未按设定', '尚未整改', '未整改', '未完成整改', '整改中', '已提出'].forEach(function (k) {
      if (!negOnTime && both.indexOf(k) >= 0) negOnTime = k;
    });
    var posOnTime = '';
    // 「未按期 / 逾期 / 未执行」等否定词已在上面 negOnTime 统一识别，
    // 此处只需确认文本中存在正面表述（按期、按时、已开展、已执行、已实施、均按、每笔/每月…）
    var posPatterns = [
      { re: /(按期|按时)/, word: '按期' },
      { re: /已开展/, word: '已开展' },
      { re: /已执行/, word: '已执行' },
      { re: /已实施/, word: '已实施' },
      { re: /(均按|每笔|每月|每季|每年|每日|每周)/, word: '执行记录' }
    ];
    for (var i = 0; i < posPatterns.length; i++) {
      if (posPatterns[i].re.test(both)) { posOnTime = posPatterns[i].word; break; }
    }
    if (U.isEmpty(ev)) {
      c1.pass = false;
    } else if (negOnTime) {
      c1.pass = false;
      c1.hitWord = negOnTime;
    } else if (posOnTime) {
      c1.pass = true;
      c1.hitWord = posOnTime;
    } else {
      c1.pass = false;
    }

    // 2) 有执行证据：证据描述包含可核查痕迹关键词，且未出现「无证据/未留/缺失」等否定
    var c2 = { key: 'evidence', name: '有执行证据', pass: false, hitWord: '' };
    var negEv = '';
    ['无证据', '没有证据', '未留档', '未留存', '缺失', '无留痕', '无痕迹', '无记录', '无归档', '未附', '未提供',
      '未编制', '仅通过', '未建立', '未形成'].forEach(function (k) {
      if (!negEv && ev.indexOf(k) >= 0) negEv = k;
    });
    var posEv = '';
    ['审批单', '复核记录', '对账单', '盘点表', '系统日志', '签批', '归档', '留痕', '留档', '凭证', '台账', '截图',
      '底稿', '清单', '报告', '记录', '单据', '系统'].forEach(function (k) {
      if (!posEv && ev.indexOf(k) >= 0) posEv = k;
    });
    if (!posEv) {
      c2.pass = false;
    } else if (negEv) {
      c2.pass = false;
      c2.hitWord = negEv;
    } else {
      c2.pass = true;
      c2.hitWord = posEv;
    }

    // 3) 偏差未出现或已整改（确定性优先级：未整改/整改中 → 不通过；已整改/已闭环 → 通过；明确无偏差 → 通过）
    var c3 = { key: 'deviation', name: '偏差未出现或已整改', pass: false, hitWord: '' };
    var openDev = '';
    ['尚未整改', '未整改', '未完成整改', '整改中', '待整改', '逾期未整改', '未闭环'].forEach(function (k) {
      if (!openDev && both.indexOf(k) >= 0) openDev = k;
    });
    var fixedWord = '';
    ['已整改', '整改完成', '已完成整改', '已闭环', '已纠正', '均已整改'].forEach(function (k) {
      if (!fixedWord && both.indexOf(k) >= 0) fixedWord = k;
    });
    var noDevWord = '';
    ['无偏差', '无异常', '未见异常'].forEach(function (k) {
      if (!noDevWord && dev.indexOf(k) >= 0) noDevWord = k;
    });
    if (U.isEmpty(dev)) {
      c3.pass = false;              // 偏差情况未填 → 不能假定没有偏差
    } else if (openDev) {
      c3.pass = false;
      c3.hitWord = openDev;
    } else if (fixedWord) {
      c3.pass = true;
      c3.hitWord = fixedWord;
    } else if (noDevWord) {
      c3.pass = true;
      c3.hitWord = noDevWord;
    } else {
      c3.pass = false;
    }

    var items = [c1, c2, c3];
    var passCount = items.filter(function (x) { return x.pass; }).length;
    return { items: items, pass: passCount === items.length, passCount: passCount, total: 3, missing: false };
  }

  /** 判定「证据不足」：自评记录缺失，或自评结论/证据明确表示待补充 */
  function isInsufficient(rec) {
    if (!rec) return { ins: true, why: '自评表未提供该控制点的自评记录，无法取得执行证据' };
    var ev = String(rec.evidence || '');
    var concl = String(rec.concl || '');
    var all = ev + ' ' + concl + ' ' + String(rec.deviation || '');
    // 仅「待补充 / 证据不足 / 无法判定」类表述判为证据不足；
    // 「未提供」等词若同时指向实际掌握的证据对象（审批单/记录/台账等），说明问题本身已被证实，
    // 应判「无效」而非「证据不足」（不编造，也不掩盖已知问题）
    var insWords = ['证据不足', '无法判定', '待补充', '待补材料', '资料不全', '未取得', '待补充材料'];
    for (var i = 0; i < insWords.length; i++) {
      if (all.indexOf(insWords[i]) >= 0) {
        return { ins: true, why: '自评表标注「' + insWords[i] + '」，关键执行证据缺失' };
      }
    }
    if (U.isEmpty(ev)) return { ins: true, why: '自评表未填报执行证据说明，无法判定运行有效性' };
    return { ins: false, why: '' };
  }

  /**
   * 逐点评估主函数
   * @param {Array} points 归一化控制点（含 rec 关联的自评记录）
   * @param {Object} params
   * @param {Object} opts { base: 'rule'|'llm' }
   */
  IC.evaluatePoints = function (points, params, opts) {
    var o = opts || {};
    var base = o.base === 'llm' ? 'llm' : 'rule';
    return points.map(function (pt) {
      var cp = pt.control || pt;
      var rec = pt.selfassessment || null;
      var design = checkDesign(cp);
      var ins = isInsufficient(rec);
      var run = checkOperating(rec);

      var designResult = design.pass ? '有效' : '无效';
      var runResult;
      var conclusion;
      var reasonBits = [];

      if (design.pass) {
        reasonBits.push('设计有效（' + design.passCount + '/' + design.total + ' 项 checklist 全部满足）');
      } else {
        var failed = design.items.filter(function (x) { return !x.pass; }).map(function (x) { return x.name; });
        reasonBits.push('设计无效（缺少：' + failed.join('、') + '）');
      }

      if (ins.ins) {
        runResult = '证据不足';
        reasonBits.push(ins.why);
      } else if (run.pass) {
        runResult = '有效';
        reasonBits.push('运行有效（按期执行、有证据、无未整改偏差）');
      } else {
        runResult = '无效';
        var rfail = run.items.filter(function (x) { return !x.pass; });
        var rwords = rfail.map(function (x) { return x.name + (x.hitWord ? '（' + x.hitWord + '）' : ''); });
        reasonBits.push('运行无效：' + rwords.join('、') + ' 未通过');
      }

      if (designResult === '有效' && runResult === '有效') conclusion = '有效';
      else if (designResult === '无效' || runResult === '无效') conclusion = '无效';
      else conclusion = '证据不足';  // 设计有效 + 运行证据不足

      // 有效性得分（评分用）
      var score;
      if (designResult === '有效' && runResult === '有效') score = 1;
      else if (designResult === '无效' && runResult === '无效') score = 0;
      else if (runResult === '证据不足') score = designResult === '有效' ? 0.5 : 0; // 证据不足保守计 0.5/0
      else score = 0.5;

      // 计入分母规则：证据不足且设计无效 → 视为无效计入；证据不足但设计有效 → 计入分母（得分 0.5，保守）
      var counted = true;

      return {
        id: cp.id,
        name: cp.name,
        flow: cp.flow,
        risk: cp.risk || '中',
        dept: cp.dept,
        method: cp.method,
        freq: cp.freq,
        design: cp.design,
        designResult: designResult,
        designChecklist: design.items,
        operatingResult: runResult,
        operatingChecklist: run.items,
        conclusion: conclusion,
        score: score,
        counted: counted,
        reason: reasonBits.join('；'),
        reasonBase: base,
        evidence: rec ? rec.evidence : '',
        deviation: rec ? rec.deviation : '',
        person: rec ? rec.person : '',
        date: rec ? rec.date : '',
        selfConcl: rec ? rec.concl : '',
        hasSelf: !!rec,
        defectIds: [],
        defectId: '',
        level: '无',
        pending: conclusion === '证据不足',
        pendingReason: conclusion === '证据不足' ? ins.why : ''
      };
    });
  };

  /* ==========================================================================
   * 三、缺陷识别 · 三级分类 · 根因合并
   * ====================================================================== */

  /** 生成候选缺陷：无效控制点 → 候选；缺陷记录表 → 合并挂接或独立成条 */
  function buildCandidates(points, records, params) {
    var cands = [];
    var byId = {};
    points.forEach(function (p) { byId[p.id] = p; });

    // 第一阶段：从所有「无效」控制点生成自动候选（必须先全部生成，
    // 否则缺陷记录表在处理时可能还看不到后续控制点的自动候选，导致挂接失败、缺陷重复计数）
    points.forEach(function (p) {
      if (p.conclusion !== '无效') return;
      var nature = (p.designResult === '无效' && p.operatingResult === '无效')
        ? '设计+运行缺陷'
        : (p.designResult === '无效' ? '设计缺陷' : '运行缺陷');
      // 归因口径：缺陷证据（自评证据 + 偏差情况）优先，其次按控制点名称/流程主题归类；
      // 不把「控制描述（应然状态）」与 checklist 判定理由纳入归因，避免把制度健全的控制点误判为「制度缺失」
      var evidenceText = [p.evidence, p.deviation, p.note || ''].join(' ');
      var topicText = [p.name, p.flow].join(' ');
      var rc = IC.KB.classifyRootCause(evidenceText, topicText);
      var rlText = [p.name, p.evidence, p.deviation].join(' ');
      cands.push({
        source: 'auto',
        cpIds: [p.id],
        flows: [p.flow],
        depts: [p.dept],
        names: [p.name],
        desc: '',
        amount: 0,
        times: 1,
        findSource: '自评',
        date: p.date,
        nature: nature,
        rootCause: rc,
        // 定性红线只在「缺陷证据（自评证据/偏差）」中识别；缺陷记录表的红线在 3.2 中叠加
        redlines: IC.KB.matchRedlines(rlText),
        texts: [evidenceText, topicText],
        designFailed: p.designResult === '无效',
        operFailed: p.operatingResult === '无效',
        detail: []
      });
    });

    // 3.2 合并缺陷记录表（按「根因标签 + 控制点重合」挂到自动候选上，否则独立成条）
    //     挂接时合并后的缺陷沿用同一根因标签，因此一条缺陷记录至多挂接一条自动候选；
    //     其余涉及同一控制点的自动候选保持独立（体现「不同根因不合并」的口径）。
    (records || []).forEach(function (rec) {
      var validCps = (rec.cps || []).filter(function (id) { return !!byId[id]; });
      var text = [rec.desc, rec.redline, rec.rootCause].join(' ');
      var rl = IC.KB.matchRedlines(rec.redline || '');
      IC.KB.matchRedlines(text).forEach(function (r) {
        if (!rl.some(function (x) { return x.id === r.id; })) rl.push(r);
      });
      // 优先使用缺陷记录表显式给出的根因标签作为归因提示（保证用户登记口径不被通用词覆盖）
      var hint = rec.rootCause || '';
      var evidenceText = [rec.desc, rec.redline].join(' ');
      var rc = IC.KB.classifyRootCause(evidenceText, '', hint);

      // 挂接规则（确定性）：
      //   ① 根因标签一致 且 控制点重合 → 直接挂接；
      //   ② 否则若存在「同一控制点、且根因为通用执行类（RC06 执行偏差 / RC07 执行不到位）」的自动候选，
      //      则视为同一条缺陷（缺陷记录表给出的是更具体的根因，以记录为准），避免同一问题被重复计数。
      var GENERIC = { 'RC06': 1, 'RC07': 1 };
      var target = null;
      cands.forEach(function (c) {
        if (c.source !== 'auto') return;
        if (c.rootCause.code !== rc.code) return;
        if (validCps.some(function (id) { return c.cpIds.indexOf(id) >= 0; })) {
          if (!target) target = c;
        }
      });
      if (!target) {
        cands.forEach(function (c) {
          if (target || c.source !== 'auto') return;
          if (!GENERIC[c.rootCause.code]) return;
          if (c.recordCps && c.recordCps.length) return;
          if (validCps.some(function (id) { return c.cpIds.indexOf(id) >= 0; })) target = c;
        });
      }

      if (target) {
        target.source = 'auto+record';
        // 有缺陷记录时：描述与根因以记录为准（记录是缺陷本身的事实表述，且根因更具体）
        target.desc = rec.desc;
        target.rootCause = rc;
        target.amount = Math.max(target.amount, rec.amount || 0);
        target.times = Math.max(target.times, rec.times || 1);
        target.findSource = rec.source || target.findSource;
        target.date = target.date || rec.date;
        target.recordCps = (target.recordCps || []).concat(rec.cps || []);
        target.recordDesc = (target.recordDesc || []).concat([rec.desc]);
        target.redlines = mergeRedlines(target.redlines, rl);
      } else {
        var dept = validCps.map(function (id) { return byId[id].dept; });
        var flow = validCps.map(function (id) { return byId[id].flow; });
        cands.push({
          source: 'record',
          cpIds: validCps.slice(),
          flows: flow,
          depts: dept,
          names: validCps.map(function (id) { return byId[id].name; }),
          desc: rec.desc,
          descFromAuto: false,
          amount: rec.amount || 0,
          times: rec.times || 1,
          findSource: rec.source || '自评',
          date: rec.date,
          nature: '运行缺陷',
          rootCause: rc,
          redlines: rl,
          texts: [text],
          designFailed: false,
          operFailed: true,
          detail: [],
          recordCps: rec.cps || [],
          recordDesc: [rec.desc]
        });
      }
    });

    return cands;
  }

  function mergeRedlines(a, b) {
    var out = (a || []).slice();
    (b || []).forEach(function (r) {
      if (!out.some(function (x) { return x.id === r.id; })) out.push(r);
    });
    // 保持红线清单固定顺序，确保可复现
    var order = {};
    IC.KB.redlines.forEach(function (r, i) { order[r.id] = i; });
    out.sort(function (x, y) { return (order[x.id] || 0) - (order[y.id] || 0); });
    return out;
  }

  /** 根因聚类：根因标签 + 责任部门 + 流程 相同 → 合并 */
  function cluster(cands) {
    var groups = [];
    var map = {};
    cands.forEach(function (c) {
      var dept = pickMost(c.depts) || '未指定部门';
      var flow = pickMost(c.flows) || '未指定流程';
      var key = c.rootCause.code + '|' + dept + '|' + flow;
      if (!map[key]) {
        map[key] = { key: key, rc: c.rootCause, dept: dept, flow: flow, items: [] };
        groups.push(map[key]);
      }
      map[key].items.push(c);
    });
    return groups;
  }

  function pickMost(arr) {
    if (!arr || !arr.length) return '';
    var cnt = {}, best = arr[0], bestN = 0;
    arr.forEach(function (x) {
      var k = String(x || '');
      cnt[k] = (cnt[k] || 0) + 1;
      if (cnt[k] > bestN) { bestN = cnt[k]; best = x; }
    });
    return best;
  }

  /** 风险值推导（确定性规则）：
   *  可能性 = 等级基础分（重大 5 / 重要 4 / 一般 3）+ 发生次数加分（≥3 次 +2，2 次 +1），上限 5
   *  影响程度 = 等级基础分（重大 5 / 重要 4 / 一般 3）− 1 + 影响范围加分（涉及 ≥5 点 +3，≥3 点 +2，否则 +1），上限 5
   *  风险值 R = 可能性 × 影响程度，区间 1–25
   */
  IC.riskValues = function (defect, pointsMap) {
    var lvl = defect.level;
    var lvlBase = lvl === '重大' ? 5 : (lvl === '重要' ? 4 : 3);
    var times = defect.times || 1;
    var f = times >= 3 ? 2 : (times >= 2 ? 1 : 0);
    var possibility = Math.min(5, lvlBase + f);
    if (possibility < 1) possibility = 1;
    var scope = defect.cpCount || 1;
    var s = scope >= 5 ? 3 : (scope >= 3 ? 2 : 1);
    var impact = Math.min(5, lvlBase - 1 + s);
    if (impact < 1) impact = 1;
    return { possibility: possibility, impact: impact, R: possibility * impact };
  };

  IC.riskBand = function (R) {
    if (R >= 15) return '高';
    if (R >= 7) return '中';
    return '低';
  };

  /** 缺陷危害排序权重（用于排序与「主缺陷」判断） */
  function severityScore(d) {
    return (IC.C.LEVEL_ORDER[d.level] || 0) * 1e12 + (d.amount || 0) * 1e5 + (d.cpCount || 0) * 1e3 + (d.times || 0);
  }

  /**
   * 缺陷识别与合并主函数
   * @param {Array} points  逐点评估结果
   * @param {Array} records 缺陷记录（已归一化）
   * @param {Object} params
   */
  IC.buildDefects = function (points, records, params) {
    var p = params || IC.params;
    var byId = {};
    points.forEach(function (x) { byId[x.id] = x; });

    var cands = buildCandidates(points, records, p);
    var groups = cluster(cands);
    var defects = [];

    groups.forEach(function (g) {
      // 合并前涉及的控制点（去重、按编号升序）
      var cpIds = U.uniq(g.items.reduce(function (acc, c) { return acc.concat(c.cpIds); }, [])).sort();
      var amount = g.items.reduce(function (m, c) { return Math.max(m, c.amount || 0); }, 0);
      var times = g.items.reduce(function (s, c) { return s + (c.times || 1); }, 0);
      var redlines = mergeRedlines([], g.items.reduce(function (acc, c) { return acc.concat(c.redlines); }, []));
      var natureSet = {};
      g.items.forEach(function (c) {
        c.nature.split('+').forEach(function (n) { natureSet[n] = 1; });
      });
      var nature = Object.keys(natureSet).sort(function (a, b) {
        // 固定顺序：设计在前，运行在后
        var ord = { '设计缺陷': 1, '运行缺陷': 2 };
        return (ord[a] || 9) - (ord[b] || 9);
      }).join('+');
      if (!nature) nature = '运行缺陷';

      var quantLevel = IC.quantLevel(amount, p);
      var redlineLevel = redlines.length ? '重大' : null;
      var finalLevel = redlineLevel ? IC.higherLevel(quantLevel, redlineLevel) : quantLevel;

      var desc = '';
      if (g.items.some(function (c) { return c.desc; })) {
        desc = g.items.filter(function (c) { return c.desc; })
          .sort(function (a, b) { return (b.amount || 0) - (a.amount || 0); })[0].desc;
      }
      var names = U.uniq(g.items.reduce(function (acc, c) { return acc.concat(c.names || []); }, []));
      var summary = desc || (g.rc.tag + '：' + (names.join('、') || cpIds.join('、')));

      defects.push({
        rootCauseCode: g.rc.code,
        rootCauseTag: g.rc.tag,
        rootCauseDesc: g.rc.desc,
        advice: g.rc.advice,
        flow: g.flow,
        dept: g.dept,
        cpIds: cpIds,
        cpCount: cpIds.length,
        names: names,
        summary: summary,
        desc: desc,
        nature: nature,
        amount: amount,
        times: times,
        findSource: pickMost(g.items.map(function (c) { return c.findSource; })) || '自评',
        date: pickMost(g.items.map(function (c) { return c.date; }).filter(Boolean)),
        quantLevel: quantLevel,
        redlines: redlines.map(function (r) { return r.name; }),
        redlineIds: redlines.map(function (r) { return r.id; }),
        redlineDetail: redlines,
        finalLevel: finalLevel,
        level: finalLevel,
        fromMergedCount: g.items.length,
        sources: U.uniq(g.items.map(function (c) { return c.source; })),
        designFailed: g.items.some(function (c) { return c.designFailed; }),
        operFailed: g.items.some(function (c) { return c.operFailed; }),
        texts: g.items.reduce(function (acc, c) { return acc.concat(c.texts); }, []),
        id: ''
      });
    });

    // 固定排序：等级降序 → 涉及金额降序 → 缺陷编号升序（编号后分配，先用稳定副键）
    defects.sort(function (a, b) {
      var la = IC.C.LEVEL_ORDER[a.level] || 0, lb = IC.C.LEVEL_ORDER[b.level] || 0;
      if (la !== lb) return lb - la;
      if (b.amount !== a.amount) return b.amount - a.amount;
      var ia = a.cpIds[0] || '', ib = b.cpIds[0] || '';
      return ia.localeCompare(ib);
    });
    // 分配编号 D-01…
    defects.forEach(function (d, i) {
      d.id = 'D-' + (i < 9 ? '0' + (i + 1) : (i + 1));
    });

    // 计算风险值 + 法规引用 + 内部制度引用
    defects.forEach(function (d) {
      var rv = IC.riskValues({ level: d.level, times: d.times, cpCount: d.cpCount }, byId);
      d.possibility = rv.possibility;
      d.impact = rv.impact;
      d.R = rv.R;
      d.riskBand = IC.riskBand(rv.R);
      d.weight = IC.defectWeight(d.level, p);
      d.weightedR = U.round(d.weight * d.R, 2);
      // 法规条款引用（按缺陷文本与根因检索，固定取前 3 条；命中的定性红线条款优先）
      var text4reg = [d.summary, d.rootCauseTag, d.rootCauseDesc, d.flow, d.redlines.join(' ')].join(' ');
      var regs = [];
      (d.redlineDetail || []).forEach(function (rl) {
        (rl.cite || []).forEach(function (id) {
          var reg = IC.KB.getReg(id);
          if (reg && !regs.some(function (x) { return x.id === reg.id; })) regs.push(reg);
        });
      });
      IC.KB.findRegulations(text4reg, { limit: 3 }).forEach(function (reg) {
        if (!regs.some(function (x) { return x.id === reg.id; })) regs.push(reg);
      });
      d.regs = regs.slice(0, 4);
    });

    // 反向挂接控制点 → 缺陷
    defects.forEach(function (d) {
      d.cpIds.forEach(function (id) {
        var pt = byId[id];
        if (!pt) return;
        pt.defectIds.push(d.id);
        pt.defectId = d.id;
        pt.level = d.level;
      });
    });

    return defects;
  };

  /* ==========================================================================
   * 四、加权评分 + 结论
   * ====================================================================== */
  IC.scoreAll = function (points, defects, params) {
    var p = params || IC.params;

    // 4.1 控制点部分
    var sumWeight = 0, sumWeighted = 0, countedCount = 0;
    var rows = points.map(function (pt) {
      var w = IC.cpWeight(pt.risk, p);
      var s = pt.counted ? pt.score : 0;
      var weighted = U.round(w * s, 4);
      if (pt.counted) { sumWeight += w; sumWeighted += weighted; countedCount++; }
      return {
        id: pt.id, name: pt.name, risk: pt.risk, weight: w, design: pt.designResult,
        operating: pt.operatingResult, score: s, weighted: weighted, counted: pt.counted,
        conclusion: pt.conclusion
      };
    });
    sumWeight = U.round(sumWeight, 4);
    sumWeighted = U.round(sumWeighted, 4);
    var weightedScore = sumWeight > 0 ? U.round(100 * sumWeighted / sumWeight, 2) : 0;

    // 4.2 缺陷部分
    var defectCount = defects.length;
    var sumWeightedR = U.round(defects.reduce(function (s, d) { return s + d.weight * d.R; }, 0), 4);
    var avgWeightedR = defectCount > 0 ? U.round(sumWeightedR / defectCount, 4) : 0;
    var deduct = defectCount > 0 ? U.round(avgWeightedR * p.defectFactor, 2) : 0;

    // 4.3 总分（先转为整数分值再看尾数，固定四舍五入，避免浮点误差）
    var totalRaw = weightedScore - deduct;
    var total = U.round(totalRaw, 2);

    var counts = { '重大': 0, '重要': 0, '一般': 0 };
    defects.forEach(function (d) { counts[d.level] = (counts[d.level] || 0) + 1; });

    // 4.4 结论：一票否决优先
    var majorDefects = defects.filter(function (d) { return d.level === '重大'; });
    var veto = majorDefects.length > 0;
    var verdict, verdictKey, verdictReason;
    if (veto) {
      verdict = '无效';
      verdictKey = 'invalid';
      verdictReason = '存在 ' + majorDefects.length + ' 项重大缺陷（' + majorDefects.map(function (d) { return d.id; }).join('、') +
        '），按一票否决规则判定为「无效」，不受加权总分高低影响。';
    } else if (total >= p.passLine) {
      verdict = '有效';
      verdictKey = 'valid';
      verdictReason = '不存在重大缺陷，且加权总分 ' + U.fix2(total) + ' ≥ 结论线 ' + p.passLine + '，判定为「有效」。';
    } else if (total >= p.basicLine) {
      verdict = '基本有效（需整改）';
      verdictKey = 'basic';
      verdictReason = '不存在重大缺陷，加权总分 ' + U.fix2(total) + ' 处于 ' + p.basicLine + '–' +
        U.fix2(p.passLine) + ' 区间，判定为「基本有效（需整改）」。';
    } else {
      verdict = '无效';
      verdictKey = 'invalid';
      verdictReason = '不存在重大缺陷，但加权总分 ' + U.fix2(total) + ' < ' + p.basicLine + '，判定为「无效」。';
    }

    // 4.5 评分过程（用于页面展示，逐步代入数值）
    var cpHigh = rows.filter(function (r) { return r.risk === '高'; });
    var cpMid = rows.filter(function (r) { return r.risk === '中'; });
    var cpLow = rows.filter(function (r) { return r.risk === '低'; });
    var zeroCount = rows.filter(function (r) { return r.score === 0; }).length;
    var halfCount = rows.filter(function (r) { return r.score === 0.5; }).length;
    var fullCount = rows.filter(function (r) { return r.score === 1; }).length;

    var steps = [
      {
        title: '第 1 步 · 控制点加权得分',
        body: 'Σ(控制点权重 × 有效性得分) = <span class="hl-blue">' + U.fix2(sumWeighted) + '</span>；' +
          'Σ控制点权重 = <span class="hl-blue">' + U.fix2(sumWeight) + '</span>；' +
          '加权得分 = 100 × ' + U.fix2(sumWeighted) + ' / ' + U.fix2(sumWeight) + ' = <span class="hl-blue">' + U.fix2(weightedScore) + '</span><br>' +
          '构成：高（权重 ' + p.cpWeightHigh + '）× ' + cpHigh.length + ' 个、中（权重 ' + p.cpWeightMid + '）× ' + cpMid.length +
          ' 个、低（权重 ' + p.cpWeightLow + '）× ' + cpLow.length + ' 个；有效性得分 1.0 共 ' + fullCount +
          ' 个、0.5 共 ' + halfCount + ' 个、0 共 ' + zeroCount + ' 个。'
      },
      {
        title: '第 2 步 · 缺陷条数与等级构成',
        body: '缺陷共 <span class="hl-blue">' + defectCount + '</span> 条：重大 ' + counts['重大'] + ' 条（权重 ' + p.weightMajor +
          '）、重要 ' + counts['重要'] + ' 条（权重 ' + p.weightImportant + '）、一般 ' + counts['一般'] + ' 条（权重 ' + p.weightGeneral + '）。<br>' +
          '权重关系校验：重大 ' + p.weightMajor + ' / 一般 ' + p.weightGeneral + ' = ' +
          (p.weightGeneral > 0 ? U.fix2(p.weightMajor / p.weightGeneral) : '—') + ' 倍（要求 ≥ 5 倍）。'
      },
      {
        title: '第 3 步 · 风险值与加权和',
        body: '每条缺陷风险值 R = 可能性（1–5）× 影响程度（1–5），区间 1–25；' +
          'Σ(缺陷权重 × R) = <span class="hl-blue">' + U.fix2(sumWeightedR) + '</span>。<br>' +
          (defectCount > 0
            ? defects.map(function (d) {
              return d.id + '=' + d.weight + '×' + d.R + '(' + d.possibility + '×' + d.impact + ')=' + U.fix2(d.weight * d.R);
            }).join('；')
            : '本次未识别缺陷，缺陷扣分为 0。')
      },
      {
        title: '第 4 步 · 缺陷扣分',
        body: '缺陷扣分 = Σ(缺陷权重 × R) ÷ 缺陷条数 × ' + p.defectFactor + ' = ' + U.fix2(sumWeightedR) +
          ' ÷ ' + defectCount + ' × ' + p.defectFactor + ' = <span class="hl">−' + U.fix2(deduct) + '</span>'
      },
      {
        title: '第 5 步 · 总分（固定四舍五入保留 2 位小数）',
        isFinal: true,
        body: '总分 = ' + U.fix2(weightedScore) + ' − ' + U.fix2(deduct) + ' = <span class="hl">' + U.fix2(total) + '</span>' +
          (Math.abs(totalRaw - total) > 1e-9 ? '（未舍入值 ' + totalRaw.toFixed(6) + '）' : '')
      },
      {
        title: '第 6 步 · 结论判定',
        isVerdict: true,
        body: '① 是否存在重大缺陷：<b>' + (veto ? '是（' + majorDefects.map(function (d) { return d.id; }).join('、') + '）' : '否') + '</b>；' +
          (veto ? '命中一票否决 → 结论 = <span class="hl">无效</span>' :
            '② 总分 ' + U.fix2(total) + ' 对比结论线：≥ ' + p.passLine + ' → 有效；' + p.basicLine + '–' +
            U.fix2(p.passLine - 0.01) + ' → 基本有效；< ' + p.basicLine + ' → 无效') + '<br>' +
          '最终结论：<b>' + verdict + '</b>'
      }
    ];

    return {
      cpRows: rows,
      params: U.clone(p),
      sumWeight: sumWeight,
      sumWeighted: sumWeighted,
      weightedScore: weightedScore,
      defectCount: defectCount,
      sumWeightedR: sumWeightedR,
      avgWeightedR: avgWeightedR,
      deduct: deduct,
      totalRaw: totalRaw,
      total: total,
      counts: counts,
      veto: veto,
      majorIds: majorDefects.map(function (d) { return d.id; }),
      verdict: verdict,
      verdictKey: verdictKey,
      verdictReason: verdictReason,
      steps: steps,
      cpMix: { high: cpHigh.length, mid: cpMid.length, low: cpLow.length }
    };
  };

  /* ==========================================================================
   * 五、一键全流程
   * ====================================================================== */
  /**
   * @param {Object} materials { controls, selfassessment, defects }
   * @param {Object} params
   * @param {Object} opts { allowPartial:boolean }
   * @returns {Object} result
   */
  IC.runAll = function (materials, params, opts) {
    var o = opts || {};
    var p = IC.sanitizeParams(params || IC.params);  // 评分口径始终使用当前生效参数（供 UI 传入）
    // 兼容两种输入：① 已归一化记录（cps 为数组）② 原始记录（cps 为字符串），统一归一化后再跑
    var cps = (materials.controls || []).map(function (c) {
      return {
        id: U.normCpId(c.id),
        name: U.clean(c.name),
        flow: U.clean(c.flow),
        risk: IC.normRisk(c.risk) || '中',
        dept: U.clean(c.dept),
        method: U.clean(c.method) || '人工',
        freq: U.clean(c.freq) || '按笔',
        design: U.clean(c.design),
        note: ''
      };
    });
    var sas = (materials.selfassessment || []).map(function (r) {
      return {
        cpId: U.normCpId(r.cpId),
        concl: U.clean(r.concl),
        evidence: U.clean(r.evidence),
        deviation: U.clean(r.deviation),
        person: U.clean(r.person),
        date: U.clean(r.date)
      };
    });
    var dfs = (materials.defects || []).map(function (d) {
      return {
        desc: U.clean(d.desc),
        cps: Array.isArray(d.cps) ? d.cps.map(U.normCpId) : U.splitIds(d.cps || d.cpsRaw),
        cpsRaw: U.clean(d.cpsRaw || d.cps),
        amount: typeof d.amount === 'number' ? d.amount : U.moneyWan(d.amount),
        amountRaw: U.clean(d.amountRaw || d.amount),
        times: U.num(d.times, 1) || 1,
        source: U.clean(d.source) || '自评',
        date: U.clean(d.date),
        redline: U.clean(d.redline),
        rootCause: U.clean(d.rootCause)
      };
    });

    // 建立控制点 → 自评记录 映射（同一控制点多条时取最后一条，与校验提示一致）
    var recMap = {};
    sas.forEach(function (r) {
      if (r && r.cpId) recMap[r.cpId] = r;
    });

    var points = cps.map(function (cp) {
      return { control: cp, selfassessment: recMap[cp.id] || null };
    });
    var flat = IC.evaluatePoints(points, p, { base: o.base || 'rule' });
    var defects = IC.buildDefects(flat, dfs, p);
    var score = IC.scoreAll(flat, defects, p);

    var validCount = flat.filter(function (x) { return x.conclusion === '有效'; }).length;
    var invalidCount = flat.filter(function (x) { return x.conclusion === '无效'; }).length;
    var insuffCount = flat.filter(function (x) { return x.conclusion === '证据不足'; }).length;
    var standard = IC.C.STANDARD_CP_COUNT;
    var coverage = standard > 0 ? U.round(flat.length * 100 / standard, 1) : 0;
    var coveredRatio = flat.length > 0 ? U.round(flat.length * 100 / standard, 1) : 0;

    var pending = flat.filter(function (x) { return x.pending; }).map(function (x) {
      return { id: x.id, name: x.name, dept: x.dept, reason: x.pendingReason };
    });

    return {
      at: U.nowStamp(),
      base: o.base || 'rule',
      params: U.clone(p),
      points: flat,
      defects: defects,
      score: score,
      stats: {
        cpCount: flat.length,
        standard: standard,
        coverage: coveredRatio,
        selfCount: sas.filter(function (r) { return r && r.cpId; }).length,
        defectRecordCount: dfs.length,
        validCount: validCount,
        invalidCount: invalidCount,
        insuffCount: insuffCount,
        pendingCount: pending.length,
        missingCp: Math.max(0, standard - flat.length),
        noSelf: flat.filter(function (x) { return !x.hasSelf; }).length
      },
      pending: pending,
      warnings: buildWarnings(flat, defects, score, o)
    };
  };

  function buildWarnings(flat, defects, score, o) {
    var w = [];
    if (flat.length < IC.C.STANDARD_CP_COUNT) {
      w.push({
        level: 'warn',
        msg: '控制点覆盖率 ' + U.fix2(coveredRatioOf(flat.length)) + '%（' + flat.length + ' / ' + IC.C.STANDARD_CP_COUNT +
          '）：当前导入 ' + flat.length + ' 个控制点，标准口径为 ' +
          IC.C.STANDARD_CP_COUNT + ' 个，缺少 ' + (IC.C.STANDARD_CP_COUNT - flat.length) +
          ' 个。结论仅供参考，不可作为年度正式评价报告。'
      });
    }
    if (!defects.length) {
      w.push({
        level: 'warn',
        msg: '本次评估未发现缺陷，结论可判「有效」，但请确认自评表是否完整填报（尤其执行证据列），避免因填报不完整掩盖问题。'
      });
    }
    var noSelf = flat.filter(function (x) { return !x.hasSelf; });
    if (noSelf.length) {
      w.push({
        level: 'warn',
        msg: noSelf.length + ' 个控制点在自评表中没有对应记录（' + noSelf.slice(0, 6).map(function (x) { return x.id; }).join('、') +
          (noSelf.length > 6 ? ' 等' : '') + '），已判为「证据不足」并计入待补清单，未假定为已执行。'
      });
    }
    var insuff = flat.filter(function (x) { return x.conclusion === '证据不足'; });
    if (insuff.length) {
      w.push({
        level: 'warn',
        msg: insuff.length + ' 个控制点证据不足，已在评估表中高亮并列入待补清单；补齐证据前不建议出具最终结论。'
      });
    }
    return w;
  }

  function coveredRatioOf(n) {
    return IC.C.STANDARD_CP_COUNT > 0 ? U.round(n * 100 / IC.C.STANDARD_CP_COUNT, 1) : 0;
  }
  IC.coveredRatio = coveredRatioOf;

})(typeof window !== 'undefined' ? window : this);
