'use strict';
/**
 * call.js —— 本地云函数调用器（命令行）
 *
 * 用法：
 *   node local-dev/test/call.js <route> [paramsJson] [--page=1 --size=5] [--as=admin] [--token=xxx]
 *
 * 说明：除控制参数外，其余 --key=value 会直接并入 params，用于规避 shell 转义问题。
 *
 * 例：
 *   node local-dev/test/call.js home/setup_get
 *   node local-dev/test/call.js home/list --page=1 --size=5
 *   node local-dev/test/call.js admin/login --name=admin --pwd=123456
 *   node local-dev/test/call.js admin/mgr_list --page=1 --token=<登录返回的token>
 */

const PORT = process.env.LOCAL_PORT || 3081;
const BASE = `http://127.0.0.1:${PORT}/mcloud`;
const CONTROL_FLAGS = new Set(['as', 'token', 'openid', 'PID', 'raw']);

/** 把命令行字符串转成合适的 JSON 类型 */
function coerce(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

async function main() {
  const args = process.argv.slice(2);
  const flags = {};
  const positional = [];
  for (const a of args) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) flags[m[1]] = m[2];
    else if (a === '--raw') flags.raw = true;
    else positional.push(a);
  }

  const route = positional[0];
  if (!route) {
    console.error('用法: node local-dev/test/call.js <route> [paramsJson] [--page=1 --size=5] [--as=admin]');
    process.exit(1);
  }

  let params = {};
  if (positional[1]) {
    try {
      params = JSON.parse(positional[1]);
    } catch (err) {
      console.error('params 不是合法 JSON: ' + positional[1]);
      process.exit(1);
    }
  }
  for (const key of Object.keys(flags)) {
    if (CONTROL_FLAGS.has(key) || key === 'raw') continue;
    params[key] = coerce(flags[key]);
  }

  const body = {
    route,
    PID: flags.PID || 'meetlib',
    token: flags.token || '',
    params,
    as: flags.as || 'user',
  };
  if (flags.openid) body.openid = flags.openid;

  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (flags.raw) {
    console.log(text);
    return;
  }
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch (err) {
    console.log(text);
  }
}

main().catch((err) => {
  console.error('调用失败: ' + err.message + '\n请确认本地服务器已启动（node local-dev/server.js）');
  process.exit(1);
});
