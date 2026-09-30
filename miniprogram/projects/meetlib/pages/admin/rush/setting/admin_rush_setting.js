/**
 * 闪抢设置页（超管 / 运营）
 *
 * 三块配置集中在一页：
 *   风控     —— 抢号节流阈值（0 表示关闭）
 *   黑名单   —— openid / 手机号 两维度增删
 *   订阅消息 —— 三个模板 ID，以及按活动群发开抢提醒
 */

const AdminBiz = require('../../../../../../comm/biz/admin_biz.js');
const pageHelper = require('../../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../../helper/cloud_helper.js');

Page({

	data: {
		isLoad: false,

		// 风控
		throttleMs: '300',

		// 黑名单
		blackType: 1,
		blackTypeDesc: 'openid',
		blackValue: '',
		blackReason: '',
		blackList: [],

		// 订阅模板
		tmplStart: '',
		tmplSuccess: '',
		tmplCheckin: '',

		// 放号提醒
		remindRushId: '',
	},

	onLoad: async function (options) {
		if (!AdminBiz.isAdmin(this)) return;

		this.setData({ isLoad: true });

		if (options && options.rushId) {
			this.setData({ remindRushId: options.rushId });
		}

		await this._loadRisk();
		await this._loadBlack();
		await this._loadTmpl();
	},

	onShow: function () { },

	onHide: function () { },

	onUnload: function () { },

	url: function (e) {
		pageHelper.url(e, this);
	},

	/* ---------------- 风控 ---------------- */

	_loadRisk: async function () {
		const res = await cloudHelper.callCloudData('admin/rush_risk_get', {}, { hint: false });
		if (res) {
			this.setData({ throttleMs: String(res.throttleMs === undefined ? 300 : res.throttleMs) });
		}
	},

	bindThrottleInput: function (e) {
		this.setData({ throttleMs: e.detail.value });
	},

	bindSaveThrottle: async function () {
		const v = Math.floor(Number(this.data.throttleMs));
		if (isNaN(v) || v < 0) {
			pageHelper.showModal('请输入不小于 0 的毫秒数');
			return;
		}

		try {
			await cloudHelper.callCloudSumbit('admin/rush_risk_set', { throttleMs: v }).then((res) => {
				this.setData({ throttleMs: String(res.data.throttleMs) });
				pageHelper.showSuccToast('已保存');
			});
		} catch (e) {
			console.log(e);
		}
	},

	/* ---------------- 黑名单 ---------------- */

	_loadBlack: async function () {
		const res = await cloudHelper.callCloudData(
			'admin/rush_black_list',
			{ status: 1, page: 1, size: 50 },
			{ hint: false }
		);
		if (res && res.list) {
			this.setData({ blackList: res.list });
		}
	},

	bindBlackTypeTap: function () {
		const t = this.data.blackType === 1 ? 2 : 1;
		this.setData({
			blackType: t,
			blackTypeDesc: t === 1 ? 'openid' : '手机号',
		});
	},

	bindBlackInput: function (e) {
		this.setData({ blackValue: e.detail.value });
	},

	bindBlackReasonInput: function (e) {
		this.setData({ blackReason: e.detail.value });
	},

	bindAddBlack: async function () {
		const value = String(this.data.blackValue || '').trim();
		if (!value) {
			pageHelper.showModal('请填写要拉黑的值');
			return;
		}

		try {
			await cloudHelper.callCloudSumbit('admin/rush_black_insert', {
				type: this.data.blackType,
				value,
				reason: this.data.blackReason || '',
			}).then(() => {
				this.setData({ blackValue: '', blackReason: '' });
				pageHelper.showSuccToast('已加入黑名单');
				this._loadBlack();
			});
		} catch (e) {
			console.log(e);
		}
	},

	bindDelBlack: function (e) {
		const id = pageHelper.dataset(e, 'id');
		if (!id) return;

		const callback = async () => {
			try {
				await cloudHelper.callCloudSumbit('admin/rush_black_del', { id }).then(() => {
					pageHelper.showSuccToast('已解除');
					this._loadBlack();
				});
			} catch (e2) {
				console.log(e2);
			}
		};

		pageHelper.showConfirm('确认解除该条黑名单？', callback);
	},

	/* ---------------- 订阅模板 ---------------- */

	_loadTmpl: async function () {
		const res = await cloudHelper.callCloudData('admin/rush_tmpl_get', {}, { hint: false });
		if (res) {
			this.setData({
				tmplStart: res.start || '',
				tmplSuccess: res.success || '',
				tmplCheckin: res.checkin || '',
			});
		}
	},

	bindTmplInput: function (e) {
		const key = pageHelper.dataset(e, 'key');
		if (!key) return;
		this.setData({ [key]: e.detail.value });
	},

	bindSaveTmpl: async function () {
		try {
			await cloudHelper.callCloudSumbit('admin/rush_tmpl_set', {
				start: this.data.tmplStart,
				success: this.data.tmplSuccess,
				checkin: this.data.tmplCheckin,
			}).then((res) => {
				this.setData({
					tmplStart: res.data.start || '',
					tmplSuccess: res.data.success || '',
					tmplCheckin: res.data.checkin || '',
				});
				pageHelper.showSuccToast('模板已保存');
			});
		} catch (e) {
			console.log(e);
		}
	},

	/* ---------------- 数据一致性自检 ---------------- */

	bindCheckTap: async function () {
		if (!AdminBiz.isAdmin(this)) return;

		try {
			const res = await cloudHelper.callCloudData('admin/rush_check_consistency', {}, { hint: false });
			if (!res) return;

			if (res.issueCount === 0) {
				pageHelper.showModal(
					'自检通过\n\n' +
					'活动 ' + res.checked.rush + ' 个\n' +
					'号码 ' + res.checked.code + ' 个\n' +
					'订单 ' + res.checked.order + ' 条\n\n三者完全一致'
				);
				return;
			}

			const first = res.issues[0];
			pageHelper.showModal(
				'发现 ' + res.issueCount + ' 个活动计数异常\n\n' +
				'例如：' + first.title + '\n' +
				first.problems.join('\n') +
				'\n\n可用「一键修复」按号码池重新校准'
			);
		} catch (e) {
			console.log(e);
		}
	},

	bindFixTap: function () {
		if (!AdminBiz.isAdmin(this)) return;

		pageHelper.showConfirm('将按号码池实际占用情况重新校准各活动计数，确认执行？', async () => {
			try {
				await cloudHelper.callCloudSumbit(
					'admin/rush_fix_consistency',
					{},
					{ title: '修复中...' }
				).then((res) => {
					pageHelper.showModal('修复完成，共校准 ' + res.data.fixedCount + ' 个活动');
				});
			} catch (e) {
				console.log(e);
			}
		});
	},

	/* ---------------- 运营看板 ---------------- */

	bindDashboardTap: async function () {
		if (!AdminBiz.isAdmin(this)) return;

		const d = await cloudHelper.callCloudData('admin/rush_dashboard', {}, { hint: false });
		if (!d) return;

		const lines = [
			'【今日】',
			'新增预约    ' + d.today.orders,
			'核销次数    ' + d.today.checkin,
			'',
			'【订单】',
			'总计 ' + d.order.total,
			'待核销 ' + d.order.booked + ' · 已核销 ' + d.order.checked + ' · 已取消 ' + d.order.canceled,
			'核销率 ' + d.checkinRate + '%',
			'',
			'【活动】',
			'进行中 ' + d.rush.running + ' · 待开抢 ' + d.rush.waiting + ' · 已结束 ' + d.rush.over,
			'',
			'【库存】',
			'放号 ' + d.stock.total + ' · 已发 ' + d.stock.taken + ' · 余 ' + d.stock.left,
		];

		pageHelper.showModal(lines.join('\n'));
	},

	/* ---------------- 数据与导出 ---------------- */

	bindStatsTap: async function () {
		if (!AdminBiz.isAdmin(this)) return;

		const res = await cloudHelper.callCloudData('admin/rush_data_stats', {}, { hint: false });
		if (!res) return;

		pageHelper.showModal(
			'数据量概览\n\n' +
			'活动      ' + res.rush + '\n' +
			'订单      ' + res.order + '\n' +
			'核销流水  ' + res.checkin + '\n' +
			'黑名单    ' + res.black + '\n' +
			'已占号码  ' + res.codeTaken
		);
	},

	bindSubListTap: async function () {
		if (!AdminBiz.isAdmin(this)) return;

		const res = await cloudHelper.callCloudData(
			'admin/rush_sub_list',
			{ page: 1, size: 20 },
			{ hint: false }
		);
		if (!res) return;

		const list = res.list || [];
		if (list.length === 0) {
			pageHelper.showModal('暂无订阅记录');
			return;
		}

		const lines = list.slice(0, 8).map(
			(x) => '· ' + x.typeDesc + ' | ' + x.statusDesc + ' | 剩余 ' + x.SUB_TIMES + ' 次'
		);

		pageHelper.showModal(
			'共 ' + res.total + ' 条订阅记录\n\n' +
			lines.join('\n') +
			(res.total > 8 ? '\n\n（仅显示前 8 条）' : '')
		);
	},

	bindBackupTap: function () {
		if (!AdminBiz.isAdmin(this)) return;

		pageHelper.showConfirm('导出活动、订单、流水、黑名单与已占用号码的 JSON 快照？', async () => {
			try {
				const res = await cloudHelper.callCloudData('admin/rush_backup', {}, { hint: false });
				if (!res) return;

				const c = res.counts || {};
				pageHelper.showModal(
					'数据快照已生成\n' + res.exportTimeStr + '\n\n' +
					'活动 ' + c.rush + ' 个\n' +
					'订单 ' + c.order + ' 条\n' +
					'流水 ' + c.checkin + ' 条\n' +
					'黑名单 ' + c.black + ' 条\n' +
					'已占号码 ' + c.code + ' 个\n\n' +
					'需要落盘留档可在云函数日志中取回'
				);
			} catch (e) {
				console.log(e);
			}
		});
	},

	bindCleanExportTap: function () {
		if (!AdminBiz.isAdmin(this)) return;

		pageHelper.showConfirm('删除已生成的导出文件（名单与流水）？', async () => {
			await cloudHelper.callCloudSumbit('admin/rush_export_del', { type: 'order' }).catch(() => { });
			await cloudHelper.callCloudSumbit('admin/rush_export_del', { type: 'checkin' }).catch(() => { });
			pageHelper.showSuccToast('已清理导出文件');
		});
	},

	/* ---------------- 放号提醒 ---------------- */

	bindRemindInput: function (e) {
		this.setData({ remindRushId: e.detail.value });
	},

	bindSendRemind: async function () {
		const rushId = String(this.data.remindRushId || '').trim();
		if (!rushId) {
			pageHelper.showModal('请填写活动 ID');
			return;
		}

		const callback = async () => {
			try {
				await cloudHelper.callCloudSumbit(
					'admin/rush_remind',
					{ rushId },
					{ title: '发送中...' }
				).then((res) => {
					const d = res.data || {};
					pageHelper.showModal(
						'共 ' + d.total + ' 位订阅者\n成功 ' + d.sent + ' 条' +
						(d.failed ? '，失败 ' + d.failed + ' 条' : '')
					);
				});
			} catch (e) {
				console.log(e);
			}
		};

		pageHelper.showConfirm('确认向该活动的订阅者群发开抢提醒？', callback);
	},
});
