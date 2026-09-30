'use strict';
/**
 * full_test.js —— 闪抢模块完整测试
 *
 * 覆盖三层：
 *   A. 接口连通性 —— 41 条路由逐一调用，确认无 500/无路由缺失
 *   B. 业务闭环   —— 建活动 → 放号 → 抢号 → 核销 → 撤销 → 导出 → 取消回收
 *   C. 边界与异常 —— 未开抢/已结束/暂停/限购/黑名单/重复核销/越权
 *
 * 用法：node local-dev/test/full_test.js
 */

const PORT = process.env.LOCAL_PORT || 3081;
const BASE = `http://127.0.0.1:${PORT}/mcloud`;
const ROOT = require('path').resolve(__dirname, '..', '..');

const results = [];
let pass = 0;
let fail = 0;

function ok(name, detail) {
  pass++;
  results.push('  ✅ ' + name + (detail ? '  ' + detail : ''));
}

function no(name, detail) {
  fail++;
  results.push('  ❌ ' + name + (detail ? '  ' + detail : ''));
}

function check(name, cond, detail) {
  if (cond) ok(name, detail);
  else no(name, detail);
}

async function call(route, params, opts = {}) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      route,
      PID: 'meetlib',
      token: opts.token || '',
      params: params || {},
      openid: opts.openid,
    }),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { code: -1, msg: 'PARSE_FAIL: ' + text.slice(0, 120) };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const started = Date.now();

  console.log('========================================');
  console.log(' 闪抢模块 · 完整测试');
  console.log('========================================');

  /* ============ A. 接口连通性 ============ */
  console.log('');
  console.log('【A】接口连通性（41 条路由）');

  const routes = Object.keys(
    require(ROOT + '/cloudfunctions/mcloud/project/meetlib/public/route.js')
  ).filter((k) => k.includes('rush'));

  const adminToken = (await call('admin/login', { name: 'admin', pwd: '123456' })).data.token;

  let srvErr = 0;
  const errList = [];

  for (const r of routes) {
    // 用空参数调用，预期返回业务错误(1600)或参数错误(1301)，但不应 500
    const res = await call(r, {}, { token: adminToken, openid: 'probe' });
    if (res.code === 500) {
      srvErr++;
      errList.push(r + ' → ' + res.msg);
    }
  }
  check('全部路由无 500 错误', srvErr === 0, srvErr ? errList.join(' | ') : routes.length + ' 条全通过');

  // 健康检查
  const health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
  check('服务健康检查', health.ok === true, '集合 ' + health.collections.length + ' 个');

  /* ============ B. 业务闭环 ============ */
  console.log('');
  console.log('【B】业务闭环');

  const T = adminToken;
  const A = { token: T, openid: 'local-openid-admin-0001' };

  // B1 建活动
  const now = Date.now();
  const ins = await call('admin/rush_insert', {
    title: '完整测试活动',
    desc: '自动化完整测试',
    place: '测试门店',
    startTime: now + 3600000, // 先设为 1 小时后，验证「待开抢」
    endTime: now + 7200000,
    limit: 1,
    sessions: [{ name: '上午场', start: now, end: now + 3600000 }],
  }, A);
  check('B1 创建活动', ins.code === 200, ins.data && ins.data.id);
  const rushId = ins.data.id;

  // B2 放号
  const pub = await call('admin/rush_publish', { id: rushId, count: 10 }, A);
  check('B2 放号 10 个', pub.code === 200 && pub.data.published === 10, 'published=' + (pub.data && pub.data.published));

  // B3 前台列表可见
  const list = await call('rush/list', { page: 1, size: 50 }, { openid: 'probe' });
  const inList = (list.data.list || []).some((x) => x.id === rushId);
  check('B3 前台列表可见该活动', inList, '共 ' + list.data.total + ' 个活动');

  // B4 未开抢时的状态
  const st1 = await call('rush/status', { rushId }, { openid: 'user-a' });
  check('B4 未到点状态=待开抢', st1.data.statusDesc === '待开抢' && st1.data.hasStock === false,
    st1.data.statusDesc + ' hasStock=' + st1.data.hasStock);

  // B5 未开抢时抢号应被拒
  const g0 = await call('rush/grab', { rushId }, { openid: 'user-a' });
  check('B5 未开抢时抢号被拒', g0.code !== 200 && /还未到开抢/.test(g0.msg || ''), g0.msg);

  // B6 把开抢时间改到此刻
  const ins2 = await call('admin/rush_edit', { id: rushId, startTime: now - 1000, endTime: now + 7200000 }, A);
  check('B6 修改开抢时间为当前', ins2.code === 200 && ins2.data.updated === 1);

  // B7 状态自动变进行中
  const st2 = await call('rush/status', { rushId }, { openid: 'user-a' });
  check('B7 状态自动变为进行中', st2.data.statusDesc === '进行中' && st2.data.hasStock === true,
    st2.data.statusDesc + ' 余' + st2.data.left);

  // B8 用户抢号
  const g1 = await call('rush/grab', {
    rushId, name: '测试用户A', phone: '13800000001', nick: 'A的昵称', session: '上午场',
  }, { openid: 'user-a' });
  check('B8 用户抢号成功', g1.code === 200 && g1.data.code, '号码 ' + (g1.data && g1.data.no) + ' 码 ' + (g1.data && g1.data.code));
  const codeA = g1.data.code;
  const noA = g1.data.no;

  // B9 同用户重复抢号受限购
  await sleep(400);
  const g2 = await call('rush/grab', { rushId }, { openid: 'user-a' });
  check('B9 同用户重复抢号受限购', g2.code !== 200 && /限购/.test(g2.msg || ''), g2.msg);

  // B10 余量递减
  const st3 = await call('rush/status', { rushId }, { openid: 'probe' });
  check('B10 余量递减', st3.data.left === 9 && st3.data.taken === 1, '余 ' + st3.data.left + ' 已发 ' + st3.data.taken);

  // B11 我的预约
  const my = await call('rush/my_list', { page: 1, size: 10 }, { openid: 'user-a' });
  const myRow = (my.data.list || [])[0] || {};
  check('B11 我的预约可查', my.data.total >= 1 && myRow.RUSH_ORDER_CODE === codeA,
    '号码 ' + myRow.RUSH_ORDER_NO + ' 昵称 ' + myRow.RUSH_ORDER_NICK);

  // B12 名单可查（含全部字段）
  const ol = await call('admin/rush_order_list', { rushId, page: 1, size: 10 }, A);
  const oRow = (ol.data.list || []).find((x) => x.RUSH_ORDER_CODE === codeA) || {};
  check('B12 名单字段完整',
    !!oRow._id && !!oRow.RUSH_ORDER_PHONE && !!oRow.RUSH_ORDER_NICK && !!oRow.RUSH_ORDER_USER_ID,
    '手机=' + oRow.RUSH_ORDER_PHONE + ' 昵称=' + oRow.RUSH_ORDER_NICK);
  const orderId = oRow._id;

  // B13 核销
  const ck = await call('admin/rush_checkin', { code: codeA, device: '测试PAD' }, A);
  check('B13 核销成功', ck.code === 200 && ck.data.no === noA, '号码 ' + (ck.data && ck.data.no));

  // B14 重复核销被拒
  const ck2 = await call('admin/rush_checkin', { code: codeA }, A);
  check('B14 重复核销被拒', ck2.code !== 200 && /已核销/.test(ck2.msg || ''), ck2.msg);

  // B15 流水记录
  const cl = await call('admin/rush_checkin_list', { rushId, page: 1, size: 10 }, A);
  check('B15 核销流水已记录', cl.data.total >= 1 && (cl.data.list || [])[0].CHECKIN_TYPE === 1,
    '共 ' + cl.data.total + ' 条');

  // B16 已核销不能取消
  const cx = await call('rush/cancel', { orderId }, { openid: 'user-a' });
  check('B16 已核销的不能取消', cx.code !== 200 && /已核销/.test(cx.msg || ''), cx.msg);

  // B17 撤销核销
  const rv = await call('admin/rush_cancel_checkin', { orderId }, A);
  check('B17 撤销核销成功', rv.code === 200 && rv.data.updated === 1);

  // B18 撤销后流水 +1
  const cl2 = await call('admin/rush_checkin_list', { rushId, page: 1, size: 10 }, A);
  const hasRevert = (cl2.data.list || []).some((x) => x.CHECKIN_TYPE === 2);
  check('B18 撤销流水已记录', cl2.data.total >= 2 && hasRevert, '共 ' + cl2.data.total + ' 条');

  // B19 导出 Excel
  const exp = await call('admin/rush_order_export', { rushId }, A);
  check('B19 导出名单 Excel', exp.code === 200 && exp.data.total >= 1, '共 ' + (exp.data && exp.data.total) + ' 条');
  const url = await call('admin/rush_export_url', { type: 'order' }, A);
  check('B20 取得下载链接', url.code === 200 && !!url.data.url, (url.data && url.data.url || '').slice(-40));

  // B21 下载文件
  if (url.data && url.data.url) {
    const dl = await fetch(url.data.url);
    const buf = Buffer.from(await dl.arrayBuffer());
    const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b; // PK 头，xlsx 是 zip
    check('B21 下载的 xlsx 有效', dl.status === 200 && isZip, buf.length + ' 字节');
  }

  // B22 取消预约并回收号码
  const cxl = await call('rush/cancel', { orderId }, { openid: 'user-a' });
  check('B22 撤销后取消预约成功', cxl.code === 200, cxl.msg);

  // B23 号码回收核对
  const st4 = await call('rush/status', { rushId }, { openid: 'probe' });
  check('B23 取消后余量回收', st4.data.left === 10 && st4.data.taken === 0, '余 ' + st4.data.left);

  /* ============ C. 边界与异常 ============ */
  console.log('');
  console.log('【C】边界与异常');

  // C1 不存在的活动
  const bad = await call('rush/status', { rushId: 'not-exist-id' }, { openid: 'probe' });
  check('C1 不存在的活动被拒', bad.code !== 200 && /不存在/.test(bad.msg || ''), bad.msg);

  // C2 暂停放号后抢号被拒
  await call('admin/rush_pause', { id: rushId, pause: 1 }, A);
  const gp = await call('rush/grab', { rushId }, { openid: 'user-b' });
  check('C2 暂停放号时抢号被拒', gp.code !== 200 && /暂停/.test(gp.msg || ''), gp.msg);
  await call('admin/rush_pause', { id: rushId, pause: 0 }, A);

  // C3 锁定库存后余量减少
  await call('admin/rush_lock', { id: rushId, lock: 5 }, A);
  const stLock = await call('rush/status', { rushId }, { openid: 'probe' });
  check('C3 锁定库存后余量减少', stLock.data.left === 5, '余 ' + stLock.data.left + '（放号 10 锁定 5）');
  await call('admin/rush_lock', { id: rushId, lock: 0 }, A);

  // C4 手动扣减
  const rd = await call('admin/rush_reduce', { id: rushId, count: 2 }, A);
  check('C4 手动扣减库存', rd.code === 200 && rd.data.reduced === 2, '扣减 ' + (rd.data && rd.data.reduced) + ' 个');

  // C5 黑名单拦截
  await call('admin/rush_black_insert', { type: 1, value: 'meetlib^^^black-user', reason: '测试拉黑' }, A);
  const gb = await call('rush/grab', { rushId }, { openid: 'black-user' });
  check('C5 黑名单用户被拦截', gb.code !== 200 && /限制参与/.test(gb.msg || ''), gb.msg);

  // C6 解除黑名单
  const bl = await call('admin/rush_black_list', { page: 1, size: 50 }, A);
  const blRow = (bl.data.list || []).find((x) => x.BLACK_VALUE === 'meetlib^^^black-user');
  const bd = await call('admin/rush_black_del', { id: blRow && blRow.id }, A);
  check('C6 解除黑名单', bd.code === 200);

  // C7 风控阈值读写
  const risk = await call('admin/rush_risk_get', {}, A);
  const riskSet = await call('admin/rush_risk_set', { throttleMs: 200 }, A);
  check('C7 风控阈值可配置', risk.code === 200 && riskSet.data.throttleMs === 200,
    '当前 ' + risk.data.throttleMs + 'ms → 改为 ' + riskSet.data.throttleMs + 'ms');
  await call('admin/rush_risk_set', { throttleMs: 300 }, A);

  // C8 限流生效
  await call('rush/grab', { rushId, name: 'B', phone: '13800000002' }, { openid: 'user-c' });
  const gThrottle = await call('rush/grab', { rushId, name: 'B', phone: '13800000002' }, { openid: 'user-c' });
  check('C8 高频抢号被限流', gThrottle.code !== 200 && /频繁/.test(gThrottle.msg || ''), gThrottle.msg);

  // C9 订阅模板配置
  const tmplSet = await call('admin/rush_tmpl_set', { start: 'TEST_TPL_001' }, A);
  const tmplGet = await call('admin/rush_tmpl_get', {}, A);
  check('C9 订阅模板可配置', tmplSet.code === 200 && tmplGet.data.start === 'TEST_TPL_001');

  // C10 用户订阅
  const sub = await call('rush/subscribe', { rushId, type: 1 }, { openid: 'sub-user-x' });
  check('C10 用户订阅成功', sub.code === 200, sub.msg);

  // C11 群发提醒
  const remind = await call('admin/rush_remind', { rushId }, A);
  check('C11 群发开抢提醒', remind.code === 200, '共 ' + (remind.data && remind.data.total) + ' 位订阅者');

  // C12 数据一致性自检
  const cons = await call('admin/rush_check_consistency', {}, A);
  check('C12 数据一致性自检通过', cons.code === 200 && cons.data.issueCount === 0,
    '检查 ' + cons.data.checked.rush + ' 活动 / ' + cons.data.checked.code + ' 号码 / ' + cons.data.checked.order + ' 订单');

  // C13 运营看板
  const dash = await call('admin/rush_dashboard', {}, A);
  check('C13 运营看板可用', dash.code === 200 && typeof dash.data.checkinRate === 'number',
    '核销率 ' + dash.data.checkinRate + '% 进行中 ' + dash.data.rush.running);

  // C14 数据备份
  const bk = await call('admin/rush_backup', {}, A);
  check('C14 数据备份导出', bk.code === 200 && bk.data.counts.rush > 0,
    '活动 ' + bk.data.counts.rush + ' 订单 ' + bk.data.counts.order);

  // C15 越权：只读角色不能放号
  const vLogin = await call('admin/login', { name: 'viewer01', pwd: 'vw123456' });
  if (vLogin.code === 200) {
    const vTry = await call('admin/rush_publish', { id: rushId, count: 1 }, { token: vLogin.data.token });
    check('C15 只读角色放号被拒', vTry.code !== 200 && /无权/.test(vTry.msg || ''), vTry.msg);
  } else {
    check('C15 只读角色放号被拒', false, '只读账号登录失败：' + vLogin.msg);
  }

  // C16 收尾：关闭测试活动
  const del = await call('admin/rush_del', { id: rushId }, A);
  check('C16 关闭活动', del.code === 200 && del.data.updated === 1);

  /* ============ 汇总 ============ */
  const cost = Date.now() - started;

  console.log('');
  console.log('========================================');
  console.log(' 测试结果');
  console.log('========================================');
  results.forEach((r) => console.log(r));
  console.log('');
  console.log('----------------------------------------');
  console.log('通过 ' + pass + ' / ' + (pass + fail) + '    耗时 ' + cost + 'ms');
  console.log('----------------------------------------');
  console.log(fail === 0 ? '结论: ✅ 全部通过' : '结论: ❌ ' + fail + ' 项未通过');

  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error('测试异常: ' + err.stack);
  process.exit(1);
});
