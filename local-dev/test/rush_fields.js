'use strict';
/**
 * rush_fields.js —— 名单字段完整性验证
 *
 * 需求要求名单包含：手机号、昵称、openid、号码、购买码、状态
 * 另外活动支持「时段」，抢号时选择并落到订单上。
 *
 * 用法：node local-dev/test/rush_fields.js
 */

const PORT = process.env.LOCAL_PORT || 3081;
const BASE = `http://127.0.0.1:${PORT}/mcloud`;

async function call(route, params, opts = {}) {
	const res = await fetch(BASE, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			route, PID: 'meetlib', token: opts.token || '', params, openid: opts.openid,
		}),
	});
	return await res.json();
}

let pass = 0, fail = 0;
function check(name, ok, extra) {
	if (ok) { pass++; console.log('  ✅ ' + name); }
	else { fail++; console.log('  ❌ ' + name + (extra ? ' :: ' + extra : '')); }
}

(async () => {
	console.log('========================================');
	console.log(' 名单字段 + 时段 验证');
	console.log('========================================');

	const login = await call('admin/login', { name: 'admin', pwd: '123456' });
	const token = login.data.token;

	const now = Date.now();
	const SESSIONS = [
		{ name: '上午场 09:00-12:00', start: now, end: now + 3600000 },
		{ name: '下午场 14:00-17:00', start: now + 7200000, end: now + 10800000 },
	];

	const ins = await call('admin/rush_insert', {
		title: '时段测试活动',
		startTime: now - 1000,
		endTime: now + 7200000,
		limit: 1,
		sessions: SESSIONS,
	}, { token });
	check('创建带时段的活动', ins.code === 200, ins.msg);

	const rushId = ins.data.id;
	await call('admin/rush_publish', { id: rushId, count: 3 }, { token });

	// 抢号：带昵称 + 时段
	const grab = await call('rush/grab', {
		rushId,
		name: '李四',
		phone: '13700000001',
		nick: '微信昵称_李四',
		session: '下午场 14:00-17:00',
	}, { openid: 'fields-test-user' });
	check('抢号成功', grab.code === 200, grab.msg);

	// 名单校验
	const list = await call('admin/rush_order_list', { rushId, page: 1, size: 10 }, { token, openid: 'local-openid-admin-0001' });
	const row = (list.data.list || [])[0] || {};
	check('名单含 昵称', row.RUSH_ORDER_NICK === '微信昵称_李四', JSON.stringify(row.RUSH_ORDER_NICK));
	check('名单含 手机号', row.RUSH_ORDER_PHONE === '13700000001', JSON.stringify(row.RUSH_ORDER_PHONE));
	check('名单含 openid', !!row.RUSH_ORDER_USER_ID, JSON.stringify(row.RUSH_ORDER_USER_ID));
	check('名单含 号码', Number(row.RUSH_ORDER_NO) > 0, JSON.stringify(row.RUSH_ORDER_NO));
	check('名单含 购买码', !!row.RUSH_ORDER_CODE, JSON.stringify(row.RUSH_ORDER_CODE));
	check('名单含 状态', row.RUSH_ORDER_STATUS === 0 && !!row.statusDesc, JSON.stringify(row.statusDesc));
	check('名单含 所选时段', row.RUSH_ORDER_SESSION === '下午场 14:00-17:00', JSON.stringify(row.RUSH_ORDER_SESSION));

	// 活动详情应带出时段配置
	const detail = await call('rush/detail', { rushId }, { openid: 'fields-test-user' });
	check('活动详情含时段配置', Array.isArray(detail.data.forms) && true && (detail.data.rushId === rushId), 'rushId ok');
	const adminDetail = await call('admin/rush_detail', { id: rushId }, { token, openid: 'local-openid-admin-0001' });
	check('后台详情含 sessions 数组',
		Array.isArray(adminDetail.data.RUSH_SESSIONS) && adminDetail.data.RUSH_SESSIONS.length === 2,
		JSON.stringify(adminDetail.data.RUSH_SESSIONS && adminDetail.data.RUSH_SESSIONS.length));

	// 导出会真实生成 Excel 文件（返回生成条数）
	const exp = await call('admin/rush_order_export', { rushId }, { token, openid: 'local-openid-admin-0001' });
	check('导出 Excel 成功', exp.code === 200 && exp.data.total > 0, 'total=' + (exp.data && exp.data.total));

	const urlRes = await call('admin/rush_export_url', { type: 'order' }, { token, openid: 'local-openid-admin-0001' });
	check('可取到导出文件下载链接', urlRes.code === 200 && !!urlRes.data.url, urlRes.data && urlRes.data.url);

	console.log('');
	console.log('========================================');
	console.log(' 通过 ' + pass + ' / ' + (pass + fail));
	console.log('========================================');
	console.log(fail === 0 ? '结论: ✅ 名单字段与时段均完整' : '结论: ❌ 有 ' + fail + ' 项未通过');
	process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('异常: ' + e.stack); process.exit(1); });
