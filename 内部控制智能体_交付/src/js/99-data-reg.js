/* =============================================================================
 * 99-data-reg.js — 运行环境注册表与通用工具
 * 说明：本应用整体包在一个 IIFE 内（见根节点的拼接逻辑），所有模块按顺序内联。
 *       本模块定义全局命名空间 window.IC 与通用工具函数，不依赖任何其它模块。
 *       ★ 关键设计：应用脚本统一运行在函数作用域内，不污染 window 全局。
 * ========================================================================== */
(function (global) {
  'use strict';

  var IC = global.IC = global.IC || {};
  IC.version = '1.0.0';
  IC.buildAt = '2026-11-18';

  /* ------------------------------------------------------------ 常量 */
  IC.C = {
    APP_NAME: '内部控制智能体',
    APP_TITLE: '华诚集团内部控制评价智能体',
    ENTITY: '华诚集团',
    EVALUATOR: '崔语凝',
    STANDARD_CP_COUNT: 120,      // 标准控制点数量
    PASS_LINE: 80,               // 结论线：总分 ≥ 80 判有效
    BASIC_LINE: 60,              // 结论线：60–79 判基本有效
    DEFECT_FACTOR: 2,            // 缺陷扣分系数
    DEFAULT_LLM: {
      provider: 'Finance AI（跃客科技）',
      model: 'deepseek-flash',
      // 教学版运行时注入的测试密钥；正式使用请替换为用户自己的密钥
      apiKey: 'sk-61679e1ea49847bca01ef9ee6ea3ff61',
      baseUrl: 'https://api.deepseek.com',
      temperature: 0.1,
      maxTokens: 2048,
      keyName: 'FAI-worktable'
    },
    LS: {
      cfg: 'ic.llm.cfg.v1',
      params: 'ic.params.v1',
      materials: 'ic.materials.v1',
      internal: 'ic.internal.v1',
      history: 'ic.history.v1',
      log: 'ic.useractivity.v1',
      notice: 'ic.notice.v1',
      prefs: 'ic.prefs.v1'
    },
    LEVELS: ['一般', '重要', '重大'],
    LEVEL_ORDER: { '一般': 1, '重要': 2, '重大': 3 },
    RESULT_TAGS: {
      '有效': 'ok',
      '无效': 'bad',
      '证据不足': 'ins'
    }
  };

  /* ------------------------------------------------------------ 安全读写 localStorage */
  var LS = IC.LS = {
    ok: (function () {
      try {
        var k = '__ic_probe__';
        global.localStorage.setItem(k, '1');
        global.localStorage.removeItem(k);
        return true;
      } catch (e) { return false; }
    })(),
    get: function (key, def) {
      if (!LS.ok) return def;
      try {
        var v = global.localStorage.getItem(key);
        if (v === null || v === undefined) return def;
        return JSON.parse(v);
      } catch (e) { return def; }
    },
    set: function (key, val) {
      if (!LS.ok) return false;
      try { global.localStorage.setItem(key, JSON.stringify(val)); return true; }
      catch (e) { return false; }
    },
    del: function (key) {
      if (!LS.ok) return false;
      try { global.localStorage.removeItem(key); return true; } catch (e) { return false; }
    }
  };

  /* ------------------------------------------------------------ 字符串 / 数值工具 */
  var U = IC.U = {};

  U.trim = function (s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/\u00a0/g, ' ').replace(/^[\s"'"'""]+|[\s"'"'""]+$/g, '');
  };

  /**
   * 严格版本：只去掉首尾空白与不可见字符，不去掉引号。
   * 用于解析从 Excel 粘贴的文本时，避免把中文引号内容吃掉。
   */
  U.clean = function (s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/\u00a0/g, ' ').replace(/^[\s\u200b\ufeff]+|[\s\u200b\ufeff]+$/g, '');
  };

  /** 去引号（只去成对的英文/中文引号） */
  U.unquote = function (s) {
    var t = U.clean(s);
    if (t.length >= 2) {
      var a = t.charAt(0), b = t.charAt(t.length - 1);
      if ((a === '"' && b === '"') || (a === '“' && b === '”') || (a === "'" && b === "'")) {
        t = t.slice(1, -1);
      }
    }
    return t;
  };

  U.isEmpty = function (s) {
    return U.clean(s) === '';
  };

  /** 解析数值：支持 "260"、"260万元"、"1,200,000"、"1200000元"、"30.5万" */
  U.num = function (v, def) {
    if (v === null || v === undefined || v === '') return def === undefined ? null : def;
    if (typeof v === 'number') return isFinite(v) ? v : (def === undefined ? null : def);
    var s = U.clean(v).replace(/[,，\s]/g, '');
    if (s === '' || s === '-' || s === '—' || s === '/' || /^无$/.test(s)) return def === undefined ? null : def;
    var m = s.match(/-?\d+(?:\.\d+)?/);
    if (!m) return def === undefined ? null : def;
    var n = parseFloat(m[0]);
    if (!isFinite(n)) return def === undefined ? null : def;
    // 单位换算：1.2亿 → 万元口径由调用方处理；这里只做「万 / 亿 / 元」的绝对换算提示
    if (/亿/.test(s)) n = n * 10000;        // 亿 → 万
    else if (/元/.test(s) && !/万元/.test(s)) n = n / 10000; // 元 → 万
    return n;
  };

  /**
   * 金额归一（统一到「万元」口径）：
   * 输入可能带单位，如 "260万" "260万元" "1,200,000元" "1.2亿" "1200000"
   * 无单位时按「万元」理解（表格口径）。
   */
  U.moneyWan = function (v) {
    if (v === null || v === undefined || v === '') return 0;
    var s = U.clean(String(v)).replace(/[,，\s]/g, '');
    if (s === '' || /^无$|^-$|^—$|^\/$/.test(s)) return 0;
    var m = s.match(/-?\d+(?:\.\d+)?/);
    if (!m) return 0;
    var n = parseFloat(m[0]);
    if (!isFinite(n)) return 0;
    if (/亿/.test(s)) return n * 10000;
    if (/万元/.test(s)) return n;
    if (/万/.test(s)) return n;
    if (/元/.test(s)) return n / 10000;
    return n;
  };

  /** 固定四舍五入（避免浮点误差，保证可复现）：精度默认 2 位 */
  U.round = function (n, digits) {
    var d = digits === undefined ? 2 : digits;
    if (!isFinite(n)) return 0;
    var p = Math.pow(10, d);
    var scaled = n * p;
    // 先做 1e-9 级微调，抵消 1.005*1000 = 1004.9999999 这类表示误差
    var sign = scaled < 0 ? -1 : 1;
    var v = Math.abs(scaled);
    var adj = Math.floor(v + 0.5 + 1e-9);
    return sign * adj / p;
  };

  /** 保留 2 位小数的固定字符串（用于展示与导出，确保两次运行完全一致） */
  U.fix2 = function (n) {
    var r = U.round(n, 2);
    if (Object.is(r, -0)) r = 0;
    return r.toFixed(2);
  };

  /** 千分位 */
  U.thousands = function (n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    var parts = String(n).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  };

  /** 金额展示（万元） */
  U.moneyText = function (wan) {
    if (!isFinite(wan)) return '—';
    if (wan === 0) return '0 万元（流程性缺陷）';
    return U.thousands(U.round(wan, 2)) + ' 万元';
  };

  /** 数组按 key 排序（稳定） */
  U.sortBy = function (arr, fn, dir) {
    var d = dir === 'desc' ? -1 : 1;
    return arr.map(function (x, i) { return { x: x, i: i }; })
      .sort(function (a, b) {
        var va = fn(a.x), vb = fn(b.x);
        if (va === vb) return a.i - b.i;
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * d;
        return String(va).localeCompare(String(bv(vb)), 'zh-CN') * d;
      })
      .map(function (o) { return o.x; });
    function bv(v) { return v === null || v === undefined ? '' : v; }
  };

  /** 去重 */
  U.uniq = function (arr) {
    var seen = {}, out = [];
    arr.forEach(function (x) {
      var k = String(x);
      if (!seen[k]) { seen[k] = 1; out.push(x); }
    });
    return out;
  };

  /** 日期：固定格式 YYYY-MM-DD HH:mm:ss（不使用随机内容，仅用于日志与留痕时间戳） */
  U.nowStamp = function () {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  };

  U.dateOnly = function () {
    return U.nowStamp().slice(0, 10);
  };

  /** HTML 转义 */
  U.esc = function (s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  /** 控制点编号规范化：C-1 / c1 / C001 / 1 → C-001（3 位）；非 C 开头的原样返回（大写去空格） */
  U.normCpId = function (v) {
    var s = U.clean(v).replace(/\s/g, '').toUpperCase();
    if (!s) return '';
    // 去掉全角连字符
    s = s.replace(/[－—–]/g, '-');
    var m = s.match(/^([A-Z]{1,4})-?0*(\d{1,5})$/);
    if (m) {
      var n = String(parseInt(m[2], 10));
      while (n.length < 3) n = '0' + n;
      return m[1] + '-' + n;
    }
    return s;
  };

  /** 拆分「涉及控制点」字符串：支持 、,，;；/ \ 空格 */
  U.splitIds = function (v) {
    if (v === null || v === undefined) return [];
    var raw = String(v).replace(/[、,，;；/\\|]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!raw) return [];
    return raw.split(' ').map(function (x) { return U.normCpId(x); }).filter(Boolean);
  };

  /** 是否包含任一关键词 */
  U.hasAny = function (text, kws) {
    var t = String(text || '');
    for (var i = 0; i < kws.length; i++) {
      if (t.indexOf(kws[i]) >= 0) return kws[i];
    }
    return '';
  };

  U.hasAll = function (text, kws) {
    var t = String(text || '');
    for (var i = 0; i < kws.length; i++) {
      if (t.indexOf(kws[i]) < 0) return false;
    }
    return true;
  };

  /** 命中关键词计数 */
  U.countAny = function (text, kws) {
    var t = String(text || '');
    var n = 0;
    for (var i = 0; i < kws.length; i++) { if (t.indexOf(kws[i]) >= 0) n++; }
    return n;
  };

  /** 归一化空白（用于展示单行判定依据） */
  U.oneLine = function (s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  };

  /** 脱敏 Key：前 4 位 + **** */
  U.maskKey = function (k) {
    var s = String(k || '');
    if (!s) return '（未填写）';
    if (s.length <= 6) return s.slice(0, 2) + '****';
    return s.slice(0, 4) + '****';
  };

  /** 深拷贝（仅 JSON 结构） */
  U.clone = function (o) {
    return o === undefined ? undefined : JSON.parse(JSON.stringify(o));
  };

  /** 稳定序列化（用于复现校验：键名排序） */
  U.stableStringify = function (obj) {
    function walk(v) {
      if (v === null || typeof v !== 'object') return JSON.stringify(v);
      if (Array.isArray(v)) return '[' + v.map(walk).join(',') + ']';
      var keys = Object.keys(v).sort();
      return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + walk(v[k]); }).join(',') + '}';
    }
    return walk(obj);
  };

  /** 浏览器下载（Blob） */
  U.download = function (filename, content, mime) {
    try {
      var blob = content instanceof global.Blob ? content : new global.Blob([content], { type: mime || 'text/plain;charset=utf-8' });
      var url = global.URL.createObjectURL(blob);
      var a = global.document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      global.document.body.appendChild(a);
      a.click();
      global.setTimeout(function () {
        try { global.URL.revokeObjectURL(url); } catch (e) {}
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 1500);
      return true;
    } catch (e) {
      return false;
    }
  };

  /** 事件总线（极简） */
  var bus = {};
  IC.on = function (evt, fn) {
    (bus[evt] = bus[evt] || []).push(fn);
  };
  IC.emit = function (evt) {
    var args = Array.prototype.slice.call(arguments, 1);
    (bus[evt] || []).forEach(function (fn) {
      try { fn.apply(null, args); } catch (e) { if (global.console) global.console.error('[IC] 事件处理异常 ' + evt, e); }
    });
  };

  /**
   * 运行环境能力探测（用于页面提示，不影响主流程）
   * 注意：file:// 协议下有些浏览器会限制 localStorage，这里如实探测。
   */
  IC.env = (function () {
    var proto = (global.location && global.location.protocol) || '';
    return {
      protocol: proto,
      isFile: proto === 'file:',
      hasXLSX: function () { return typeof global.XLSX !== 'undefined'; },
      hasECharts: function () { return typeof global.echarts !== 'undefined'; },
      storage: LS.ok
    };
  })();

})(typeof window !== 'undefined' ? window : this);
