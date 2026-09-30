'use strict';
/**
 * rush_switch.js —— 「开抢时刻自动切换」时序验证
 *
 * 需求：用户停留在预约页不动，到点后页面应在 1 秒内自动变为「可预约」。
 *
 * 本脚本模拟前端行为：
 *   1. 建一个 3 秒后开抢的活动并放号
 *   2. 以 100ms 间隔轮询轻量状态接口（模拟前端倒计时归零后的高频轮询）
 *   3. 记录 hasStock 从 false 翻转为 true 的时刻，与开抢时刻对比
 *
 * 结论判据：翻转延迟 < 1000ms
 */

const PORT = process.env.LOCAL_PORT || 3081;
const BASE = `http://127.0.0.1:${PORT}/mcloud`;

const POLL_INTERVAL = 100; // 模拟前端 100ms 轮询（前端实际用 300ms 也足够）
const OPEN_AHEAD_MS = 3000; // 3 秒后开抢

async function call(route, params, openid, token) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ route, PID: 'meetlib', token: token || '', params, openid }),
  });
  return await res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('========================================');
  console.log(' 开抢时刻自动切换 - 时序验证');
  console.log('========================================');

  // 1) 登录后台
  const login = await call('admin/login', { name: 'admin', pwd: '123456' }, 'switch-admin');
  const token = login.data.token;

  // 2) 建活动：3 秒后开抢
  const startTime = Date.now() + OPEN_AHEAD_MS;
  const ins = await call(
    'admin/rush_insert',
    { title: '切换时序测试', startTime, endTime: startTime + 600000, limit: 1 },
    'switch-admin',
    token
  );
  const rushId = ins.data.id;
  console.log('活动 ID   : ' + rushId);

  // 3) 放号
  await call('admin/rush_publish', { id: rushId, count: 10 }, 'switch-admin', token);
  console.log('放号      : 10 个');

  // 4) 服务端时间校准（模拟前端 rush/time + RTT/2 算法）
  const tA = Date.now();
  const timeRes = await call('rush/time', {}, 'switch-user');
  const tB = Date.now();
  const rtt = tB - tA;
  const offset = timeRes.data.now + rtt / 2 - tB;
  console.log('校时      : RTT=' + rtt + 'ms  本地与服务器偏移=' + Math.round(offset) + 'ms');

  console.log('开抢时刻  : ' + startTime);
  console.log('轮询间隔  : ' + POLL_INTERVAL + 'ms');
  console.log('');
  console.log('开始轮询，等待 hasStock 翻转...');

  // 5) 高频轮询直到翻转
  let last = false;
  let switchAt = 0;
  let polls = 0;
  const t0 = Date.now();
  let firstTrueAt = 0;

  while (Date.now() - t0 < 15000) {
    const s = await call('rush/status', { rushId }, 'switch-user');
    polls++;
    const has = s.data && s.data.hasStock === true;

    if (has && !last) {
      switchAt = Date.now();
      firstTrueAt = s.data.serverNow;
      break;
    }
    last = has;
    await sleep(POLL_INTERVAL);
  }

  if (!switchAt) {
    console.log('❌ 15 秒内未检测到切换，测试失败');
    process.exit(1);
  }

  const latencyClient = switchAt - startTime; // 客户端观测到的延迟
  const latencyServer = firstTrueAt - startTime; // 服务端时刻的延迟

  console.log('');
  console.log('========================================');
  console.log(' 结果');
  console.log('========================================');
  console.log('轮询次数          : ' + polls);
  console.log('服务端判定可抢时刻: ' + firstTrueAt + '  (开抢后 +' + latencyServer + 'ms)');
  console.log('客户端观测到时刻  : ' + switchAt + '  (开抢后 +' + latencyClient + 'ms)');
  console.log('');
  console.log('服务端状态延迟    : ' + latencyServer + 'ms');
  console.log('客户端感知延迟    : ' + latencyClient + 'ms  (含 1 个轮询周期 + 网络往返)');
  console.log('');
  const pass = latencyClient < 1000;
  console.log(pass
    ? '结论: ✅ 满足「开抢 1 秒内页面自动切换」'
    : '结论: ❌ 超过 1 秒，需缩短轮询间隔');
  console.log('========================================');

  process.exit(pass ? 0 : 1);
})().catch((err) => {
  console.error('测试异常: ' + err.stack);
  process.exit(1);
});
