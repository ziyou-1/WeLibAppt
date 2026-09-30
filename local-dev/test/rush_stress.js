'use strict';
/**
 * rush_stress.js —— 闪抢并发压测
 *
 * 目的：验证「1000 人同时抢 100 个号」场景下
 *   1. 不超卖（成功数 <= 放号数）
 *   2. 不重复发号（号码、购买码全局唯一）
 *   3. 服务不崩（无 5xx、无连接错误）
 *
 * 用法：node local-dev/test/rush_stress.js <rushId> [并发数]
 */

const PORT = process.env.LOCAL_PORT || 3081;
const BASE = `http://127.0.0.1:${PORT}/mcloud`;

const rushId = process.argv[2];
const CONCURRENCY = Number(process.argv[3] || 1000);

if (!rushId) {
  console.error('用法: node local-dev/test/rush_stress.js <rushId> [并发数]');
  process.exit(1);
}

async function call(route, params, openid, token) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      route,
      PID: 'meetlib',
      token: token || '',
      params,
      openid,
    }),
  });
  return await res.json();
}

/** 单个用户抢号 */
async function grab(i) {
  const openid = `stress-user-${i}`;
  const t0 = Date.now();
  try {
    const json = await call(
      'rush/grab',
      { rushId, name: '压测用户' + i, phone: '138' + String(i).padStart(8, '0') },
      openid
    );
    return { i, code: json.code, msg: json.msg, data: json.data, ms: Date.now() - t0 };
  } catch (err) {
    return { i, code: -1, msg: 'NETWORK:' + err.message, ms: Date.now() - t0 };
  }
}

(async () => {
  console.log('========================================');
  console.log(' 闪抢并发压测');
  console.log('========================================');
  console.log('活动 ID : ' + rushId);
  console.log('并发用户: ' + CONCURRENCY);

  // 0) 压测前状态
  const before = await call('rush/status', { rushId }, 'stress-probe');
  console.log('压测前余量: ' + before.data.left + '  已发放: ' + before.data.taken);

  const stock = before.data.left;
  console.log('');
  console.log('开始并发抢号...');

  // 1) 全部并发发起
  const t0 = Date.now();
  const results = await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => grab(i)));
  const cost = Date.now() - t0;

  // 2) 统计
  const ok = results.filter((r) => r.code === 200);
  const logicFail = results.filter((r) => r.code === 1600);
  const svrFail = results.filter((r) => r.code === 500);
  const netFail = results.filter((r) => r.code === -1);
  const other = results.filter((r) => ![200, 1600, 500, -1].includes(r.code));

  console.log('');
  console.log('========================================');
  console.log(' 结果');
  console.log('========================================');
  console.log('总耗时      : ' + cost + ' ms');
  console.log('成功抢到    : ' + ok.length);
  console.log('已抢完(正常): ' + logicFail.length);
  console.log('系统错误500 : ' + svrFail.length);
  console.log('网络错误    : ' + netFail.length);
  console.log('其他错误    : ' + other.length);

  // 3) 唯一性校验
  const codes = ok.map((r) => r.data.code);
  const nos = ok.map((r) => r.data.no);
  const uniqCodes = new Set(codes);
  const uniqNos = new Set(nos);

  console.log('');
  console.log('========================================');
  console.log(' 一致性校验');
  console.log('========================================');
  console.log('放号总量(压测前余量): ' + stock);
  console.log('成功数与放号量     : ' + ok.length + ' / ' + stock +
    (ok.length <= stock ? '  ✅ 未超卖' : '  ❌ 超卖！'));
  console.log('购买码唯一         : ' + uniqCodes.size + ' / ' + codes.length +
    (uniqCodes.size === codes.length ? '  ✅ 无重复' : '  ❌ 有重复'));
  console.log('号码唯一           : ' + uniqNos.size + ' / ' + nos.length +
    (uniqNos.size === nos.length ? '  ✅ 无重复' : '  ❌ 有重复'));
  console.log('服务存活           : ' + (svrFail.length === 0 && netFail.length === 0 ? '✅ 未崩溃' : '❌ 出现异常'));

  // 4) 压测后状态
  const after = await call('rush/status', { rushId }, 'stress-probe');
  console.log('');
  console.log('压测后余量 : ' + after.data.left + '  已发放: ' + after.data.taken);
  console.log('实际扣减   : ' + (after.data.taken - before.data.taken));
  console.log('是否还有号 : ' + (after.data.left > 0 ? '是（未抢完）' : '否（已抢完）'));

  // 5) 慢请求分布
  const okMs = ok.map((r) => r.ms).sort((a, b) => a - b);
  if (okMs.length) {
    console.log('');
    console.log('成功请求耗时: 最小 ' + okMs[0] + 'ms / 中位 ' +
      okMs[Math.floor(okMs.length / 2)] + 'ms / 最大 ' + okMs[okMs.length - 1] + 'ms');
  }

  // 6) 结论
  const passed =
    ok.length <= stock &&
    uniqCodes.size === codes.length &&
    uniqNos.size === nos.length &&
    svrFail.length === 0;

  console.log('');
  console.log('========================================');
  console.log(passed ? ' 结论: ✅ 通过（不超卖、不重发、不崩溃）' : ' 结论: ❌ 未通过');
  console.log('========================================');

  process.exit(passed ? 0 : 1);
})().catch((err) => {
  console.error('压测异常: ' + err.stack);
  process.exit(1);
});
