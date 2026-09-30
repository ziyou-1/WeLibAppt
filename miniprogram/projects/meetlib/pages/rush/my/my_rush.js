/**
 * 我的闪抢预约
 *
 * 抢到号之后回看凭证的地方：购买码、号码、状态都在这里，
 * 点击卡片回到活动详情页。
 */

const pageHelper = require('../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');

Page({

	data: {
		isLoad: false,
		list: [],
	},

	onLoad: async function (options) {
		ProjectBiz.initPage(this);

		await this._load();
		this.setData({ isLoad: true });
	},

	onShow: async function () {
		if (this.data.isLoad) await this._load();
	},

	onHide: function () { },

	onUnload: function () { },

	_load: async function () {
		const res = await cloudHelper.callCloudData(
			'rush/my_list',
			{ page: 1, size: 50 },
			{ hint: false }
		);

		if (res && res.list) {
			this.setData({ list: res.list });
		}
	},

	/** 复制购买码 */
	bindCopyTap: function (e) {
		const code = pageHelper.dataset(e, 'code');
		if (!code) return;

		wx.setClipboardData({
			data: code,
			success: () => wx.showToast({ title: '购买码已复制', icon: 'none' }),
		});
	},

	/** 取消预约 */
	bindCancelTap: function (e) {
		const orderId = pageHelper.dataset(e, 'orderid');
		if (!orderId) return;

		pageHelper.showConfirm('取消后号码会被放回池子，可能被别人抢走。确认取消？', async () => {
			try {
				await cloudHelper.callCloudSumbit('rush/cancel', { orderId }).then(async () => {
					pageHelper.showSuccToast('已取消预约');
					await this._load();
				});
			} catch (e2) {
				console.log(e2);
			}
		});
	},

	/** 回到活动详情 */
	bindItemTap: function (e) {
		const id = pageHelper.dataset(e, 'id');
		if (!id) return;

		wx.navigateTo({
			url: '../detail/rush_detail?id=' + id,
		});
	},

	url: function (e) {
		pageHelper.url(e, this);
	},

	onPullDownRefresh: async function () {
		await this._load();
		wx.stopPullDownRefresh();
	},
});
