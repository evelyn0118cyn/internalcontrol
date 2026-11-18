/* =============================================================================
 * build.js — 内部控制智能体 · 构建脚本（Node.js，无第三方依赖）
 * 作用：把 src/ 下的 CSS / JS 模块与 vendor/ 下的 SheetJS、ECharts 内联进单个
 *       index.html（架构 I：纯前端，双击即开、离线可用、无外链 404）。
 * 运行：node build.js
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const VENDOR = path.join(ROOT, 'vendor');

/** 读取文件并统一换行 */
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

/** 防止内联 JS 中出现 </script> 提前闭合标签 */
function escapeForInlineScript(code) {
  return code.replace(/<\/script/gi, '<\\/script');
}

/** 防止内联 CSS 中出现 </style> 提前闭合标签 */
function escapeForInlineStyle(css) {
  return css.replace(/<\/style/gi, '<\\/style');
}

/** 内联脚本统一用 ";\n" 分隔，避免相邻模块拼接产生语法歧义 */
function scriptBlock(code, label) {
  return '/* ===== ' + label + ' ===== */\n' + escapeForInlineScript(code) + '\n;\n';
}

const VENDOR_FILES = [
  { file: 'vendor/xlsx.full.min.js', label: 'SheetJS (xlsx@0.18.5) · Apache-2.0', optional: true },
  { file: 'vendor/echarts.min.js', label: 'ECharts (echarts@5.5.1) · Apache-2.0', optional: true }
];

const APP_SCRIPTS = [
  'src/js/99-data-reg.js',
  'src/js/00-data-knowledge.js',
  'src/js/246-skill.js',
  'src/js/01-data-demo.js',
  'src/js/02-data-test.js',
  'src/js/03-parse.js',
  'src/js/04-engine.js',
  'src/js/05-llm.js',
  'src/js/06-export.js',
  'src/js/07-ui.js'
];

function build() {
  const tpl = read('src/template.html');

  // ---- 依赖库内联 ----
  let vendorJs = '';
  VENDOR_FILES.forEach(function (v) {
    const p = path.join(ROOT, v.file);
    if (!fs.existsSync(p)) {
      if (v.optional) {
        console.warn('[warn] 缺少依赖库 ' + v.file + '，将使用内置降级方案');
        return;
      }
      throw new Error('缺少依赖库 ' + v.file);
    }
    let code = fs.readFileSync(p, 'utf8');
    // 去掉可能的 sourcemap 注释，避免浏览器请求不存在的 .map（无外链 404）
    code = code.replace(/\/\/[#@]\s*sourceMappingURL=[^\n]*/g, '');
    code = code.replace(/\/\*[#@]\s*sourceMappingURL=[^*]*\*\//g, '');
    vendorJs += scriptBlock(code, v.label);
  });

  // ---- 应用脚本内联（按固定顺序，顺序即依赖顺序）----
  let appJs = '';
  APP_SCRIPTS.forEach(function (rel) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) throw new Error('缺少模块 ' + rel);
    appJs += scriptBlock(read(rel), rel);
  });
  // 应用脚本整体包在 IIFE 中：模块之间通过 window.IC 共享命名空间，不污染全局
  appJs = '(function (window) {\n"use strict";\n' + appJs + '\n})(typeof window !== \'undefined\' ? window : this);\n';

  // ---- 样式内联 ----
  const css = escapeForInlineStyle(read('src/css/app.css'));

  // 注意：必须使用函数形式的 replace，避免内联代码中的 $& / $` / $' 被当作替换模式展开
  let html = tpl;
  html = html.replace('@@VENDOR_JS@@', function () { return vendorJs; });
  html = html.replace('/* @@APP_CSS@@ */', function () { return css; });
  html = html.replace('@@APP_JS@@', function () { return appJs; });

  if (/<!-- @@VENDOR_JS@@ -->|<!-- @@APP_JS@@ -->|\/\* @@APP_CSS@@ \*\//.test(html)) {
    throw new Error('模板占位符未被替换');
  }

  const outFile = path.join(ROOT, 'index.html');
  fs.writeFileSync(outFile, html, 'utf8');

  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log('[build] 输出 ' + outFile + '  ' + kb + ' KB');
  console.log('[build] 模块 ' + APP_SCRIPTS.length + ' 个 · 依赖库 ' + (vendorJs ? '已内联' : '无'));
}

build();
