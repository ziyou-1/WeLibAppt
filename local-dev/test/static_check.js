'use strict';
/**
 * static_check.js —— 小程序页面静态自检
 *
 * 在没有开发者工具的情况下，尽可能提前发现会「编译不过」或「点了没反应」的问题：
 *   1. wxml 里绑定的方法，js 里是否存在
 *   2. data-url 指向的页面文件是否存在
 *   3. callCloud* 调用的云函数路由是否在 route.js 里
 *   4. js 里 selectComponent('#id') 的 id 是否真的写在 wxml 上
 *   5. wxml 里 cmpt-comm-list 的 route 属性是否是合法路由
 *
 * 用法：node local-dev/test/static_check.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MP = path.join(ROOT, 'miniprogram');
const PAGES_DIR = path.join(MP, 'projects', 'meetlib', 'pages');

const appJson = JSON.parse(fs.readFileSync(path.join(MP, 'app.json'), 'utf8'));
const routeKeys = new Set(
  Object.keys(require(path.join(ROOT, 'cloudfunctions/mcloud/project/meetlib/public/route.js')))
);

const errors = [];
const warns = [];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(PAGES_DIR);
const wxmls = files.filter((f) => f.endsWith('.wxml'));
const jss = files.filter((f) => f.endsWith('.js'));

/* ---------- 1 & 2：wxml 绑定与跳转 ---------- */
for (const f of wxmls) {
  const rawWxml = fs.readFileSync(f, 'utf8');
  // 去掉 HTML 注释：注释掉的绑定不会触发，不该算问题
  const wxml = rawWxml.replace(/<!--[\s\S]*?-->/g, '');

  const jsPath = f.replace(/\.wxml$/, '.js');
  const js = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : '';
  const rel = path.relative(PAGES_DIR, f);

  // 模板文件（*_tpl.wxml / tpls/ 下）的方法由引入它的页面提供，跳过绑定与方法检查
  const isTpl = /_tpl\.wxml$/.test(f) || f.includes(path.sep + 'tpls' + path.sep);

  // 绑定方法
  const binds = [
    ...wxml.matchAll(/bind(?:tap|input|confirm|change|blur|focus|submit|longpress|load|error)="([A-Za-z_]\w*)"/g),
  ];
  for (const name of new Set(binds.map((x) => x[1]))) {
    if (isTpl) continue;
    if (!js) {
      errors.push(rel + ': 绑定了 ' + name + ' 但缺少同名 js 文件');
      continue;
    }
    const re = new RegExp('(?:^|[\\s{,;])(?:async\\s+)?' + name + '\\s*[:=(]', 'm');
    if (!re.test(js)) errors.push(rel + ': wxml 绑定 ' + name + '，js 里找不到该方法');
  }

  // data-url（模板文件里的相对路径从「使用它的页面」算起，跳过）
  if (!isTpl) {
    for (const m of wxml.matchAll(/data-url="([^"{}]+)"/g)) {
      const raw = m[1];
      const clean = raw.split('?')[0];
      if (!clean.startsWith('../')) continue;
      const target = path.resolve(path.dirname(f), clean);
      if (!fs.existsSync(target + '.js') && !fs.existsSync(target + '.wxml')) {
        errors.push(rel + ': data-url 指向不存在的页面 → ' + raw);
      }
    }
  }

  // 组件 route 属性
  for (const m of wxml.matchAll(/route="([A-Za-z0-9_\/]+)"/g)) {
    if (!routeKeys.has(m[1])) {
      warns.push(rel + ': 组件 route="' + m[1] + '" 不在后端路由表中');
    }
  }
}

/* ---------- 3：云函数路由 ---------- */
for (const f of files) {
  if (!f.endsWith('.js') && !f.endsWith('.wxml')) continue;
  const c = fs.readFileSync(f, 'utf8');
  const rel = path.relative(PAGES_DIR, f);
  for (const m of c.matchAll(/(?:callCloudSumbit|callCloudData|callCloud)\(\s*'([^']+)'/g)) {
    if (!routeKeys.has(m[1])) {
      errors.push(rel + ': 调用了不存在的云函数路由 → ' + m[1]);
    }
  }
}

/* ---------- 4：selectComponent 的 id ---------- */
for (const f of jss) {
  const js = fs.readFileSync(f, 'utf8');
  const rel = path.relative(PAGES_DIR, f);
  const ids = [...js.matchAll(/selectComponent\('#([\w-]+)'\)/g)];
  if (ids.length === 0) continue;

  const wxmlPath = f.replace(/\.js$/, '.wxml');
  const wxml = fs.existsSync(wxmlPath) ? fs.readFileSync(wxmlPath, 'utf8') : '';
  for (const m of ids) {
    if (!new RegExp('id="' + m[1] + '"').test(wxml)) {
      errors.push(rel + ": selectComponent('#" + m[1] + "') 但 wxml 上没有 id=\"" + m[1] + '"');
    }
  }
}

/* ---------- 5：页面注册 ---------- */
for (const f of wxmls) {
  const rel = path.relative(MP, f).replace(/\\/g, '/').replace(/\.wxml$/, '');
  if (!appJson.pages.includes(rel)) {
    warns.push('页面未注册进 app.json: ' + rel);
  }
}

/* ---------- 输出 ---------- */
console.log('========================================');
console.log(' 小程序静态自检');
console.log('========================================');
console.log('扫描页面文件: ' + files.length + '（wxml ' + wxmls.length + ' / js ' + jss.length + '）');
console.log('');

if (errors.length === 0) {
  console.log('✅ 无错误');
} else {
  console.log('❌ 发现 ' + errors.length + ' 个错误：');
  for (const e of errors) console.log('   ' + e);
}

if (warns.length) {
  console.log('');
  console.log('⚠ ' + warns.length + ' 条提示：');
  for (const w of warns.slice(0, 25)) console.log('   ' + w);
  if (warns.length > 25) console.log('   …还有 ' + (warns.length - 25) + ' 条');
}

console.log('');
console.log(errors.length === 0 ? '结论: ✅ 通过' : '结论: ❌ 有 ' + errors.length + ' 个错误需修');
process.exit(errors.length ? 1 : 0);
