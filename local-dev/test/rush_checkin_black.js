'use strict';
/**
 * rush_checkin_black.js —— 核销流水 + 风控验证
 *
 * 覆盖：
 *   核销流水：核销 / 撤销核销 各落一条流水，可查询
 *   风控：黑名单拦截抢号、解除后恢复；同账号高频抢号被节流
 *
 * 用法：node local-dev/test/rush_checkin_black.js
 */

const PORT = process.env.LOCAL_PORT || 3081;
const BASE = `http://127.0.0.1:${PORT}/mcloud`;

const USER_OPENID = 'test-wind-user-001';

async function call(route, params, opts = {}) {
	const res = await fetch(BASE, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			route,
			PID: 'meetlib',
			token: opts.token || '',
			params,
			openid: opts.openid,
		}),
	});
	return await res.json();
}

let pass = 0;
let fail = 0;
function check(name, ok, extra) {
	if (ok) {
		pass++;
		console.log('  ✅ ' + name);
	} else {
		fail++;
		console.log('  ❌ ' + name + (extra ? ' :: ' + extra : ''));
	}
}

(async () => {
	console.log('========================================');
	console.log(' 核销流水 + 风控 验证');
	console.log('========================================');

	// 登录
	const login = await call('admin/login', { name: 'admin', pwd: '123456' });
	const token = login.data.token;

	// 建活动 + 放号
	const now = Date.now();
	const ins = await call(
		'admin/rush_insert',
		{ title: '流水风控测试', startTime: now - 1000, endTime: now + 3600000, limit: 1 },
		{ token }
	);
	const rushId = ins.data.id;
	await call('admin/rush_publish', { id: rushId, count: 6 }, { token });
	console.log('活动 ID: ' + rushId + '（放号 6）');
	console.log('');

	// ---------- 用户抢号 ----------
	console.log('--- 抢号 ---');
	const grab = await call('rush/grab', { rushId, name: '风控测试员', phone: '13900000001' }, { openid: USER_OPENID });
	check('用户抢号成功', grab.code === 200, grab.msg);
	const code = grab.code === 200 ? grab.data.code : '';

	// ---------- 核销流水 ----------
	console.log('');
	console.log('--- 核销流水 ---');

	const ck1 = await call('admin/rush_checkin', { code, device: '门店PAD-01' }, { token, openid: 'local-openid-admin-0001' });
	check('核销成功', ck1.code === 200, ck1.msg);

	let list = await call('admin/rush_checkin_list', { rushId, page: 1, size: 20 }, { token, openid: 'local-openid-admin-0001' });
	const l1 = (list.data && list.data.list) || [];
	check('核销后流水 +1', l1.length === 1, '实际 ' + l1.length);
	check('流水类型为「核销」', l1[0] && l1[0].CHECKIN_TYPE === 1, l1[0] && l1[0].typeDesc);
	check('流水记录了核销员', l1[0] && !!l1[0].CHECKIN_ADMIN_NAME, JSON.stringify(l1[0] && l1[0].CHECKIN_ADMIN_NAME));
	check('流水记录了设备', l1[0] && l1[0].CHECKIN_DEVICE === '门店PAD-01', l1[0] && l1[0].CHECKIN_DEVICE);

	// 重复核销应被拒
	const ck2 = await call('admin/rush_checkin', { code }, { token, openid: 'local-openid-admin-0001' });
	check('重复核销被拒', ck2.code !== 200 && /已核销/.test(ck2.msg || ''), ck2.msg);

	// 撤销核销
	const orderId = l1[0] && l1[0].CHECKIN_ORDER_ID;
	const rv = await call('admin/rush_cancel_checkin', { orderId }, { token, openid: 'local-openid-admin-0001' });
	check('撤销核销成功', rv.code === 200, rv.msg);

	list = await call('admin/rush_checkin_list', { rushId, page: 1, size: 20 }, { token, openid: 'local-openid-admin-0001' });
	const l2 = (list.data && list.data.list) || [];
	check('撤销后流水 +1（共 2 条）', l2.length === 2, '实际 ' + l2.length);
	const hasRevert = l2.some((x) => x.CHECKIN_TYPE === 2);
	check('存在「撤销核销」类型流水', hasRevert);

	// 导出（真实生成 Excel 文件，返回条数）
	const exp = await call('admin/rush_checkin_export', { rushId }, { token, openid: 'local-openid-admin-0001' });
	check('流水导出 Excel 成功', exp.code === 200 && exp.data.total >= 2, 'total=' + (exp.data && exp.data.total));

	// ---------- 风控：黑名单 ----------
	console.log('');
	console.log('--- 风控：黑名单 ---');

	// 取订单里的真实用户标识（服务端存的是 PID^^^openid）
	const orders = await call('admin/rush_order_list', { rushId, page: 1, size: 10 }, { token, openid: 'local-openid-admin-0001' });
	const realUser = (orders.data.list || [])[0];
	const userKey = realUser && realUser.RUSH_ORDER_USER_ID;
	check('取到用户标识', !!userKey, userKey);

	// 加黑名单（openid 维度）
	const bl = await call('admin/rush_black_insert', { type: 1, value: userKey, reason: '异常刷单' }, { token, openid: 'local-openid-admin-0001' });
	check('加入黑名单成功', bl.code === 200, bl.msg);

	const blList = await call('admin/rush_black_list', { page: 1, size: 20 }, { token, openid: 'local-openid-admin-0001' });
	const blackCount = (blList.data && blList.data.total) || 0;
	check('黑名单列表可查', blList.code === 200 && blackCount >= 1, '共 ' + blackCount + ' 条');

	// 被拉黑后抢号应被拦截
	const grab2 = await call('rush/grab', { rushId, name: '风控测试员', phone: '13900000001' }, { openid: USER_OPENID });
	check('拉黑后抢号被拦截', grab2.code !== 200 && /限制参与/.test(grab2.msg || ''), grab2.msg);

	// 解除黑名单
	const blackId = (blList.data.list || []).find((x) => x.BLACK_VALUE === userKey);
	const del = await call('admin/rush_black_del', { id: blackId && blackId.id }, { token, openid: 'local-openid-admin-0001' });
	check('解除黑名单成功', del.code === 200, del.msg);

	// 解除后应恢复（注意：抢号有节流，喘口气再试；且该用户已达限购，能走到限购提示即说明风控已放行）
	await new Promise((r) => setTimeout(r, 400));
	const grab3 = await call('rush/grab', { rushId, name: '风控测试员2', phone: '13900000002' }, { openid: USER_OPENID });
	const recoveredByLimit = grab3.code !== 200 && /限购/.test(grab3.msg || '');
	const recovered = grab3.code === 200 || recoveredByLimit;
	check('解除后不再报「限制参与」', recovered, grab3.msg);

	// ---------- 风控：节流 ----------
	console.log('');
	console.log('--- 风控：抢号节流 ---');

	const g1 = await call('rush/grab', { rushId, name: '节流测试', phone: '13900000003' }, { openid: 'throttle-user-x' });
	const g2 = await call('rush/grab', { rushId, name: '节流测试', phone: '13900000003' }, { openid: 'throttle-user-x' });
	check('连续两次抢号，第二次被节流',
		g2.code !== 200 && /频繁/.test(g2.msg || ''),
		'第一次=' + g1.msg + ' 第二次=' + g2.msg);

	console.log('');
	console.log('========================================');
	console.log(' 通过 ' + pass + ' / ' + (pass + fail));
	console.log('========================================');
	console.log(fail === 0 ? '结论: ✅ 核销流水与风控均符合预期' : '结论: ❌ 有 ' + fail + ' 项未通过');
	process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
	console.error('测试异常: ' + err.stack);
	process.exit(1);
});
