/* =============================================================================
 * dev/cdp-llm.js — 大模型降级与错误处理验证（Edge headless + CDP）
 *   1) 连接测试失败时给出友好提示，页面不报未捕获异常
 *   2) 大模型不可用时执行评估 → 显示降级提示，结论与评分与规则引擎完全一致
 *   3) 模拟 HTTP 401 → 同样降级，结果照常输出
 * 说明：不刷新页面（避免测试脚本自身的时序依赖），配置通过界面与 localStorage 切换。
 * 运行：node dev/cdp-llm.js
 * ========================================================================== */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, '_shots');
const PORT = 9335;
const URL = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond });
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (detail !== undefined ? '  — ' + detail : ''));
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id); this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      } else if (msg.method) this.events.push(msg);
    });
  }
  send(method, params) {
    const id = ++this.id;
    const p = new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej }));
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return p;
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) return { __error: r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text };
    return r.result.value;
  }
  async shot(name) { const r = await this.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64')); }
}

const waitRunDone = async (cdp, ms) => {
  for (let i = 0; i < (ms || 90000) / 300; i++) {
    await sleep(300);
    const st = await cdp.eval("document.getElementById('btnRun').textContent");
    if (st.indexOf('重新') >= 0 || st.indexOf('↻') >= 0) return true;
    // 语义增强是异步的，额外等待降级提示出现
    const note = await cdp.eval("document.getElementById('sideNote').textContent");
    if (note.indexOf('不受影响') >= 0) return true;
  }
  return false;
};

(async function main() {
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(SHOTS, '_profile3'), '--window-size=1440,1000', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  let ws, cdp;
  try {
    let target = null;
    for (let i = 0; i < 60; i++) {
      try { const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); target = list.find(t => t.type === 'page'); if (target) break; } catch (e) {}
      await sleep(250);
    }
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    cdp = new CDP(ws);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
    await cdp.send('Page.navigate', { url: URL });
    await sleep(2400);
    await cdp.eval("document.querySelector('#modalKeyNotice [data-close]').click()");
    await sleep(200);

    // 先清理历史本地数据，保证从干净状态开始
    await cdp.eval("try{localStorage.clear()}catch(e){}");
    await cdp.eval("document.getElementById('btnClearAll').click()");
    await sleep(300);

    // ---------- 1. 连接测试失败提示 ----------
    console.log('\n[1] 大模型连接测试（不可达地址）');
    await cdp.eval(`(() => {
      document.getElementById('btnApiSettings').click();
      document.getElementById('api-key').value = 'sk-invalid-key-for-test';
      document.getElementById('api-base').value = 'http://127.0.0.1:9099';
      document.getElementById('btnApiTest').click();
    })()`);
    let testMsg = '';
    for (let i = 0; i < 50; i++) {
      await sleep(300);
      testMsg = await cdp.eval("document.getElementById('apiTestResult').textContent");
      if (testMsg.indexOf('❌') >= 0 || testMsg.indexOf('✅') >= 0) break;
    }
    check('连接失败给出明确提示且断言「结论与评分不受影响」', testMsg.indexOf('❌') >= 0 && testMsg.indexOf('不受影响') >= 0, testMsg.slice(0, 80));
    await cdp.eval("document.querySelector('#modalApi [data-close]').click()");
    await sleep(200);

    // ---------- 2. 纯规则模式（关闭大模型）基线 ----------
    console.log('\n[2] 规则引擎基线（关闭大模型语义增强）');
    await cdp.eval(`(() => {
      localStorage.removeItem('ic.llm.cfg.v1');
      const c = document.getElementById('chkUseLlm'); c.checked = false; c.dispatchEvent(new Event('change'));
      document.getElementById('btnLoadDemo').click();
    })()`);
    await sleep(600);
    await cdp.eval("document.getElementById('btnRun').click()");
    await waitRunDone(cdp);
    const rule = JSON.parse(await cdp.eval("JSON.stringify({badge: document.getElementById('sideBadge').textContent, total: document.getElementById('sideTotal').textContent, weighted: document.getElementById('sideWeighted').textContent, ledger: document.getElementById('ledgerLlm').textContent})"));
    check('规则模式评估完成', rule.badge === '无效', rule.badge + ' / ' + rule.total);
    check('数据台账显示「规则引擎模式」', rule.ledger.indexOf('规则引擎') >= 0, rule.ledger);

    // ---------- 3. 大模型不可达 → 降级 ----------
    console.log('\n[3] 大模型不可达时执行评估（降级）');
    await cdp.eval(`(() => {
      const c = document.getElementById('chkUseLlm'); c.checked = true; c.dispatchEvent(new Event('change'));
      localStorage.setItem('ic.llm.cfg.v1', JSON.stringify({provider:'Finance AI（跃客科技）', model:'deepseek-flash', apiKey:'sk-61679e1ea49847bca01ef9ee6ea3ff61', baseUrl:'http://127.0.0.1:9099', temperature:0.1}));
    })()`);
    // 让配置生效：重新打开设置面板保存一次（LLM.getConfig 每次调用都会重读 localStorage）
    await cdp.eval("document.getElementById('btnRun').click()");
    await waitRunDone(cdp, 120000);
    await sleep(1500);
    const degrade = JSON.parse(await cdp.eval("JSON.stringify({badge: document.getElementById('sideBadge').textContent, total: document.getElementById('sideTotal').textContent, weighted: document.getElementById('sideWeighted').textContent, note: document.getElementById('sideNote').textContent, ledger: document.getElementById('ledgerLlm').textContent})"));
    check('降级提示出现', degrade.note.indexOf('结论与评分不受影响') >= 0, degrade.note.slice(0, 90));
    check('降级后结论/总分/加权得分与规则引擎完全一致', degrade.badge === rule.badge && degrade.total === rule.total && degrade.weighted === rule.weighted,
      degrade.badge + ' / ' + degrade.total + ' / ' + degrade.weighted + '（规则 ' + rule.total + ' / ' + rule.weighted + '）');
    check('数据台账显示「降级（规则引擎）」', degrade.ledger.indexOf('降级') >= 0, degrade.ledger);
    await cdp.shot('12-llm-degraded.png');

    // ---------- 4. 模拟 401 ----------
    console.log('\n[4] 模拟 HTTP 401 鉴权失败');
    await cdp.eval(`(() => {
      window.fetch = function(){ return Promise.resolve({ ok:false, status:401, text:function(){return Promise.resolve('{"error":"invalid api key"}');} }); };
      document.getElementById('btnRun').click();
    })()`);
    await waitRunDone(cdp, 120000);
    await sleep(1500);
    const r401 = JSON.parse(await cdp.eval("JSON.stringify({badge: document.getElementById('sideBadge').textContent, total: document.getElementById('sideTotal').textContent, note: document.getElementById('sideNote').textContent})"));
    check('401 时降级并提示（规则结果照常输出）', r401.note.indexOf('不受影响') >= 0, r401.note.slice(0, 90));
    check('401 降级后结论与总分不变', r401.badge === rule.badge && r401.total === rule.total, r401.badge + ' / ' + r401.total);

    // ---------- 5. 模拟大模型正常返回（语义增强生效，且不改变判定） ----------
    console.log('\n[5] 模拟大模型正常返回（语义增强）');
    await cdp.eval(`(() => {
      window.fetch = function(url, init){
        var body = { choices: [ { message: { content: JSON.stringify({items:[{id:'C-001',reason:'大模型语义判定：审批与留痕齐备，控制按设计运行。'}]}) } } ] };
        return Promise.resolve({ ok:true, status:200, json:function(){return Promise.resolve(body);}, text:function(){return Promise.resolve('');} });
      };
      document.getElementById('btnRun').click();
    })()`);
    let llmOk = null;
    for (let i = 0; i < 400; i++) {
      await sleep(300);
      const st = await cdp.eval("JSON.stringify({badge: document.getElementById('sideBadge').textContent, total: document.getElementById('sideTotal').textContent, ledger: document.getElementById('ledgerLlm').textContent, done: document.getElementById('btnRun').textContent})");
      const o = JSON.parse(st);
      if (o.ledger.indexOf('语义增强') >= 0) { llmOk = o; break; }
    }
    check('大模型返回正常时标记「已启用（语义增强）」', !!llmOk, llmOk ? llmOk.ledger : '未生效');
    check('语义增强不改变结论与总分（等级与评分仍以规则为准）', !!llmOk && llmOk.badge === rule.badge && llmOk.total === rule.total, llmOk ? llmOk.badge + ' / ' + llmOk.total : '—');
    // 评估表中应出现 LLM 依据追加
    await cdp.eval("document.querySelector('#wsnav [data-view=eval]').click()");
    await sleep(600);
    const hasLlmReason = await cdp.eval("document.querySelector('#tbEval').innerText.indexOf('LLM：') >= 0");
    check('判定依据中已并入大模型语义描述（仅文字）', hasLlmReason);

    // ---------- 6. 控制台 ----------
    const errs = cdp.events.filter(e => e.method === 'Runtime.exceptionThrown' ||
      (e.method === 'Log.entryAdded' && e.params.entry.level === 'error' && (e.params.entry.text || '').indexOf('Failed to load resource') < 0))
      .map(e => e.method === 'Runtime.exceptionThrown'
        ? (e.params.exceptionDetails.exception ? e.params.exceptionDetails.exception.description : e.params.exceptionDetails.text)
        : e.params.entry.text);
    check('降级/增强流程中无未捕获异常', errs.length === 0, errs.slice(0, 2).join(' || ') || '无');

  } catch (err) {
    console.error('[异常]', err && err.stack ? err.stack : err);
    results.push({ name: '脚本执行', ok: false });
  } finally {
    try { if (ws) ws.close(); } catch (e) {}
    try { proc.kill(); } catch (e) {}
  }
  const pass = results.filter(r => r.ok).length, fail = results.length - pass;
  console.log('\n============================================');
  console.log('大模型降级与增强验证：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('============================================');
  process.exit(fail ? 1 : 0);
})();
