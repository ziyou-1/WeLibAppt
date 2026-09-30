/**
 * 闪抢核销页（核销员 / 运营 / 超管）
 *
 * 输入或扫描购买码完成核销，并即时显示该码的归属信息，
 * 便于门店核对身份。核销动作在后端用条件更新做原子校验，
 * 同一个码被两人同时处理时只有一人会成功。
 */

const AdminBiz = require('../../../../../../comm/biz/admin_biz.js');
const pageHelper = require('../../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../../helper/cloud_helper.js');

Page({

	data: {
		isLoad: false,
		code: '',
		result: null,
		recent: [],
	},

	onLoad: function (options) {
		if (!AdminBiz.isAdmin(this)) return;

		this.setData({ isLoad: true });
		this._loadRecent();
	},

	onShow: function () { },

	onHide: function () { },

	onUnload: function () { },

	/** 手动输入 */
	bindCodeInput: function (e) {
		this.setData({ code: e.detail.value });
	},

	/** 扫码：兼容扫到纯码或带参数的链接 */
	bindScanTap: function () {
		wx.scanCode({
			success: (res) => {
				if (!res || !res.result) return;

				let code = String(res.result);
				const m = /[?&]code=([^&]+)/.exec(code);
				if (m) code = decodeURIComponent(m[1]);

				code = code.trim().toUpperCase();
				this.setData({ code });
				this._doCheckin(code);
			},
			fail: () => { },
		});
	},

	/** 点确认核销 */
	bindCheckinTap: async function () {
		const code = String(this.data.code || '').trim().toUpperCase();
		if (!code) {
			pageHelper.showModal('请输入购买码');
			return;
		}
		await this._doCheckin(code);
	},

	_doCheckin: async function (code) {
		try {
			await cloudHelper.callCloudSumbit(
				'admin/rush_checkin',
				{ code },
				{ title: '核销中...' }
			).then((res) => {
				this.setData({
					result: res.data,
					code: '',
				});

				if (wx.vibrateShort) wx.vibrateShort({ type: 'medium' });
				pageHelper.showSuccToast('核销成功');
				this._loadRecent();
			});
		} catch (e) {
			console.log(e);
		}
	},

	/** 最近核销记录 */
	_loadRecent: async function () {
		const list = await cloudHelper.callCloudData(
			'admin/rush_checkin_list',
			{ page: 1, size: 5 },
			{ hint: false }
		);
		if (list && list.list) {
			this.setData({ recent: list.list });
		}
	},

	/** 查看全部流水 */
	bindMoreTap: function () {
		wx.navigateTo({
			url: pageHelper.fmtURLByPID('/pages/admin/rush/record/admin_rush_record'),
		});
	},

	url: function (e) {
		pageHelper.url(e, this);
	},
});
