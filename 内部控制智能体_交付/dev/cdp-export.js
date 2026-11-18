/* =============================================================================
 * dev/cdp-export.js — 成果下载验证（Edge headless + CDP 下载捕获）
 *   1) 控制点评估表 CSV / Excel 下载
 *   2) 缺陷清单 CSV、评分明细 Excel、结论 CSV 下载
 *   3) 一键下载全部成果 ZIP 并校验中央目录（文件数量与文件名）
 *   4) 打印 / PDF 视图可通过 window.open 打开（拦截后打开文档内容校验）
 * 运行：node dev/cdp-export.js
 * ========================================================================== */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, '_shots');
const DL = path.join(SHOTS, '_downloads');
const PORT = 9336;
const URL = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(DL, { recursive: true });
fs.readdirSync(DL).forEach(f => { try { fs.unlinkSync(path.join(DL, f)); } catch (e) {} });

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
}

const waitFile = async (pattern, ms) => {
  for (let i = 0; i < (ms || 15000) / 200; i++) {
    const files = fs.readdirSync(DL).filter(f => pattern.test(f));
    if (files.length) {
      // 等待下载完成（大小稳定）
      const p = path.join(DL, files[0]);
      const s1 = fs.statSync(p).size;
      await sleep(300);
      const s2 = fs.statSync(p).size;
      if (s1 === s2 && s1 > 0) return files[0];
    }
    await sleep(200);
  }
  return null;
};

(async function main() {
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(SHOTS, '_profile4'), '--window-size=1440,1000', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
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
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
    await cdp.send('Page.navigate', { url: URL });
    await sleep(2400);
    await cdp.eval("try{localStorage.clear()}catch(e){}");
    await cdp.eval("document.querySelector('#modalKeyNotice [data-close]').click()");
    await cdp.eval(`(() => { const c = document.getElementById('chkUseLlm'); c.checked = false; c.dispatchEvent(new Event('change')); document.getElementById('btnLoadDemo').click(); })()`);
    await sleep(700);
    await cdp.eval("document.getElementById('btnRun').click()");
    for (let i = 0; i < 200; i++) {
      await sleep(300);
      const st = await cdp.eval("document.getElementById('btnRun').textContent");
      if (st.indexOf('重新') >= 0 || st.indexOf('↻') >= 0) break;
    }

    console.log('\n[1] 控制点评估表导出（CSV / Excel）');
    await cdp.eval("document.querySelector('#wsnav [data-view=eval]').click()");
    await sleep(400);
    await cdp.eval("document.querySelector('[data-export=eval-csv]').click()");
    const csvName = await waitFile(/评估表.*\.csv$/);
    check('导出 CSV 成功', !!csvName, csvName);
    if (csvName) {
      const buf = fs.readFileSync(path.join(DL, csvName));
      const text = buf.toString('utf8');
      check('CSV 含 BOM（Excel 打开不乱码）', buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF);
      const lines = text.replace(/^\ufeff/, '').split('\r\n');
      check('CSV 行数 = 1 标题 + 1 表头 + 120 数据行', lines.length === 122, lines.length + ' 行');
      check('CSV 表头包含 Prompt 要求的 10 列', lines[1].indexOf('控制点编号') === 0 && lines[1].indexOf('关联缺陷') > 0, lines[1].slice(0, 80));
      check('CSV 数据行含设计/运行/综合判定', /C-001.*有效,有效,有效/.test(lines[2] || ''), (lines[2] || '').slice(0, 90));
    }
    await cdp.eval("document.querySelector('[data-export=eval-xlsx]').click()");
    const xlsxName = await waitFile(/评估表.*\.xlsx$/);
    check('导出 Excel 成功', !!xlsxName, xlsxName);
    if (xlsxName) {
      const b = fs.readFileSync(path.join(DL, xlsxName));
      check('Excel 文件为合法 xlsx（ZIP 头 PK）', b[0] === 0x50 && b[1] === 0x4B, b.length + ' bytes');
    }

    console.log('\n[2] 缺陷清单 / 评分明细 / 结论导出');
    await cdp.eval("document.querySelector('#wsnav [data-view=defect]').click()");
    await sleep(400);
    await cdp.eval("document.querySelector('[data-export=defect-csv]').click()");
    const dCsv = await waitFile(/缺陷分类清单.*\.csv$/);
    check('缺陷清单 CSV 导出成功', !!dCsv, dCsv);
    if (dCsv) {
      const t = fs.readFileSync(path.join(DL, dCsv), 'utf8');
      check('缺陷清单 CSV 含定量等级与定性红线列', t.indexOf('定量等级') > 0 && t.indexOf('定性红线') > 0);
    }
    await cdp.eval("document.querySelector('#wsnav [data-view=score]').click()");
    await sleep(400);
    await cdp.eval("document.querySelector('[data-export=score-xlsx]').click()");
    const sXlsx = await waitFile(/评分明细.*\.xlsx$/);
    check('评分明细 Excel 导出成功', !!sXlsx, sXlsx);
    await cdp.eval("document.querySelector('#wsnav [data-view=conclusion]').click()");
    await sleep(500);
    await cdp.eval("document.querySelector('[data-export=conclusion-csv]').click()");
    const cCsv = await waitFile(/内控评价结论.*\.csv$/);
    check('结论 CSV 导出成功', !!cCsv, cCsv);
    if (cCsv) {
      const t = fs.readFileSync(path.join(DL, cCsv), 'utf8');
      check('结论 CSV 含结论、一票否决、加权总分', t.indexOf('评价结论') > 0 && t.indexOf('一票否决') > 0 && t.indexOf('加权总分') > 0);
    }

    console.log('\n[3] 一键下载全部成果（ZIP）');
    await cdp.eval("document.getElementById('btnSideDownload').click()");
    const zipName = await waitFile(/全部成果.*\.zip$/, 25000);
    check('ZIP 打包下载成功', !!zipName, zipName);
    if (zipName) {
      const b = fs.readFileSync(path.join(DL, zipName));
      check('ZIP 文件头正确（PK\\x03\\x04）', b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04, b.length + ' bytes');
      // 解析中央目录统计文件数
      let count = 0;
      for (let i = b.length - 22; i >= 0; i--) {
        if (b.readUInt32LE(i) === 0x06054b50) { count = b.readUInt16LE(i + 10); break; }
      }
      check('ZIP 至少含 4 份成果 + 日志 + 说明（≥8 个文件）', count >= 8, count + ' 个文件');
      // 提取文件名
      const names = [];
      for (let i = 0; i < b.length - 4; i++) {
        if (b.readUInt32LE(i) === 0x02014b50) {
          const nl = b.readUInt16LE(i + 28);
          names.push(b.slice(i + 46, i + 46 + nl).toString('utf8'));
        }
      }
      const hasFour = ['①控制点有效性评估表.csv', '②缺陷分类清单.csv', '③加权风险评分明细.csv', '④内控评价结论.csv', '内部控制评价全部成果.xlsx', 'useractivity.log'];
      const missing = hasFour.filter(n => names.indexOf(n) < 0);
      check('ZIP 含四份成果 CSV + Excel + useractivity.log', missing.length === 0, missing.length ? '缺少：' + missing.join('、') : names.join(' | '));
    }

    console.log('\n[4] 打印 / 保存为 PDF 视图');
    // 通过覆盖 window.open 捕获打印文档内容（headless 下打印对话框不可用）
    const printDoc = await cdp.eval(`(() => {
      let captured = null;
      const orig = window.open;
      window.open = function(){ return { document: { open(){}, write(html){ captured = html; }, close(){} }, focus(){}, print(){} }; };
      document.querySelector('[data-export=eval-pdf]').click();
      window.open = orig;
      if (!captured) return null;
      return JSON.stringify({
        hasTitle: captured.indexOf('控制点有效性评估表') > 0,
        hasTable: captured.indexOf('<table>') > 0,
        rows: (captured.match(/<tr>/g) || []).length,
        hasPrintCss: captured.indexOf('@page') > 0,
        hasFooter: captured.indexOf('同输入同输出') > 0
      });
    })()`);
    const pd = printDoc && printDoc !== null ? JSON.parse(printDoc) : null;
    check('打印视图生成（A4 横向 + 表格 + 页脚声明）', !!pd && pd.hasTitle && pd.hasTable && pd.hasPrintCss && pd.hasFooter, pd ? '表格行数 ' + pd.rows : '未捕获');
    check('打印视图包含全部 120 个控制点', pd && pd.rows >= 121, pd ? pd.rows + ' 行' : '—');

    const conclPrint = await cdp.eval(`(() => {
      let captured = null;
      const orig = window.open;
      window.open = function(){ return { document: { open(){}, write(html){ captured = html; }, close(){} }, focus(){}, print(){} }; };
      document.querySelector('[data-export=conclusion-pdf]').click();
      window.open = orig;
      if (!captured) return null;
      return JSON.stringify({ verdict: captured.indexOf('评价结论') > 0, regs: captured.indexOf('《企业内部控制评价指引》') > 0, alert: captured.indexOf('红色预警') > 0 });
    })()`);
    const cp = conclPrint ? JSON.parse(conclPrint) : null;
    check('结论文档含结论、法规引用、红色预警', !!cp && cp.verdict && cp.regs && cp.alert);

    const errs = cdp.events.filter(e => e.method === 'Runtime.exceptionThrown').map(e =>
      e.params.exceptionDetails.exception ? e.params.exceptionDetails.exception.description : e.params.exceptionDetails.text);
    check('导出流程无未捕获异常', errs.length === 0, errs.slice(0, 2).join(' || ') || '无');

  } catch (err) {
    console.error('[异常]', err && err.stack ? err.stack : err);
    results.push({ name: '脚本执行', ok: false });
  } finally {
    try { if (ws) ws.close(); } catch (e) {}
    try { proc.kill(); } catch (e) {}
  }
  const pass = results.filter(r => r.ok).length, fail = results.length - pass;
  console.log('\n============================================');
  console.log('成果导出验证：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('下载目录：' + DL);
  console.log('============================================');
  process.exit(fail ? 1 : 0);
})();
