/**
 * 闪抢活动列表（用户端）
 *
 * 首页「闪抢」入口落地页。除了展示活动，还会定时静默刷新，
 * 让「待开抢 → 进行中 → 已结束」的状态在列表上自己变化，
 * 用户不用下拉也能看到开抢已经开始。
 */

const pageHelper = require('../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');

// 静默刷新间隔
const REFRESH_INTERVAL = 5000;

Page({

	data: {
		isLoad: false,
		list: [],
	},

	onLoad: async function (options) {
		ProjectBiz.initPage(this);

		await this._load();
		this.setData({ isLoad: true });
		this._startTimer();
	},

	onShow: function () {
		if (this.data.isLoad) {
			this._load(true);
			this._startTimer();
		}
	},

	onHide: function () {
		this._stopTimer();
	},

	onUnload: function () {
		this._stopTimer();
	},

	_startTimer: function () {
		this._stopTimer();
		this._timer = setInterval(() => {
			this._load(true);
		}, REFRESH_INTERVAL);
	},

	_stopTimer: function () {
		if (this._timer) {
			clearInterval(this._timer);
			this._timer = null;
		}
	},

	_load: async function () {
		const res = await cloudHelper.callCloudData(
			'rush/list',
			{ page: 1, size: 20 },
			{ hint: false }
		);

		if (!res || !res.list) return;

		this.setData({ list: res.list.map((item) => this._decorate(item)) });
	},

	/** 补上展示用文案 */
	_decorate: function (item) {
		const start = this._fmtTime(item.startTime);
		const end = this._fmtTime(item.endTime, true);

		let timeText = '';
		let tipClass = '';

		if (item.status === 1) {
			timeText = '开抢时间 ' + start;
			tipClass = 'wait';
		} else if (item.status === 2) {
			timeText = item.paused ? '已暂停放号' : ('进行中 · 至 ' + end);
			tipClass = item.paused ? 'pause' : 'run';
		} else {
			timeText = '已于 ' + end + ' 结束';
			tipClass = 'over';
		}

		return Object.assign({}, item, {
			timeText,
			tipClass,
			soldOut: item.total > 0 && item.left <= 0,
		});
	},

	_fmtTime: function (ts, short) {
		if (!ts) return '—';
		const d = new Date(Number(ts));
		const p = (n) => (n < 10 ? '0' + n : '' + n);
		const md = (d.getMonth() + 1) + '月' + d.getDate() + '日';
		const hm = p(d.getHours()) + ':' + p(d.getMinutes());
		return short ? (md + ' ' + hm) : (md + ' ' + hm);
	},

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

	onShareAppMessage: function () {
		return {
			title: '限时闪抢，手慢无',
			path: '/projects/meetlib/pages/rush/index/rush_index',
		};
	},
});
