/**
 * 闪抢核销流水页（超管 / 运营 / 核销员 / 只读）
 *
 * 每一次核销与撤销核销各是一条记录，含时间、类型、核销员、设备。
 * 支持按类型筛选与一键导出 Excel。
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
				{ label: '核销', type: 'type', value: 1 },
				{ label: '撤销核销', type: 'type', value: 2 },
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

	/** 导出核销流水 Excel */
	bindExportTap: async function () {
		if (!AdminBiz.isAdmin(this)) return;

		const rushId = this.data.rushId || '';

		try {
			await cloudHelper.callCloudSumbit(
				'admin/rush_checkin_export',
				{ rushId },
				{ title: '生成表格中...' }
			);

			const res = await cloudHelper.callCloudData(
				'admin/rush_export_url',
				{ type: 'checkin' },
				{ hint: false }
			);

			if (!res || !res.url) {
				pageHelper.showModal('导出文件未生成，请重试');
				return;
			}

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
});
