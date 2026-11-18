/* =============================================================================
 * 05-llm.js — 大模型（deepseek-flash）调用层
 *   · 配置：localStorage 持久化，默认教学测试密钥
 *   · 调用：POST {BaseURL}/v1/chat/completions，temperature 固定 0.1，max_tokens 2048
 *   · 增强：只生成「判定依据一句话 / 缺陷根因摘要 / 结论措辞」，
 *           ★ 任何等级判定与评分一律以规则引擎为准，模型返回与之冲突时以规则为准
 *   · 降级：401 / 429 / 超时 / 网络错误 / CORS → 提示并切换为规则引擎结果，结论与评分不受影响
 *   · 日志：每次调用写入 useractivity.log 记录（可在「操作日志」中查看与下载）
 * ========================================================================== */
(function (global) {
  'use strict';
  var IC = global.IC;
  var U = IC.U;

  var LLM = IC.LLM = {};

  /* ------------------------------------------------------------ 配置存取 */
  LLM.getConfig = function () {
    var d = IC.C.DEFAULT_LLM;
    var saved = IC.LS.get(IC.C.LS.cfg, null) || {};
    var cfg = {
      provider: typeof saved.provider === 'string' && saved.provider ? saved.provider : d.provider,
      model: typeof saved.model === 'string' && saved.model ? saved.model : d.model,
      apiKey: typeof saved.apiKey === 'string' ? saved.apiKey : d.apiKey,
      baseUrl: normalizeBase(saved.baseUrl || d.baseUrl),
      temperature: typeof saved.temperature === 'number' ? saved.temperature : d.temperature,
      maxTokens: d.maxTokens
    };
    return cfg;
  };

  LLM.saveConfig = function (cfg) {
    var out = {
      provider: U.clean(cfg.provider) || IC.C.DEFAULT_LLM.provider,
      model: U.clean(cfg.model) || IC.C.DEFAULT_LLM.model,
      apiKey: String(cfg.apiKey || '').trim(),
      baseUrl: normalizeBase(cfg.baseUrl),
      temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.1,
      savedAt: U.nowStamp()
    };
    IC.LS.set(IC.C.LS.cfg, out);
    return out;
  };

  function normalizeBase(url) {
    var s = U.clean(url || IC.C.DEFAULT_LLM.baseUrl).replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    // 用户可能填了完整的 /v1/chat/completions，统一截断成 base
    s = s.replace(/\/v1\/chat\/completions$/i, '').replace(/\/v1$/i, '');
    return s;
  }
  LLM.normalizeBase = normalizeBase;

  /** 当前是否「教学测试密钥」 */
  LLM.isTeachingKey = function (cfg) {
    var c = cfg || LLM.getConfig();
    return !!c.apiKey && c.apiKey === IC.C.DEFAULT_LLM.apiKey;
  };

  LLM.endpoint = function (baseUrl) {
    return normalizeBase(baseUrl) + '/v1/chat/completions';
  };

  /** 当前配置摘要（用于界面展示，Key 打码） */
  LLM.describe = function (cfg) {
    var c = cfg || LLM.getConfig();
    return {
      provider: c.provider,
      model: c.model,
      baseUrl: c.baseUrl,
      maskedKey: U.maskKey(c.apiKey),
      isTeaching: LLM.isTeachingKey(c),
      temperature: c.temperature
    };
  };

  /* ------------------------------------------------------------ 日志 */
  LLM.log = function (entry) {
    try {
      var arr = IC.LS.get(IC.C.LS.log, []);
      if (!Array.isArray(arr)) arr = [];
      arr.push({
        at: U.nowStamp(),
        type: entry.type || 'llm',
        action: entry.action || '',
        input: entry.input || '',
        output: entry.output || '',
        expected: entry.expected === undefined ? '—' : (entry.expected ? '是' : '否'),
        extra: entry.extra || ''
      });
      // 只保留最近 500 条，避免占满本地存储
      if (arr.length > 500) arr = arr.slice(arr.length - 500);
      IC.LS.set(IC.C.LS.log, arr);
    } catch (e) { /* 日志失败不影响主流程 */ }
  };

  LLM.getLogs = function () {
    var arr = IC.LS.get(IC.C.LS.log, []);
    return Array.isArray(arr) ? arr : [];
  };

  LLM.clearLogs = function () {
    IC.LS.set(IC.C.LS.log, []);
  };

  /** 导出 useractivity.log 文本（提示词要求写入 useractivity.log） */
  LLM.buildLogText = function () {
    var arr = LLM.getLogs();
    var lines = ['# useractivity.log — 内部控制智能体操作日志', '# 生成时间：' + U.nowStamp(), '# 格式：时间 | 类型 | 动作 | 输入摘要 | 输出摘要 | 是否达成预期 | 备注'];
    arr.forEach(function (e) {
      lines.push([e.at, e.type, e.action, oneLine(e.input), oneLine(e.output), e.expected, oneLine(e.extra)].join(' | '));
    });
    return lines.join('\n');
  };

  function oneLine(s) {
    return String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').slice(0, 220);
  }

  /* ------------------------------------------------------------ 调用 */
  /**
   * 通用 chat 调用
   * @param {Array} messages [{role, content}]
   * @param {Object} opts { timeout:ms, json:boolean }
   * @returns {Promise<{ok:boolean, content:string, code:string, error:string, ms:number}>}
   */
  LLM.chat = function (messages, opts) {
    var o = opts || {};
    var cfg = LLM.getConfig();
    var timeout = o.timeout || 30000;
    var started = Date.now();

    return new Promise(function (resolve) {
      if (!cfg.apiKey) {
        resolve({ ok: false, code: 'NO_KEY', error: '未填写 API Key', ms: 0 });
        return;
      }
      if (typeof global.fetch !== 'function') {
        resolve({ ok: false, code: 'NO_FETCH', error: '当前浏览器不支持 fetch', ms: 0 });
        return;
      }
      var payload = {
        model: cfg.model,
        messages: messages,
        temperature: 0.1,          // 固定 0.1，保证可复现
        max_tokens: cfg.maxTokens || 2048,
        stream: false
      };
      if (o.json) payload.response_format = { type: 'json_object' };

      var ctrl = null;
      try { ctrl = new global.AbortController(); } catch (e) { ctrl = null; }
      var timer = global.setTimeout(function () {
        try { if (ctrl) ctrl.abort(); } catch (e) {}
      }, timeout);

      var init = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + cfg.apiKey
        },
        body: JSON.stringify(payload)
      };
      if (ctrl) init.signal = ctrl.signal;

      global.fetch(LLM.endpoint(cfg.baseUrl), init).then(function (resp) {
        global.clearTimeout(timer);
        var ms = Date.now() - started;
        if (!resp.ok) {
          var code = resp.status;
          var msg = 'HTTP ' + code;
          if (code === 401) msg = '鉴权失败（401），可能是 API Key 无效或已过期';
          else if (code === 429) msg = '调用频率超限或余额不足（429）';
          else if (code === 404) msg = '接口地址不存在（404），请检查 Base URL 是否为 https://api.deepseek.com';
          return resp.text().then(function (t) {
            resolve({ ok: false, code: String(code), error: msg, detail: String(t || '').slice(0, 300), ms: ms });
          }).catch(function () {
            resolve({ ok: false, code: String(code), error: msg, ms: ms });
          });
        }
        return resp.json().then(function (data) {
          var content = '';
          try {
            content = data.choices[0].message.content || '';
          } catch (e) { content = ''; }
          resolve({ ok: true, code: '200', content: content, raw: data, ms: Date.now() - started });
        }).catch(function (e) {
          resolve({ ok: false, code: 'PARSE', error: '响应解析失败：' + e.message, ms: Date.now() - started });
        });
      }).catch(function (err) {
        global.clearTimeout(timer);
        var name = err && err.name ? err.name : '';
        var msg = name === 'AbortError'
          ? '调用超时（' + Math.round(timeout / 1000) + ' 秒未响应）'
          : '网络或跨域（CORS）错误：' + (err && err.message ? err.message : '未知错误');
        resolve({ ok: false, code: name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', error: msg, ms: Date.now() - started });
      });
    });
  };

  /** 解析 JSON（容忍 ```json 包裹） */
  LLM.parseJson = function (text) {
    if (!text) return null;
    var s = String(text).replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(s); } catch (e) { /* 继续尝试截取 */ }
    var i = s.indexOf('{'), j = s.lastIndexOf('}');
    if (i >= 0 && j > i) {
      try { return JSON.parse(s.slice(i, j + 1)); } catch (e2) { /* ignore */ }
    }
    return null;
  };

  /* ------------------------------------------------------------ 提示词 */
  var SYS_BASE = [
    '你是华诚集团内部控制评价智能体的文字辅助模块，只做文本归纳与措辞润色。',
    '硬性约束：① 等级判定、金额阈值、评分与结论一律由系统规则引擎决定，你不得给出或修改任何等级/分数/结论；',
    '② 不得编造自评表与控制点清单中不存在的事实、金额、数据或条款号；',
    '③ 输出必须是严格 JSON，不要输出 JSON 之外的解释文字；',
    '④ 语言为简体中文，商务书面语，单句不超过 60 字。'
  ].join('\n');

  /**
   * 语义增强：批量生成判定依据（每批≤12 个控制点，控制 token）
   * @param {Array} batch [{id, name, design, evidence, deviation, designResult, operatingResult, conclusion}]
   * @returns Promise<{ok, map, error}>
   */
  LLM.reasonBatch = function (batch) {
    var lines = batch.map(function (p, i) {
      return (i + 1) + '. 编号:' + p.id + '；名称:' + p.name +
        '；控制描述:' + trunc(p.design, 90) +
        '；自评证据:' + trunc(p.evidence, 110) +
        '；偏差与整改:' + trunc(p.deviation, 60) +
        '；系统已判定:设计' + p.designResult + '/运行' + p.operatingResult + '/综合' + p.conclusion;
    }).join('\n');
    var msgs = [
      { role: 'system', content: SYS_BASE },
      {
        role: 'user',
        content: '以下是内控自评控制点及其系统判定结果。请为每个控制点生成一句「判定依据」（不超过 55 字，说明为何该判定成立，须基于给出的自评证据，不得新增事实）。\n' +
          '只输出 JSON：{"items":[{"id":"C-001","reason":"……"}]}\n\n' + lines
      }
    ];
    var started = Date.now();
    return LLM.chat(msgs, { timeout: 40000, json: true }).then(function (r) {
      var map = {};
      if (r.ok) {
        var data = LLM.parseJson(r.content);
        if (data && Array.isArray(data.items)) {
          data.items.forEach(function (it) {
            if (it && it.id && it.reason) map[U.normCpId(it.id)] = String(it.reason).replace(/\s+/g, ' ').slice(0, 120);
          });
        }
      }
      LLM.log({
        type: 'llm',
        action: '语义增强·判定依据生成（' + batch.length + ' 个控制点）',
        input: batch.map(function (p) { return p.id; }).join('、'),
        output: r.ok ? ('返回 ' + Object.keys(map).length + ' 条判定依据') : ('失败：' + r.code + ' ' + r.error),
        expected: r.ok ? Object.keys(map).length > 0 : false,
        extra: '耗时 ' + (Date.now() - started) + 'ms · model=' + LLM.getConfig().model
      });
      return { ok: r.ok && Object.keys(map).length > 0, map: map, error: r.ok ? '' : (r.code + ' ' + r.error) };
    });
  };

  /** 缺陷根因摘要润色 + 整改建议补充（每条缺陷一次调用，失败即降级） */
  LLM.defectText = function (defect) {
    var msgs = [
      { role: 'system', content: SYS_BASE },
      {
        role: 'user',
        content: '请为下面这条内控缺陷生成「根因摘要」与「整改建议」两句文字。等级已由系统判定为「' + defect.level + '」，你不得改变或评论该等级。\n' +
          '只输出 JSON：{"summary":"……","advice":"……"}\n\n' +
          '缺陷编号:' + defect.id + '\n根因标签:' + defect.rootCauseTag + '\n关联控制点:' + defect.cpIds.join('、') + '\n' +
          '责任部门:' + defect.dept + '\n所属流程:' + defect.flow + '\n涉及金额(万元):' + defect.amount + '\n' +
          '定额等级:' + defect.quantLevel + '\n定性红线:' + (defect.redlines.join('、') || '无') + '\n' +
          '缺陷描述:' + trunc(defect.summary, 160)
      }
    ];
    var started = Date.now();
    return LLM.chat(msgs, { timeout: 25000, json: true }).then(function (r) {
      var out = { ok: false };
      if (r.ok) {
        var d = LLM.parseJson(r.content);
        if (d && d.summary) {
          out = {
            ok: true,
            summary: String(d.summary).replace(/\s+/g, ' ').slice(0, 90),
            advice: String(d.advice || '').replace(/\s+/g, ' ').slice(0, 160)
          };
        }
      }
      LLM.log({
        type: 'llm',
        action: '语义增强·缺陷根因摘要与整改建议（' + defect.id + '）',
        input: trunc(defect.summary, 80),
        output: out.ok ? (out.summary + '｜' + out.advice) : ('失败：' + r.code + ' ' + (r.error || '无有效 JSON')),
        expected: out.ok,
        extra: '耗时 ' + (Date.now() - started) + 'ms'
      });
      return out;
    });
  };

  /** 结论措辞润色（只润色文字，不改结论与分数） */
  LLM.conclusionText = function (ctx) {
    var msgs = [
      { role: 'system', content: SYS_BASE },
      {
        role: 'user',
        content: '请为华诚集团年度内控评价结论写一段 120–180 字的「评价意见」。结论已由规则引擎判定为「' + ctx.verdict +
          '」，总分 ' + ctx.total + '，重大缺陷 ' + ctx.major + ' 项、重要缺陷 ' + ctx.important + ' 项、一般缺陷 ' + ctx.general +
          ' 项，控制点 ' + ctx.cpCount + ' 个（有效 ' + ctx.valid + '、无效 ' + ctx.invalid + '、证据不足 ' + ctx.insuff + '）。' +
          '你不得改变结论与分数，不得新增事实。只输出 JSON：{"text":"……"}'
      }
    ];
    var started = Date.now();
    return LLM.chat(msgs, { timeout: 25000, json: true }).then(function (r) {
      var text = '';
      if (r.ok) {
        var d = LLM.parseJson(r.content);
        if (d && d.text) text = String(d.text).replace(/\s+/g, ' ').slice(0, 400);
      }
      LLM.log({
        type: 'llm',
        action: '语义增强·结论措辞润色',
        input: '结论=' + ctx.verdict + '；总分=' + ctx.total,
        output: text ? trunc(text, 100) : ('失败：' + r.code + ' ' + (r.error || '无有效 JSON')),
        expected: !!text,
        extra: '耗时 ' + (Date.now() - started) + 'ms'
      });
      return { ok: !!text, text: text };
    });
  };

  /** 连接测试 */
  LLM.testConnection = function (cfgOverride) {
    var cfg = cfgOverride ? null : LLM.getConfig();
    if (cfgOverride) {
      // 临时用传入的配置测试，不影响已保存配置
      var bak = IC.LS.get(IC.C.LS.cfg, null);
      IC.LS.set(IC.C.LS.cfg, {
        provider: cfgOverride.provider, model: cfgOverride.model,
        apiKey: cfgOverride.apiKey, baseUrl: normalizeBase(cfgOverride.baseUrl)
      });
      return doTest().then(function (r) {
        if (bak) IC.LS.set(IC.C.LS.cfg, bak); else IC.LS.del(IC.C.LS.cfg);
        return r;
      });
    }
    return doTest();

    function doTest() {
      var started = Date.now();
      return LLM.chat([
        { role: 'system', content: '你是连接测试助手。' },
        { role: 'user', content: '请只回复两个字符：正常' }
      ], { timeout: 20000 }).then(function (r) {
        LLM.log({
          type: 'llm',
          action: '连接测试',
          input: LLM.getConfig().model + ' @ ' + LLM.getConfig().baseUrl,
          output: r.ok ? ('连通，回复：' + trunc(r.content, 40)) : ('失败：' + r.code + ' ' + r.error),
          expected: r.ok,
          extra: '耗时 ' + (Date.now() - started) + 'ms'
        });
        return { ok: r.ok, message: r.ok ? ('连接成功（' + (Date.now() - started) + ' ms），模型可用。') : r.error, code: r.code };
      });
    }
  };

  function trunc(s, n) {
    var t = String(s || '').replace(/\s+/g, ' ');
    return t.length > n ? t.slice(0, n) + '…' : t;
  }
  LLM.trunc = trunc;

})(typeof window !== 'undefined' ? window : this);
