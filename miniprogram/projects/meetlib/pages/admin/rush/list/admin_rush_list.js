/**
 * 闪抢活动管理页（超管 / 运营 / 只读）
 *
 * 列表展示状态与余量，并直接提供放号、暂停、锁定、扣减四类库存操作。
 * 所有写操作在后端都会再过一次角色权限校验，前端按钮只是省事。
 */

const AdminBiz = require('../../../../../../comm/biz/admin_biz.js');
const pageHelper = require('../../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../../helper/cloud_helper.js');

/** 时间戳 -> Y-M-D h:m */
function fmtTime(ts) {
	if (!ts) return '—';
	const d = new Date(Number(ts));
	const p = (n) => (n < 10 ? '0' + n : '' + n);
	return (
		d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
		' ' + p(d.getHours()) + ':' + p(d.getMinutes())
	);
}

/** 开抢倒计时文案 */
function fmtLeft(ts) {
	const diff = Number(ts) - Date.now();
	if (isNaN(diff)) return '';
	if (diff <= 0) return '';
	const m = Math.floor(diff / 60000);
	if (m < 60) return '（' + m + ' 分钟后）';
	const h = Math.floor(m / 60);
	if (h < 24) return '（' + h + ' 小时后）';
	return '（' + Math.floor(h / 24) + ' 天后）';
}

Page({

	data: {
		isLoad: false,
		dataList: { list: [] },

		// 库存操作弹窗
		showStock: false,
		stockTitle: '',
		stockTip: '',
		stockUnit: '',
		stockValue: '',
		stockAction: '',
		stockRushId: '',

		// 新建活动弹窗
		showAdd: false,
		addTitle: '',
		addDelay: '5',
		addDur: '60',
		addLimit: '1',
		addCount: '50',

		// 编辑活动弹窗
		showEdit: false,
		editId: '',
		editTitle: '',
		editLimit: '1',
		editDelay: '',
		editDur: '60',
	},

	onLoad: async function (options) {
		if (!AdminBiz.isAdmin(this)) return;
		this.setData(this._getSearchMenu());
	},

	onShow: function () { },

	onHide: function () { },

	onUnload: function () { },

	_getSearchMenu: function () {
		let sortItems = [];
		let sortMenus = [
			{ label: '全部', type: '', value: '' },
			{ label: '草稿', type: 'status', value: 0 },
			{ label: '待开抢', type: 'status', value: 1 },
			{ label: '进行中', type: 'status', value: 2 },
			{ label: '已结束', type: 'status', value: 3 },
		];

		return {
			search: '',
			sortItems,
			sortMenus,
			isLoad: true,
		};
	},

	/** 列表数据回调 */
	bindCommListCmpt: function (e) {
		if (!AdminBiz.isAdmin(this)) return;
		pageHelper.commListListener(this, e);

		// 补上可读时间与倒计时
		const list = (this.data.dataList && this.data.dataList.list) || [];
		let changed = false;
		for (const item of list) {
			const st = fmtTime(item.RUSH_START_TIME);
			const et = fmtTime(item.RUSH_END_TIME);
			if (item._startStr !== st) {
				item._startStr = st;
				item._leftStr = fmtLeft(item.RUSH_START_TIME);
				item._endStr = et;
				changed = true;
			}
		}
		if (changed) this.setData({ dataList: this.data.dataList });
	},

	url: function (e) {
		pageHelper.url(e, this);
	},

	/**
	 * 重新拉取列表
	 * 列表数据由 cmpt-comm-list 组件管理，onLoad 只设置搜索菜单，
	 * 所以改完活动后要自己把数据拉回来。
	 */
	_reload: async function () {
		const res = await cloudHelper.callCloudData(
			'admin/rush_list',
			{ page: 1, size: 20 },
			{ hint: false }
		);
		if (!res || !res.list) return;

		res.list = res.list.map((item) =>
			Object.assign({}, item, {
				_startStr: fmtTime(item.RUSH_START_TIME),
				_leftStr: fmtLeft(item.RUSH_START_TIME),
				_endStr: fmtTime(item.RUSH_END_TIME),
			})
		);

		this.setData({ dataList: res });
	},

	/* ---------------- 暂停 / 恢复 ---------------- */

	bindPauseTap: async function (e) {
		if (!AdminBiz.isAdmin(this)) return;

		const id = pageHelper.dataset(e, 'id');
		const cur = Number(pageHelper.dataset(e, 'pause')) === 1 ? 1 : 0;
		const pause = cur === 1 ? 0 : 1;

		try {
			await cloudHelper.callCloudSumbit('admin/rush_pause', { id, pause }).then(() => {
				pageHelper.modifyListNode(id, this.data.dataList.list, 'RUSH_PAUSE', pause, '_id');
				this.setData({ dataList: this.data.dataList });
				pageHelper.showSuccToast(pause ? '已暂停放号' : '已恢复放号');
			});
		} catch (e2) {
			console.log(e2);
		}
	},

	/* ---------------- 关闭活动 ---------------- */

	bindDelTap: function (e) {
		if (!AdminBiz.isAdmin(this)) return;

		const id = pageHelper.dataset(e, 'id');
		const title = pageHelper.dataset(e, 'title') || '';
		if (!id) return;

		pageHelper.showConfirm(
			'确认关闭活动「' + title + '」？\n关闭后状态置为已结束，前台不再展示为可抢。',
			async () => {
				try {
					await cloudHelper.callCloudSumbit('admin/rush_del', { id }).then(async () => {
						pageHelper.showSuccToast('已关闭');
						await this._reload();
					});
				} catch (e2) {
					console.log(e2);
				}
			}
		);
	},

	/* ---------------- 库存操作 ---------------- */

	bindStockTap: function (e) {
		if (!AdminBiz.isAdmin(this)) return;

		const action = pageHelper.dataset(e, 'action');
		const id = pageHelper.dataset(e, 'id');

		const conf = {
			publish: { title: '放号', tip: '输入本次放出的号码数量（生成号码池）', unit: '个', def: '50' },
			lock: { title: '锁定库存', tip: '锁定部分号源不对外放出，填 0 表示解锁定', unit: '个', def: '0' },
			reduce: { title: '手动扣减', tip: '占掉号码用于线下预留，填负数表示放回', unit: '个', def: '1' },
		}[action];

		if (!conf) return;

		this.setData({
			showStock: true,
			stockAction: action,
			stockRushId: id,
			stockTitle: conf.title,
			stockTip: conf.tip,
			stockUnit: conf.unit,
			stockValue: conf.def,
		});
	},

	bindStockInput: function (e) {
		this.setData({ stockValue: e.detail.value });
	},

	bindStockClose: function () {
		this.setData({ showStock: false });
	},

	bindStockConfirm: async function () {
		const { stockAction, stockRushId } = this.data;
		const value = Math.floor(Number(this.data.stockValue));

		if (isNaN(value)) {
			pageHelper.showModal('请输入数字');
			return;
		}
		if (stockAction !== 'lock' && value <= 0) {
			pageHelper.showModal('数量必须大于 0');
			return;
		}
		if (stockAction === 'lock' && value < 0) {
			pageHelper.showModal('锁定数量不能为负');
			return;
		}

		const routeMap = {
			publish: 'admin/rush_publish',
			lock: 'admin/rush_lock',
			reduce: 'admin/rush_reduce',
		};
		const paramsMap = {
			publish: { id: stockRushId, count: value },
			lock: { id: stockRushId, lock: value },
			reduce: { id: stockRushId, count: value },
		};

		try {
			await cloudHelper.callCloudSumbit(routeMap[stockAction], paramsMap[stockAction]).then((res) => {
				this.setData({ showStock: false });
				pageHelper.showSuccToast('操作成功');

				// 余量变了，重新拉列表
				const page = this.selectComponent && this.data.dataList;
				if (page) {
					setTimeout(() => {
						wx.pageScrollTo && wx.pageScrollTo({ scrollTop: 0, duration: 200 });
					}, 100);
				}
			});
		} catch (e) {
			console.log(e);
		}
	},

	/* ---------------- 编辑活动 ---------------- */

	bindEditTap: function (e) {
		if (!AdminBiz.isAdmin(this)) return;

		const id = pageHelper.dataset(e, 'id');
		const title = pageHelper.dataset(e, 'title');
		const limit = pageHelper.dataset(e, 'limit');

		this.setData({
			showEdit: true,
			editId: id,
			editTitle: title || '',
			editLimit: String(limit || 1),
			editDelay: '',
			editDur: '60',
		});
	},

	bindEditInput: function (e) {
		const key = pageHelper.dataset(e, 'key');
		if (!key) return;
		this.setData({ [key]: e.detail.value });
	},

	bindEditClose: function () {
		this.setData({ showEdit: false });
	},

	bindEditConfirm: async function () {
		const title = String(this.data.editTitle || '').trim();
		if (!title) {
			pageHelper.showModal('请填写活动名称');
			return;
		}

		const limit = Math.floor(Number(this.data.editLimit));
		if (isNaN(limit) || limit < 1) {
			pageHelper.showModal('单人限购需为不小于 1 的整数');
			return;
		}

		const params = { id: this.data.editId, title, limit };

		// 只有填了延迟分钟才重设开抢时间，留空表示保持原时间不动
		const delayRaw = String(this.data.editDelay || '').trim();
		if (delayRaw !== '') {
			const delay = Number(delayRaw);
			if (isNaN(delay) || delay < 0) {
				pageHelper.showModal('开抢延迟需为不小于 0 的分钟数');
				return;
			}

			const dur = Number(this.data.editDur);
			if (isNaN(dur) || dur <= 0) {
				pageHelper.showModal('持续时长需大于 0 分钟');
				return;
			}

			const now = Date.now();
			const startTime = now + delay * 60000;
			params.startTime = startTime;
			params.endTime = startTime + dur * 60000;
		}

		try {
			await cloudHelper.callCloudSumbit('admin/rush_edit', params).then(async () => {
				pageHelper.showSuccToast('已保存');
				this.setData({ showEdit: false });
				await this._reload();
			});
		} catch (e2) {
			console.log(e2);
		}
	},

	/* ---------------- 新建活动 ---------------- */

	bindAddTap: function () {
		if (!AdminBiz.isAdmin(this)) return;
		this.setData({
			showAdd: true,
			addTitle: '',
			addDelay: '5',
			addDur: '60',
			addLimit: '1',
			addCount: '50',
		});
	},

	bindAddInput: function (e) {
		const key = pageHelper.dataset(e, 'key');
		if (!key) return;
		this.setData({ [key]: e.detail.value });
	},

	bindAddClose: function () {
		this.setData({ showAdd: false });
	},

	bindAddConfirm: async function () {
		const title = String(this.data.addTitle || '').trim();
		if (!title) {
			pageHelper.showModal('请填写活动名称');
			return;
		}

		const delay = Number(this.data.addDelay);
		const dur = Number(this.data.addDur);
		const limit = Number(this.data.addLimit);
		const count = Number(this.data.addCount);

		if (isNaN(delay) || delay < 0) {
			pageHelper.showModal('开抢延迟需为不小于 0 的分钟数');
			return;
		}
		if (isNaN(dur) || dur <= 0) {
			pageHelper.showModal('持续时长需大于 0 分钟');
			return;
		}

		const now = Date.now();
		const startTime = now + delay * 60000;
		const endTime = startTime + dur * 60000;

		try {
			await cloudHelper.callCloudSumbit('admin/rush_insert', {
				title,
				startTime,
				endTime,
				limit: isNaN(limit) ? 1 : limit,
			}).then(async (res) => {
				const id = res.data && res.data.id;

				// 顺手放号
				if (id && count > 0) {
					await cloudHelper.callCloudSumbit(
						'admin/rush_publish',
						{ id, count },
						{ title: '放号中...' }
					).catch(() => { });
				}

				this.setData({ showAdd: false });
				pageHelper.showSuccToast('创建成功');

				wx.navigateTo({
					url: pageHelper.fmtURLByPID('/pages/admin/rush/order/admin_rush_order?rushId=' + id),
				});
			});
		} catch (e) {
			console.log(e);
		}
	},
});
