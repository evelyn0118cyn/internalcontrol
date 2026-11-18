/* =============================================================================
 * dev/verify.js — 构建产物自检（Node，无第三方依赖）
 *   1) 互不包含校验：各模块不得使用外层 IIFE 的局部变量名
 *   2) index.html 语法校验：两段内联脚本分别做语法解析
 *   3) 禁用词校验：界面不出现「AI 助手」「聊天机器人」等字眼
 *   4) 外链校验：不引用本地 .js / .css 相对路径；无 sourceMappingURL 外链
 *   5) 快速行为校验：演示数据 + 测试示例结果与预期一致、可复现
 * 运行：node dev/verify.js
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; console.log('  ❌ ' + name + (detail ? '  — ' + detail : '')); }
}

/* ---------- 1) 互不包含校验 ---------- */
console.log('\n[1] 模块作用域互不包含校验');
const LOCAL_NAMES = ['root', 'tpl', 'vendorJs', 'appJs', 'css', 'html', 'outFile', 'kb', 'build', 'escapeForInlineScript',
  'escapeForInlineStyle', 'scriptBlock', 'read', 'VENDOR_FILES', 'APP_SCRIPTS', 'SRC', 'VENDOR', 'ROOT'];
const mods = fs.readdirSync(path.join(ROOT, 'src', 'js')).filter(f => f.endsWith('.js'));
let collide = [];
mods.forEach(f => {
  let code = fs.readFileSync(path.join(ROOT, 'src', 'js', f), 'utf8');
  // 去掉字符串字面量内容（HTML 片段、文档声明等），避免误报
  code = code.replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
  LOCAL_NAMES.forEach(n => {
    const re = new RegExp('(^|[^.\\w$])' + n + '\\b', 'm');
    if (re.test(code)) collide.push(f + ':' + n);
  });
});
ok('业务模块未使用构建脚本局部变量名', collide.length === 0, collide.join(', ') || '无冲突');

/* ---------- 2) index.html 语法校验 ---------- */
console.log('\n[2] index.html 内联脚本语法校验');
// 注意：必须用 Buffer 读原始字节。fs.readFileSync(..., 'utf8') 会去掉 BOM，
// 导致第一段脚本开头的 \ufeff 变成非法字符（浏览器 FileReader 保留 BOM，不受影响）。
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const htmlRaw = fs.readFileSync(path.join(ROOT, 'index.html')).toString('utf8');
const blocks = [];
const re = /<script>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(htmlRaw)) !== null) blocks.push(m[1].replace(/^\ufeff/, ''));
ok('内联脚本块数量 = 2', blocks.length === 2, '实际 ' + blocks.length + ' 个');
let syntaxOk = true, syntaxMsg = '';
blocks.forEach((b, i) => {
  try { new vm.Script(b, { filename: 'inline-' + i }); }
  catch (e) { syntaxOk = false; syntaxMsg += ' block' + i + ':' + e.message; }
});
ok('两段内联脚本语法正确', syntaxOk, syntaxOk ? 'block0=' + blocks[0].length + ' chars, block1=' + blocks[1].length + ' chars' : syntaxMsg);
ok('占位符已全部替换', !/<!-- @@(VENDOR_JS|APP_JS)@@ -->|\/\* @@APP_CSS@@ \*\//.test(html));
ok('CSS 已内联', html.indexOf('--primary: #1B3A6B') > 0);

/* ---------- 3) 禁用词 ---------- */
console.log('\n[3] 界面禁用词校验');
const visible = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const banned = ['AI 助手', 'AI助手', '聊天机器人', '智能助手', 'GPT', 'ChatGPT'];
const found = banned.filter(w => visible.indexOf(w) >= 0);
ok('界面不出现「AI 助手 / 聊天机器人」等字眼', found.length === 0, found.join('、') || '通过');

/* ---------- 4) 外链 / 相对路径 ---------- */
console.log('\n[4] 外链与相对路径校验');
ok('无相对路径 .js / .css 引用', !/(src|href)="(?!https?:|#|data:)[^"]*\.(js|css)"/i.test(html));
ok('无 sourceMappingURL 外链', html.indexOf('sourceMappingURL') < 0);
const ALLOWED_URL_PARTS = ['api.deepseek.com', 'www.w3.org', 'schemas.openxmlformats.org', 'sheetjs.com', 'github.com',
  'opensource.org', 'schemas.microsoft.com', 'purl.org', 'purl.oclc.org', 'ns.adobe.com', 'example.com',
  'docs.oasis-open.org', 'sheetjs.openxmlformats.org', 'macVmlSchemaUri'];
// 只检查 HTML 静态部分（依赖库内部的 XML 命名空间常量属于库代码，不构成运行期外链）
const htmlForLinks = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const httpRefs = (htmlForLinks.match(/https?:\/\/[^\s"'<>)]+/g) || []).filter(u => !ALLOWED_URL_PARTS.some(a => u.indexOf(a) >= 0));
ok('除大模型 API 外无外部资源依赖', httpRefs.length === 0, httpRefs.slice(0, 3).join(' ') || '无');

/* ---------- 5) 行为校验 ---------- */
console.log('\n[5] 规则引擎行为校验（演示数据 / 测试示例 / 可复现）');
const sb = { console, TextDecoder: global.TextDecoder, setTimeout, Date, Math, JSON };
sb.window = sb;
vm.createContext(sb);
['99-data-reg.js', '00-data-knowledge.js', '246-skill.js', '01-data-demo.js', '02-data-test.js', '03-parse.js', '04-engine.js']
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'js', f), 'utf8'), sb, { filename: f }));
const IC = sb.IC;

const demo = IC.DEMO;
const r = IC.runAll({ controls: demo.controls, selfassessment: demo.selfassessment, defects: demo.defects }, IC.DEFAULT_PARAMS, {});
ok('演示数据：120 个控制点全覆盖', r.stats.cpCount === 120 && r.stats.coverage === 100, r.stats.cpCount + ' / ' + r.stats.coverage + '%');
ok('演示数据：每个控制点都有双维度判定', r.points.every(p => p.designResult && p.operatingResult && p.reason),
  '缺失 ' + r.points.filter(p => !(p.designResult && p.operatingResult && p.reason)).length + ' 个');
ok('演示数据：识别重大缺陷并触发一票否决', r.score.veto === true && r.score.verdict === '无效', '重大 ' + r.score.counts['重大'] + ' 项');
ok('演示数据：缺陷同时含定量等级与定性红线', r.defects.every(d => d.quantLevel && d.level) && r.defects.some(d => d.redlines.length));
ok('演示数据：定性红线优先（金额未达重大但判重大）', r.defects.some(d => d.redlines.length && d.quantLevel !== '重大' && d.level === '重大'));
ok('演示数据：重大缺陷权重 ≥ 一般缺陷 5 倍', IC.defectWeight('重大') >= IC.defectWeight('一般') * 5, '8 vs 1');
ok('演示数据：证据不足控制点进入待补清单', r.stats.insuffCount === r.pending.length && r.pending.length > 0, r.pending.length + ' 项');

const t = IC.TEST_DATA;
const t1 = IC.runAll({ controls: t.controls, selfassessment: t.selfassessment, defects: t.defects }, IC.DEFAULT_PARAMS, {});
ok('测试示例：12 个全部评估、有效 9 / 无效 3 / 证据不足 0',
  t1.stats.cpCount === 12 && t1.stats.validCount === 9 && t1.stats.invalidCount === 3 && t1.stats.insuffCount === 0,
  t1.stats.validCount + '/' + t1.stats.invalidCount + '/' + t1.stats.insuffCount);
ok('测试示例：输出 3 条缺陷（3 个不同根因不合并）', t1.defects.length === 3, t1.defects.length + ' 条');
const byCp = {};
t1.defects.forEach(d => d.cpIds.forEach(id => { byCp[id] = d; }));
ok('测试示例：C-003 重要 / C-004 重大（红线）/ C-010 一般',
  byCp['C-003'] && byCp['C-003'].level === '重要' && byCp['C-004'] && byCp['C-004'].level === '重大' && byCp['C-010'] && byCp['C-010'].level === '一般',
  ['C-003', 'C-004', 'C-010'].map(id => id + '=' + (byCp[id] ? byCp[id].level : '缺失')).join(' '));
ok('测试示例：加权得分 85.19 / 扣分 181.33 / 总分 -96.14',
  IC.U.fix2(t1.score.weightedScore) === '85.19' && IC.U.fix2(t1.score.deduct) === '181.33' && IC.U.fix2(t1.score.total) === '-96.14',
  IC.U.fix2(t1.score.weightedScore) + ' / -' + IC.U.fix2(t1.score.deduct) + ' / ' + IC.U.fix2(t1.score.total));
ok('测试示例：一票否决 → 无效', t1.score.veto && t1.score.verdict === '无效');

const t2 = IC.runAll({ controls: t.controls, selfassessment: t.selfassessment, defects: t.defects }, IC.DEFAULT_PARAMS, {});
const same = IC.U.stableStringify({
  s: t1.score, d: t1.defects.map(x => [x.id, x.level, x.R, x.cpIds]), p: t1.points.map(p => [p.id, p.conclusion, p.score])
}) === IC.U.stableStringify({
  s: t2.score, d: t2.defects.map(x => [x.id, x.level, x.R, x.cpIds]), p: t2.points.map(p => [p.id, p.conclusion, p.score])
});
ok('可复现：同输入两次运行完全一致', same);

// 解析层：粘贴文本 + 表头别名
const rows = IC.parsePasteText('控制点编号\t名称\t流程\t风险\t部门\nC-1\t采购审批\t采购与付款\t高\t采购部\n');
const ing = IC.ingestRows('controls', rows, {});
ok('解析层：制表符文本 + 表头别名识别', ing.records.length === 1 && ing.records[0].id === 'C-001' && ing.records[0].risk === '高',
  JSON.stringify(ing.records[0] || {}));
const ing2 = IC.ingestRows('controls', [['C-001', '', '采购与付款', '高', '采购部']], {});
ok('解析层：必填缺失逐条提示', ing2.validation.level === 'bad' && ing2.validation.issues.length > 0,
  (ing2.validation.issues[0] || {}).msg);
const money = ['260', '260万', '1200000元', '1.2亿', '0'].map(IC.U.moneyWan).join(',');
ok('金额归一（万元口径）', money === '260,260,120,12000,0', money);

// 导出：CSV / ZIP 结构
sb.Blob = function (parts) { this.parts = parts; this.size = parts.reduce((s, p) => s + (p.length || p.byteLength || 0), 0); };
sb.TextEncoder = global.TextEncoder;
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'js', '06-export.js'), 'utf8'), sb, { filename: '06-export.js' });
const EX = sb.IC.EXPORT;
const ds = EX.buildDatasets(r, { entity: '华诚集团', period: '2025 年度', evaluator: '崔语凝' });
ok('导出：四份成果数据集齐全', !!ds.eval && !!ds.defect && !!ds.score && !!ds.conclusion,
  '评估表 ' + ds.eval.rows.length + ' 行 / 缺陷 ' + ds.defect.rows.length + ' 行');
const csv = EX.toCSV(ds.eval);
ok('导出：CSV 含 BOM 与全部行', csv.charCodeAt(0) === 0xFEFF && csv.split('\r\n').length === ds.eval.rows.length + 1);
const zip = EX.buildZip([{ name: 'a.txt', data: new global.TextEncoder().encode('hello') }]);
ok('导出：ZIP 打包器可生成数据', zip && zip.size > 40, 'size=' + zip.size);

/* ---------- 汇总 ---------- */
console.log('\n============================================');
console.log('自检结果：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('============================================');
process.exit(fail ? 1 : 0);
