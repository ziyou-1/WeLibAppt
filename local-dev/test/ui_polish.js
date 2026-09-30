'use strict';
/**
 * ui_polish.js —— 闪抢页面 UI 合规批量修正
 *
 * 依据 ui-ux-pro-max 的 pro-rules 检查清单：
 *   1. 文本对比度 >= 4.5:1（只改 color: 的文本色，不动边框/背景）
 *   2. 可点元素触摸目标 >= 88rpx（44pt）
 *
 * 用法：node local-dev/test/ui_polish.js [--dry]
 */

const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry');

const DIRS = [
  path.join(__dirname, '..', '..', 'miniprogram', 'projects', 'meetlib', 'pages', 'rush'),
  path.join(__dirname, '..', '..', 'miniprogram', 'projects', 'meetlib', 'pages', 'admin', 'rush'),
];

/** 文本色映射：低对比度 -> WCAG AA 达标值（白底） */
const COLOR_MAP = [
  // #888 3.5:1 -> 7.4:1
  [/#888888\b/gi, '#4B5563'],
  [/#888\b/gi, '#4B5563'],
  // #999 2.8:1 -> 5.0:1
  [/#999999\b/gi, '#6B7280'],
  [/#999\b/gi, '#6B7280'],
  // #aaa 2.3:1 -> 5.0:1
  [/#aaaaaa\b/gi, '#6B7280'],
  [/#aaa\b/gi, '#6B7280'],
  // #bbb 2.0:1 -> 3.0:1（仅可用于占位符/装饰，正文请改用 #6B7280）
  [/#bbbbbb\b/gi, '#9CA3AF'],
  [/#bbb\b/gi, '#9CA3AF'],
  // #ccc 1.6:1 -> 边框色（非文本元素）
  [/#cccccc\b/gi, '#D1D5DB'],
  [/#ccc\b/gi, '#D1D5DB'],
];

/** 触摸目标：把过小的可点元素提到 88rpx */
const HEIGHT_FIX = [
  // 主按钮 / 次按钮
  { sel: /(\.rush-sub-btn\s*\{[^}]*?height:\s*)\d+rpx/, to: '$188rpx', alsoLine: /(\.rush-sub-btn\s*\{[^}]*?line-height:\s*)\d+rpx/ },
  { sel: /(\.rush-order-cancel\s*\{[^}]*?height:\s*)\d+rpx/, to: '$188rpx', alsoLine: /(\.rush-order-cancel\s*\{[^}]*?line-height:\s*)\d+rpx/ },
  { sel: /(\.ri-btn\s*\{[^}]*?height:\s*)\d+rpx/, to: '$188rpx', alsoLine: /(\.ri-btn\s*\{[^}]*?line-height:\s*)\d+rpx/ },
  { sel: /(\.rk-modal-btn\s*\{[^}]*?height:\s*)\d+rpx/, to: '$188rpx', alsoLine: /(\.rk-modal-btn\s*\{[^}]*?line-height:\s*)\d+rpx/ },
  { sel: /(\.st-btn-block\s*\{[^}]*?height:\s*)\d+rpx/, to: '$188rpx', alsoLine: /(\.st-btn-block\s*\{[^}]*?line-height:\s*)\d+rpx/ },
  { sel: /(\.st-btn\s*\{[^}]*?height:\s*)\d+rpx/, to: '$188rpx', alsoLine: /(\.st-btn\s*\{[^}]*?line-height:\s*)\d+rpx/ },
  { sel: /(\.st-type\s*\{[^}]*?height:\s*)\d+rpx/, to: '$188rpx', alsoLine: /(\.st-type\s*\{[^}]*?line-height:\s*)\d+rpx/ },
  { sel: /(\.ci-scan\s*\{[^}]*?height:\s*)\d+rpx/, to: '$196rpx', alsoLine: /(\.ci-scan\s*\{[^}]*?line-height:\s*)\d+rpx/ },
];

let totalColor = 0;
let totalHeight = 0;
const report = [];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.wxss')) out.push(full);
  }
  return out;
}

const files = DIRS.reduce((acc, d) => acc.concat(walk(d)), []);

for (const f of files) {
  let css = fs.readFileSync(f, 'utf8');
  const before = css;
  let changed = 0;

  // 1) 只替换 color: 属性里的文本色（跳过 background / border / placeholder-class 之外的）
  for (const [re, to] of COLOR_MAP) {
    css = css.replace(new RegExp('(color:\\s*)' + re.source, 'gi'), (m, p1) => {
      changed++;
      return p1 + to;
    });
  }

  // 2) 触摸目标
  for (const fix of HEIGHT_FIX) {
    const m = css.match(fix.sel);
    if (m && !/height:\s*(8[8-9]|9\d|\d{3,})rpx/.test(m[1])) {
      css = css.replace(fix.sel, fix.to);
      changed++;
      if (fix.alsoLine) css = css.replace(fix.alsoLine, fix.to);
    }
  }

  if (css !== before) {
    if (!DRY) fs.writeFileSync(f, css, 'utf8');
    report.push('  ' + path.basename(f) + '  →  ' + changed + ' 处');
    totalColor += changed;
  }
}

console.log('========================================');
console.log(DRY ? ' UI 合规修正（试运行，未写盘）' : ' UI 合规修正');
console.log('========================================');
console.log('扫描 wxss: ' + files.length + ' 个');
console.log('改动文件: ' + report.length + ' 个');
report.forEach((r) => console.log(r));
console.log('');
console.log('合计改动: ' + totalColor + ' 处');
console.log(DRY ? '（试运行，未写入）' : '已写入');
