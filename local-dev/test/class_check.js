'use strict';
/**
 * class_check.js —— 检查 wxml 用到的样式类是否在 wxss 里定义
 *
 * 重写 wxss 后最容易出的问题是漏掉某个 class（页面不报错，但样式丢）。
 * 只校验页面自有前缀（rush-/ri-/my-/ci-/rk-/st-/ro-/rr-），
 * 项目通用类（btn / radius / text-white 等）来自全局样式，不在此列。
 *
 * 用法：node local-dev/test/class_check.js
 */

const fs = require('fs');
const path = require('path');

const PAGE_DIRS = [
  path.join(__dirname, '..', '..', 'miniprogram', 'projects', 'meetlib', 'pages', 'rush'),
  path.join(__dirname, '..', '..', 'miniprogram', 'projects', 'meetlib', 'pages', 'admin', 'rush'),
];

// 页面自有类前缀
const OWN_PREFIX = /^(rush|ri|my|ci|rk|st|ro|rr)-/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = PAGE_DIRS.reduce((a, d) => a.concat(walk(d)), []);
const pairs = [];

for (const f of files) {
  if (!f.endsWith('.wxml')) continue;
  const wxss = f.replace(/\.wxml$/, '.wxss');
  if (!fs.existsSync(wxss)) continue;
  pairs.push({ wxml: f, wxss });
}

let problems = 0;

console.log('========================================');
console.log(' 样式类完整性检查');
console.log('========================================');

for (const p of pairs) {
  const wxml = fs.readFileSync(p.wxml, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const wxss = fs.readFileSync(p.wxss, 'utf8');

  // wxml 里所有 class="..."、class="{{...}}" 中的静态类名
  const used = new Set();
  for (const m of wxml.matchAll(/class="([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/)) {
      const clean = c.replace(/\{\{[^}]*\}\}/g, '').trim();
      if (clean && OWN_PREFIX.test(clean)) used.add(clean);
    }
  }

  const missing = [];
  for (const c of used) {
    // wxss 里应有 .c 定义，或作为组合选择器的一部分出现
    if (!new RegExp('\\.' + c + '(?![\\w-])').test(wxss)) missing.push(c);
  }

  const name = path.basename(p.wxml);
  if (missing.length) {
    problems += missing.length;
    console.log('❌ ' + name);
    console.log('   缺少样式: ' + missing.join(', '));
  } else {
    console.log('✅ ' + name + '  （用到 ' + used.size + ' 个自有类，全部已定义）');
  }
}

console.log('');
console.log(problems === 0 ? '结论: ✅ 无遗漏' : '结论: ❌ 有 ' + problems + ' 个类缺少样式定义');
process.exit(problems ? 1 : 0);
