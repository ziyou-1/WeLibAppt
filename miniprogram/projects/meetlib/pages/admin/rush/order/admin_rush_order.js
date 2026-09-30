/**
 * 闪抢预约名单页（超管 / 运营 / 核销员 / 只读）
 *
 * 展示号码、购买码、姓名、昵称、手机、openid、时段与状态，
 * 支持搜索（手机号/购买码/姓名）与状态筛选，
 * 并可一键导出 Excel：后端生成 xlsx → 取下载链接 → 小程序下载并打开。
 */

const AdminBiz = require('../../../../../../comm/biz/admin_biz.js');
const pageHelper = require('../../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../../helper/cloud_helper.js');

Page({

	data: {
		isLoad: false,
		dataList: { list: [] },
		rushId: '',
	},

	onLoad: function (options) {
		if (!AdminBiz.isAdmin(this)) return;

		const rushId = (options && options.rushId) || '';

		this.setData({
			rushId,
			search: '',
			sortItems: [],
			sortMenus: [
				{ label: '全部', type: '', value: '' },
				{ label: '已预约', type: 'status', value: 0 },
				{ label: '已核销', type: 'status', value: 1 },
				{ label: '已取消', type: 'status', value: 2 },
			],
			isLoad: true,
		});
	},

	onShow: function () { },

	onHide: function () { },

	onUnload: function () { },

	bindCommListCmpt: function (e) {
		if (!AdminBiz.isAdmin(this)) return;
		pageHelper.commListListener(this, e);
	},

	url: function (e) {
		pageHelper.url(e, this);
	},

	/** 导出 Excel：生成 -> 取链接 -> 下载打开 */
	bindExportTap: async function () {
		if (!AdminBiz.isAdmin(this)) return;

		const rushId = this.data.rushId || '';

		try {
			// 1) 后端生成表格
			await cloudHelper.callCloudSumbit(
				'admin/rush_order_export',
				{ rushId },
				{ title: '生成表格中...' }
			);

			// 2) 取下载链接
			const res = await cloudHelper.callCloudData(
				'admin/rush_export_url',
				{ type: 'order' },
				{ hint: false }
			);

			if (!res || !res.url) {
				pageHelper.showModal('导出文件未生成，请重试');
				return;
			}

			// 3) 下载并打开；失败则退化为复制链接
			wx.downloadFile({
				url: res.url,
				success: (r) => {
					wx.openDocument({
						filePath: r.tempFilePath,
						fileType: 'xlsx',
						showMenu: true,
						fail: () => this._copyUrl(res.url),
					});
				},
				fail: () => this._copyUrl(res.url),
			});
		} catch (e) {
			console.log(e);
		}
	},

	_copyUrl: function (url) {
		wx.setClipboardData({
			data: url,
			success: () => pageHelper.showModal('下载链接已复制，可在浏览器中打开'),
		});
	},

	/** 撤销核销（超管 / 运营） */
	bindRevertTap: async function (e) {
		if (!AdminBiz.isAdmin(this)) return;

		const orderId = pageHelper.dataset(e, 'id');
		if (!orderId) return;

		const callback = async () => {
			try {
				await cloudHelper.callCloudSumbit('admin/rush_cancel_checkin', { orderId }).then(() => {
					pageHelper.showSuccToast('已撤销核销');
					this._load();
				});
			} catch (e2) {
				console.log(e2);
			}
		};

		pageHelper.showConfirm('确认撤销该条的核销状态？', callback);
	},

	/** 取消预约并回收号码（超管 / 运营） */
	bindCancelOrderTap: function (e) {
		if (!AdminBiz.isAdmin(this)) return;

		const orderId = pageHelper.dataset(e, 'id');
		const no = pageHelper.dataset(e, 'no');
		if (!orderId) return;

		pageHelper.showConfirm(
			'确认取消 ' + (no ? '#' + no + ' ' : '') + '这条预约？\n号码会被放回池子，可被他人重新抢到。',
			async () => {
				try {
					await cloudHelper.callCloudSumbit('admin/rush_cancel_order', { orderId }).then(() => {
						pageHelper.showSuccToast('已取消并回收号码');
						this._load();
					});
				} catch (e2) {
					console.log(e2);
				}
			}
		);
	},

	/** 重新拉取列表（走组件的刷新） */
	_load: async function () {
		const list = this.selectComponent && this.selectComponent('#commList');
		if (list && list.loadList) {
			list.loadList(true);
			return;
		}
		// 组件没拿到 id 时退化为页面级刷新
		const res = await cloudHelper.callCloudData(
			'admin/rush_order_list',
			{ page: 1, size: 20 },
			{ hint: false }
		);
		if (res && res.list) this.setData({ dataList: res });
	},
});
