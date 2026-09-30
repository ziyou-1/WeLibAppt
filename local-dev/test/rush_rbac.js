'use strict';
/**
 * rush_rbac.js —— 角色分级权限验证
 *
 * 验证四种角色（超级管理员 / 运营 / 核销员 / 只读）的权限边界：
 *   - 允许的操作应返回 200
 *   - 越权的操作应被拒（1600 且提示"无权"）
 *
 * 用法：node local-dev/test/rush_rbac.js
 */

const PORT = process.env.LOCAL_PORT || 3081;
const BASE = `http://127.0.0.1:${PORT}/mcloud`;

const ACCOUNTS = {
	'超管': { name: 'admin', pwd: '123456' },
	'运营': { name: 'operator01', pwd: 'op123456' },
	'核销员': { name: 'checker01', pwd: 'ck123456' },
	'只读': { name: 'viewer01', pwd: 'vw123456' },
};

async function call(route, params, token) {
	const res = await fetch(BASE, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ route, PID: 'meetlib', token: token || '', params }),
	});
	return await res.json();
}

/**
 * 判定结果：
 *   allow —— 完全成功
 *   pass  —— 权限层已放行，业务层报错（1600 但非"无权"）
 *   deny  —— 权限层拒绝
 *   err   —— 系统级错误（500 等），视为异常
 */
function verdict(r) {
	if (r.code === 200) return 'allow';
	if (r.code === 1600 && /无权/.test(r.msg || '')) return 'deny';
	if (r.code === 1600) return 'pass';
	return 'err' + r.code;
}

/** 权限是否通过（allow 或 pass 都算通过） */
function permPassed(r) {
	const v = verdict(r);
	return v === 'allow' || v === 'pass';
}

(async () => {
	console.log('========================================');
	console.log(' 角色分级权限验证');
	console.log('========================================');

	// 1) 各角色登录
	const tokens = {};
	for (const [roleLabel, acc] of Object.entries(ACCOUNTS)) {
		const r = await call('admin/login', { name: acc.name, pwd: acc.pwd });
		if (r.code !== 200) {
			console.error('登录失败 [' + roleLabel + '] ' + acc.name + ' :: ' + r.msg);
			process.exit(1);
		}
		tokens[roleLabel] = r.data.token;
		console.log(
			roleLabel.padEnd(8) + ' 登录成功  role=' + r.data.role + ' ' + r.data.roleDesc
		);
	}

	// 2) 先用超管建一个真实活动，供放号/暂停用例使用
	const t = Date.now() + 600000;
	const insertParams = {
		title: 'RBAC测试活动',
		startTime: t,
		endTime: t + 3600000,
		limit: 1,
	};
	const seed = await call('admin/rush_insert', insertParams, tokens['超管']);
	const realRushId = seed.code === 200 ? seed.data.id : 'not-exist-id';
	console.log('测试活动 ID: ' + realRushId);

	// 3) 用例：[路由, 参数, 各角色期望结果]
	//    期望：1=允许 0=应被拒
	const CASES = [
		{ name: '查看管理员列表', route: 'admin/mgr_list', params: { page: 1 }, expect: { '超管': 1, '运营': 0, '核销员': 0, '只读': 0 } },
		{ name: '新建管理员', route: 'admin/mgr_insert', params: { name: 'rbac_tmp01', desc: '临时', password: 'tmp123456', role: 4 }, expect: { '超管': 1, '运营': 0, '核销员': 0, '只读': 0 } },
		{ name: '清空操作日志', route: 'admin/log_clear', params: {}, expect: { '超管': 1, '运营': 0, '核销员': 0, '只读': 0 } },
		{ name: '查看操作日志', route: 'admin/log_list', params: { page: 1 }, expect: { '超管': 1, '运营': 1, '核销员': 0, '只读': 0 } },

		{ name: '查看活动列表', route: 'admin/rush_list', params: { page: 1 }, expect: { '超管': 1, '运营': 1, '核销员': 1, '只读': 1 } },
		{ name: '新建活动', route: 'admin/rush_insert', params: insertParams, expect: { '超管': 1, '运营': 1, '核销员': 0, '只读': 0 } },
		{ name: '放号', route: 'admin/rush_publish', params: { id: realRushId, count: 1 }, expect: { '超管': 1, '运营': 1, '核销员': 0, '只读': 0 } },
		{ name: '暂停放号', route: 'admin/rush_pause', params: { id: realRushId, pause: 1 }, expect: { '超管': 1, '运营': 1, '核销员': 0, '只读': 0 } },

		{ name: '查看预约名单', route: 'admin/rush_order_list', params: { page: 1 }, expect: { '超管': 1, '运营': 1, '核销员': 1, '只读': 1 } },
		{ name: '核销', route: 'admin/rush_checkin', params: { code: 'NOTEXIST' }, expect: { '超管': 1, '运营': 1, '核销员': 1, '只读': 0 } },
		{ name: '撤销核销', route: 'admin/rush_cancel_checkin', params: { orderId: 'not-exist-id' }, expect: { '超管': 1, '运营': 1, '核销员': 0, '只读': 0 } },
		{ name: '导出名单', route: 'admin/rush_order_export', params: {}, expect: { '超管': 1, '运营': 1, '核销员': 0, '只读': 1 } },
	];

	// 4) 跑用例
	const roleNames = Object.keys(ACCOUNTS);
	console.log('');
	console.log('========================================');
	console.log(' 权限矩阵（P=允许  D=越权被拒）');
	console.log('========================================');
	console.log(
		'操作'.padEnd(16) + roleNames.map((r) => r.padEnd(8)).join('') + '结果'
	);

	let pass = 0;
	let fail = 0;

	for (const c of CASES) {
		const marks = [];
		let ok = true;

		for (const role of roleNames) {
			// 每个用例用唯一名字，避免"账号已存在"干扰
			let params = c.params;
			if (c.route === 'admin/mgr_insert') {
				params = Object.assign({}, c.params, {
					name: 'rbac_tmp' + Math.floor(Math.random() * 100000),
				});
			}

			const r = await call(c.route, params, tokens[role]);
			const allowed = permPassed(r);

			if (allowed) marks.push('P'.padEnd(8));
			else marks.push('D'.padEnd(8));

			const want = c.expect[role] === 1;
			if (allowed !== want) {
				ok = false;
				marks[marks.length - 1] = (allowed ? 'P' : 'D') + '!'.padEnd(7);
			}
		}

		if (ok) pass++;
		else fail++;

		console.log(c.name.padEnd(16) + marks.join('') + (ok ? '✅' : '❌'));
	}

	console.log('');
	console.log('========================================');
	console.log(' 通过 ' + pass + ' / ' + (pass + fail) + ' 个用例');
	console.log('========================================');

	// 5) 安全保护验证
	console.log('');
	console.log('--- 安全保护 ---');

	// 不能删除自己
	const me = await call('admin/mgr_list', { page: 1, size: 5 }, tokens['超管']);
	const myId = (me.data.list || []).find((x) => x.ADMIN_NAME === 'admin');
	if (myId) {
		const r = await call('admin/mgr_del', { id: myId._id }, tokens['超管']);
		const selfBlocked = r.code !== 200 && /不能删除自己/.test(r.msg || '');
		console.log('不能删除自己            : ' + (selfBlocked ? '✅ 已拦截' : '❌ 未拦截 (' + r.msg + ')'));
		if (!selfBlocked) fail++;
	}

	// 不能停用最后一个超管
	const sup = await call('admin/mgr_list', { page: 1, size: 20 }, tokens['超管']);
	const supers = (sup.data.list || []).filter((x) => x.ADMIN_ROLE_DESC === '超级管理员' && x.ADMIN_STATUS === 1);
	if (supers.length === 1) {
		const r = await call('admin/mgr_status', { id: supers[0]._id, status: 0 }, tokens['超管']);
		const blocked = r.code !== 200 && /超级管理员|不能停用自己/.test(r.msg || '');
		console.log('不能停用最后一个超管    : ' + (blocked ? '✅ 已拦截' : '❌ 未拦截 (' + r.msg + ')'));
		if (!blocked) fail++;
	} else {
		console.log('不能停用最后一个超管    : 跳过（当前超管数 ' + supers.length + '）');
	}

	console.log('');
	console.log('========================================');
	console.log(fail === 0 ? ' 结论: ✅ 角色分级与安全保护全部符合预期' : ' 结论: ❌ 有 ' + fail + ' 项未通过');
	console.log('========================================');

	process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
	console.error('测试异常: ' + err.stack);
	process.exit(1);
});
