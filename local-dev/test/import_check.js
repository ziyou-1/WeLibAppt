'use strict';
/**
 * import_check.js —— 校验 wxss 的 @import 路径是否可解析
 *
 * 背景：小程序的 wxss 不像 app.wxss 那样自动继承项目样式库，
 * 每个页面若要使用 .admin-comm-list、.btn 这类公共类，
 * 必须在自己 wxss 顶部显式 @import。
 * 漏写不会报错，只会静默丢样式（典型的「页面没布局」）。
 *
 * 用法：node local-dev/test/import_check.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MP = path.join(ROOT, 'miniprogram');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.wxss')) out.push(full);
  }
  return out;
}

const files = walk(MP);
let broken = 0;
let total = 0;

console.log('========================================');
console.log(' wxss @import 路径检查');
console.log('========================================');
console.log('扫描 wxss: ' + files.length + ' 个');
console.log('');

for (const f of files) {
  const css = fs.readFileSync(f, 'utf8');
  const imports = [...css.matchAll(/@import\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  if (imports.length === 0) continue;

  const dir = path.dirname(f);
  const rel = path.relative(MP, f);

  for (const imp of imports) {
    total++;
    const target = path.resolve(dir, imp);
    if (!fs.existsSync(target)) {
      broken++;
      console.log('❌ ' + rel);
      console.log('   → ' + imp + '  （解析为 ' + path.relative(ROOT, target) + '，不存在）');
    }
  }
}

console.log('');
console.log('共检查 import: ' + total + ' 条');
console.log(broken === 0 ? '结论: ✅ 全部可解析' : '结论: ❌ ' + broken + ' 条断链');
process.exit(broken ? 1 : 0);
