/* =============================================================================
 * dev/cdp-e2e.js — 端到端浏览器验证（Edge headless + Chrome DevTools Protocol）
 *   使用 Node 内置 WebSocket，无第三方依赖。
 *   流程：打开 index.html → 关闭启动提示 → 载入示例材料 → 开始逐点评估
 *         → 校验结果页/结论页/预警 → 运行内嵌测试示例 → 截图 → 汇总控制台报错
 * 运行：node dev/cdp-e2e.js
 * ========================================================================== */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, '_shots');
const PORT = 9333;
const URL = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');

fs.mkdirSync(SHOTS, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url) {
  const res = await fetch(url);
  return res.json();
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params) {
    const id = ++this.id;
    const p = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return p;
  }
  async eval(expr, opts) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: !!(opts && opts.awaitPromise),
      userGesture: true
    });
    if (r.exceptionDetails) {
      return { __error: r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text };
    }
    return r.result.value;
  }
  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64'));
    return name;
  }
}

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (detail !== undefined ? '  — ' + detail : ''));
}

(async function main() {
  const userDataDir = path.join(ROOT, '_shots', '_profile');
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + userDataDir,
    '--window-size=1440,1000',
    '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files',
    'about:blank'
  ], { stdio: 'ignore' });

  let ws, cdp;
  try {
    // 等待调试端口
    let target = null;
    for (let i = 0; i < 60; i++) {
      try {
        const list = await getJSON('http://127.0.0.1:' + PORT + '/json/list');
        target = list.find(t => t.type === 'page');
        if (target) break;
      } catch (e) { /* 尚未就绪 */ }
      await sleep(250);
    }
    if (!target) throw new Error('无法连接 Edge 调试端口');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res);
      ws.addEventListener('error', rej);
    });
    cdp = new CDP(ws);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.navigate', { url: URL });
    await sleep(2600);

    // ---------- 1. 基础渲染 ----------
    console.log('\n[1] 首屏渲染与基本结构');
    const title = await cdp.eval('document.title');
    check('页面标题正确', title === '华诚集团内部控制评价智能体', title);
    const brand = await cdp.eval("document.querySelector('.brand-text h1').textContent");
    check('顶栏标题', brand === '华诚集团内部控制评价智能体', brand);
    const hasLlmBtn = await cdp.eval("!!document.getElementById('btnApiSettings')");
    check('右上角「大模型API设置」按钮存在', hasLlmBtn);
    const hasTestBtn = await cdp.eval("!!document.getElementById('btnEmbeddedTest')");
    check('右上角「内嵌测试示例」按钮存在', hasTestBtn);
    const libs = await cdp.eval("JSON.stringify({xlsx: typeof XLSX, echarts: typeof echarts})");
    check('依赖库已内联可用（SheetJS / ECharts）', libs === '{"xlsx":"object","echarts":"object"}', libs);
    const cols = await cdp.eval("document.querySelectorAll('.layout > .col-nav, .layout > .col-main, .layout > .col-side').length");
    check('三栏布局（左导航 / 中工作区 / 右速览卡）', cols === 3, cols);
    const iconv = await cdp.eval("document.querySelectorAll('#stepnav .step-item').length");
    check('步骤导航「① 导入 → ② 逐点评估 → ③ 出具结论」', iconv === 3, iconv);

    // 启动提示：关闭（若上次运行已点「不再提示」，则直接放行）
    const noticeShown = await cdp.eval("!document.getElementById('modalKeyNotice').hidden");
    console.log('  ' + (noticeShown ? '✅' : '·') + ' 启动时弹出教学密钥提示  — ' + (noticeShown ? '已弹出' : '上次已选择「不再提示」（localStorage 记忆），符合预期'));
    if (noticeShown) results.push({ name: '启动时弹出教学密钥提示', ok: true });
    await cdp.eval("(() => { const m = document.getElementById('modalKeyNotice'); if (!m.hidden) document.querySelector('#modalKeyNotice [data-close]').click(); })()");
    await sleep(200);
    await cdp.shot('02-import-empty.png');

    // ---------- 2. 载入示例材料 ----------
    console.log('\n[2] 载入 120 个控制点示例材料');
    await cdp.eval("document.getElementById('btnLoadDemo').click()");
    await sleep(900);
    const counts = await cdp.eval("JSON.stringify({c: document.getElementById('count-controls').textContent, a: document.getElementById('count-selfassessment').textContent, d: document.getElementById('count-defects').textContent})");
    check('三份材料导入计数', counts === '{"c":"120 条","a":"120 条","d":"9 条"}', counts);
    const tag = await cdp.eval("document.getElementById('tag-controls').textContent");
    check('材料卡片状态标签', tag === '已导入', tag);
    const ledger = await cdp.eval("JSON.stringify({cp: document.getElementById('ledgerCp').textContent, cov: document.getElementById('ledgerCov').textContent})");
    check('左侧数据台账已更新', ledger.indexOf('120 条') >= 0, ledger);
    await cdp.shot('03-import-loaded.png');

    // ---------- 3. 开始逐点评估 ----------
    console.log('\n[3] 逐点评估（进度 + 结果）');
    await cdp.eval("window.__t0 = Date.now(); document.getElementById('btnRun').click()");
    await sleep(400);
    const runningText = await cdp.eval("document.getElementById('progressLabel').textContent");
    check('运行中显示「已评估 X / 120」进度', /已评估 \d+ \/ 120/.test(runningText), runningText);
    // 等待完成（最多 30 秒）
    let done = false;
    for (let i = 0; i < 120; i++) {
      await sleep(300);
      const st = await cdp.eval("document.getElementById('btnRun').textContent");
      if (st.indexOf('重新') >= 0 || st.indexOf('↻') >= 0) { done = true; break; }
    }
    const elapsed = await cdp.eval("((Date.now()-window.__t0)/1000).toFixed(1)");
    check('评估在 5 分钟内完成（效率指标）', done && parseFloat(elapsed) < 300, elapsed + ' 秒');
    const side = await cdp.eval("JSON.stringify({badge: document.getElementById('sideBadge').textContent, total: document.getElementById('sideTotal').textContent, weighted: document.getElementById('sideWeighted').textContent, deduct: document.getElementById('sideDeduct').textContent, cov: document.getElementById('sideCoverage').textContent, split: document.getElementById('sideEvalSplit').textContent, cnt: document.getElementById('sideDefectCount').textContent, dsplit: document.getElementById('sideDefectSplit').textContent, veto: document.getElementById('sideVeto').textContent})");
    check('结论速览卡：结论=无效（一票否决）', JSON.parse(side).badge === '无效', side);
    check('结论速览卡：覆盖率 100%（120/120）', JSON.parse(side).cov.indexOf('100%') >= 0, JSON.parse(side).cov);
    check('结论速览卡：有效/无效/证据不足 = 91/26/3', JSON.parse(side).split === '91 / 26 / 3', JSON.parse(side).split);
    check('结论速览卡：一票否决已触发', JSON.parse(side).veto.indexOf('触发') >= 0, JSON.parse(side).veto);

    const banner = await cdp.eval("JSON.stringify({hidden: document.getElementById('alertBanner').hidden, title: document.getElementById('alertTitle').textContent})");
    const b = JSON.parse(banner);
    check('页面顶部红色预警横幅显示', b.hidden === false && /检测到 \d+ 项重大缺陷，触发红色预警/.test(b.title), b.title);
    await cdp.shot('04-import-after-run.png');

    // ---------- 4. 控制点评估表 ----------
    console.log('\n[4] 控制点有效性评估表');
    await cdp.eval("document.querySelector('#wsnav [data-view=eval]').click()");
    await sleep(500);
    const rows = await cdp.eval("document.querySelectorAll('#tbEval tr').length");
    check('评估表输出 120 行', rows === 120, rows + ' 行');
    const cols2 = await cdp.eval("document.querySelectorAll('#tblEval thead th').length");
    check('评估表列数 = 10（含判定依据、关联缺陷）', cols2 === 10, cols2);
    const invalidRows = await cdp.eval("document.querySelectorAll('#tbEval tr.row-invalid').length");
    check('「无效」行已高亮', invalidRows > 0, invalidRows + ' 行');
    const insRows = await cdp.eval("document.querySelectorAll('#tbEval tr.row-insufficient').length");
    check('「证据不足」行已高亮', insRows === 3, insRows + ' 行');
    const dual = await cdp.eval("(()=>{const r=document.querySelector('#tbEval tr');return JSON.stringify([r.children[5].innerText.trim(), r.children[6].innerText.trim(), r.children[7].innerText.trim()]);})()");
    check('每行都有设计有效性/运行有效性/综合判定三列值', /\["(有效|无效|证据不足)".*\]/.test(dual), dual);
    // 筛选：只看无效
    await cdp.eval("(()=>{const s=document.getElementById('f-eval-conclusion'); s.value='无效'; s.dispatchEvent(new Event('change'));})()");
    await sleep(400);
    const filtered = await cdp.eval("document.querySelectorAll('#tbEval tr').length");
    check('按「综合判定=无效」筛选生效', filtered === 26, filtered + ' 行（预期 26）');
    await cdp.shot('05-eval-table.png');
    // 排序
    await cdp.eval("document.getElementById('btnEvalReset').click()");
    await sleep(300);
    await cdp.eval("document.querySelectorAll('#tblEval thead th.sortable')[0].click()");
    await sleep(300);
    const sortedDir = await cdp.eval("document.querySelectorAll('#tblEval thead th.sortable')[0].getAttribute('data-dir')");
    check('表头可排序（排序指示可见）', sortedDir === 'asc' || sortedDir === 'desc', sortedDir);

    // ---------- 5. 缺陷清单与图表 ----------
    console.log('\n[5] 缺陷分类清单与图表');
    await cdp.eval("document.querySelector('#wsnav [data-view=defect]').click()");
    await sleep(900);
    const defectRows = await cdp.eval("document.querySelectorAll('#tbDefect tr').length");
    check('缺陷清单已生成（合并后）', defectRows > 0, defectRows + ' 条');
    const levelCells = await cdp.eval("[...document.querySelectorAll('#tbDefect tr')].slice(0,3).map(r=>r.children[5].innerText.replace(/\\s+/g,' ')).join(' | ')");
    check('缺陷行同时展示定量等级与定性红线', levelCells.length > 0, levelCells);
    const chartOk = await cdp.eval("JSON.stringify({pie: !!document.querySelector('#chartPie canvas'), matrix: !!document.querySelector('#chartMatrix canvas')})");
    check('ECharts 图表（等级分布饼图 + 风险矩阵热力图）已渲染', JSON.parse(chartOk).pie && JSON.parse(chartOk).matrix, chartOk);
    await cdp.shot('06-defect.png');

    // ---------- 6. 评分明细 ----------
    console.log('\n[6] 加权风险评分明细');
    await cdp.eval("document.querySelector('#wsnav [data-view=score]').click()");
    await sleep(500);
    const stepCount = await cdp.eval("document.querySelectorAll('#scoreSteps .sstep').length");
    check('评分过程逐步展示公式与代入数值', stepCount >= 6, stepCount + ' 步');
    const formula = await cdp.eval("document.querySelector('.formula').textContent");
    check('公式与 Prompt 一致', formula.indexOf('Σ(控制点权重 × 有效性得分)') >= 0, formula.slice(0, 60) + '…');
    const cpRows = await cdp.eval("document.querySelectorAll('#tbScoreCp tr').length");
    check('控制点加权明细逐点列出', cpRows === 120, cpRows + ' 行');
    await cdp.shot('07-score.png');

    // ---------- 7. 评价结论与预警卡 ----------
    console.log('\n[7] 评价结论与红色预警卡');
    await cdp.eval("document.querySelector('#wsnav [data-view=conclusion]').click()");
    await sleep(600);
    const concl = await cdp.eval("JSON.stringify({verdict: document.querySelector('.verdict-banner .vb-big').textContent, sections: [...document.querySelectorAll('.concl-section h3')].map(h=>h.textContent), regCount: document.querySelectorAll('.concl-section ol li').length})");
    const c2 = JSON.parse(concl);
    check('结论页展示「无效」结论徽标', c2.verdict === '无效', c2.verdict);
    check('结论页含法规引用/缺陷列举/评分明细/整改要求', c2.sections.length >= 5, c2.sections.join(' / '));
    const alertCards = await cdp.eval("document.querySelectorAll('#alertCards .alert-card').length");
    check('红色预警卡已生成', alertCards > 0, alertCards + ' 张');
    const alertFields = await cdp.eval("[...document.querySelectorAll('#alertCards .alert-card')][0] ? [...document.querySelectorAll('#alertCards .alert-card')][0].innerText : ''");
    const six = ['缺陷描述', '涉及控制点', '法规依据', '责任部门', '整改建议', '风险等级'].filter(k => alertFields.indexOf(k) >= 0);
    check('预警卡含 6 项要素（缺陷描述/涉及控制点/法规依据/责任部门/整改建议/风险等级）', six.length === 6, six.join('、'));
    await cdp.shot('08-conclusion.png');

    // ---------- 8. 大模型 API 设置面板 ----------
    console.log('\n[8] 大模型 API 设置');
    await cdp.eval("document.getElementById('btnApiSettings').click()");
    await sleep(300);
    const apiFields = await cdp.eval("JSON.stringify({prov: !!document.getElementById('api-provider'), model: document.getElementById('api-model').value, key: document.getElementById('api-key').type, base: document.getElementById('api-base').value, cur: document.getElementById('apiCurrent').innerText})");
    const a = JSON.parse(apiFields);
    check('设置面板含服务商/模型/Key/BaseURL 四个输入框', a.prov, 'model=' + a.model);
    check('API Key 为密码框（可显示/隐藏）', a.key === 'password');
    check('BaseURL 默认 https://api.deepseek.com', a.base === 'https://api.deepseek.com', a.base);
    check('面板展示当前生效配置（Key 打码为前 4 位 + ****）', /sk-6\*\*\*\*/.test(a.cur), a.cur.replace(/\n/g, ' '));
    await cdp.shot('09-api-settings.png');
    await cdp.eval("document.getElementById('btnToggleKey').click()");
    const keyType = await cdp.eval("document.getElementById('api-key').type");
    check('Key 显示/隐藏切换生效', keyType === 'text', keyType);
    await cdp.eval("document.querySelector('#modalApi [data-close]').click()");
    await sleep(200);

    // ---------- 9. 内嵌测试示例 ----------
    console.log('\n[9] 内嵌测试示例（12 个控制点，预期 vs 实际）');
    await cdp.eval("document.getElementById('btnEmbeddedTest').click()");
    await sleep(400);
    const expectedText = await cdp.eval("document.getElementById('testExpected').textContent");
    check('测试页固定展示预期输出', expectedText.indexOf('【预期控制点评估】12 个全部评估｜有效 9｜无效 3｜证据不足 0') >= 0);
    await cdp.eval("document.getElementById('btnTestRun').click()");
    await sleep(1200);
    let testDone = false;
    for (let i = 0; i < 40; i++) {
      await sleep(300);
      const txt = await cdp.eval("document.getElementById('testRunState').textContent");
      if (txt.indexOf('已完成') >= 0) { testDone = true; break; }
    }
    check('一键运行测试完成', testDone);
    const checks = await cdp.eval("JSON.stringify([...document.querySelectorAll('#testSummary .check-line')].map(e=>({pass: e.classList.contains('pass'), text: e.querySelector('.ck-name').textContent})))");
    const cl = JSON.parse(checks);
    check('预期 vs 实际逐项比对全部通过（✅）', cl.length > 0 && cl.every(x => x.pass), cl.map(x => (x.pass ? '✅' : '❌') + x.text).join(' '));
    const actualText = await cdp.eval("document.getElementById('testActual').textContent");
    check('实际结果与预期一致（9/3/0 + 3 条缺陷 + 一票否决）', actualText.indexOf('有效 9｜无效 3｜证据不足 0') >= 0 && actualText.indexOf('输出 3 条缺陷') >= 0, actualText.split('\n')[0]);
    // 滚动到比对区再截图
    await cdp.eval("document.getElementById('testCompare').scrollIntoView({block:'center'})");
    await sleep(400);
    await cdp.shot('10-embedded-test.png');
    await cdp.eval("document.getElementById('testExpected').scrollIntoView({block:'start'})");
    await sleep(300);
    await cdp.shot('10b-test-compare.png');

    // 返回主流程并恢复
    await cdp.eval("document.getElementById('btnTestBack').click()");
    await sleep(500);

    // ---------- 10. 1024px 自适应 ----------
    console.log('\n[10] 1024px 自适应');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(600);
    await cdp.shot('11-width1024.png');
    const overflow = await cdp.eval("document.documentElement.scrollWidth <= 1030");
    check('1024px 下页面无横向溢出', overflow);
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await sleep(300);

    // ---------- 11. 控制台错误 ----------
    console.log('\n[11] 控制台检查');
    const errs = cdp.events.filter(e =>
      (e.method === 'Runtime.exceptionThrown') ||
      (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') ||
      (e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
    ).map(e => {
      if (e.method === 'Runtime.exceptionThrown') return 'EXCEPTION: ' + (e.params.exceptionDetails.exception ? e.params.exceptionDetails.exception.description : e.params.exceptionDetails.text);
      if (e.method === 'Log.entryAdded') return 'LOG: ' + e.params.entry.text + ' @' + (e.params.entry.url || '');
      return 'CONSOLE: ' + (e.params.args || []).map(a => a.value || a.description || '').join(' ');
    });
    check('浏览器控制台无报错、无外链 404', errs.length === 0, errs.slice(0, 4).join(' || ') || '无错误');

  } catch (err) {
    console.error('\n[E2E 异常]', err && err.stack ? err.stack : err);
    results.push({ name: '端到端脚本执行', ok: false, detail: String(err && err.message) });
  } finally {
    try { if (ws) ws.close(); } catch (e) {}
    try { proc.kill(); } catch (e) {}
  }

  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;
  console.log('\n============================================');
  console.log('浏览器端验证：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('截图目录：' + SHOTS);
  console.log('============================================');
  process.exit(fail ? 1 : 0);
})();
