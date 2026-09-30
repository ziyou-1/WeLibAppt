/**
 * 闪抢预约页
 *
 * 核心行为（对应需求）：
 *  - 用户停留在本页不动，到点后自动从「即将开抢」切到「可预约」
 *  - 不需要退出小程序、不需要重进页面、不需要手动下拉刷新
 *
 * 实现要点：
 *  1. 开页先与服务端校时（RTT/2 估算偏移），本地倒计时才可信
 *  2. 倒计时由本地定时器驱动，不消耗请求
 *  3. 倒计时归零后进入「抢号窗口」，以 300ms 间隔高频轮询轻量状态接口
 *  4. 一旦 hasStock=true 立即切换按钮，并停止轮询
 */

const pageHelper = require('../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');

// 抢号窗口内的轮询间隔（需求方案 A：300ms）
const POLL_INTERVAL = 300;
// 倒计时刷新间隔
const TICK_INTERVAL = 200;
// 轮询窗口最长持续时间，超时后降频为普通轮询
const POLL_WINDOW_MAX = 1000 * 60 * 30;

Page({
	data: {
		isLoad: false,

		rushId: '',
		detail: null,

		// waiting=倒计时中 grabbing=抢号窗口 ready=可抢 done=已抢到 over=已结束
		phase: 'loading',

		countdown: '',
		countdownSec: 0,

		hasStock: false,
		left: 0,
		total: 0,

		myOrder: null,
		btnText: '加载中',
		btnEnable: false,
	},

	onLoad: async function (options) {
		ProjectBiz.initPage(this);

		const rushId = (options && (options.id || options.rushId)) || '';
		if (!rushId) {
			wx.showModal({
				title: '提示',
				content: '缺少活动参数',
				showCancel: false,
				success: () => wx.navigateBack(),
			});
			return;
		}

		this._offset = 0; // 本地时间 -> 服务端时间的偏移
		this._tickTimer = null;
		this._pollTimer = null;
		this._pollStartedAt = 0;
		this._grabbing = false;

		this.setData({ rushId });

		await this._syncTime();
		await this._loadDetail();

		this.setData({ isLoad: true });
		this._startTick();
	},

	onShow: function () {
		// 从后台切回来时恢复，避免定时器丢失
		if (this.data.isLoad && !this._tickTimer) this._startTick();
	},

	onHide: function () {
		this._stopTick();
	},

	onUnload: function () {
		this._stopTick();
		this._stopPoll();
	},

	/* ============================================================
	 * 校时
	 * ============================================================ */

	/**
	 * 与服务端校时。
	 * 用一次 请求往返 的 RTT/2 估算本地时钟与服务端的偏移，
	 * 之后所有"现在几点"都走服务端时间轴，倒计时才不会被本地时间篡改。
	 */
	_syncTime: async function () {
		const t0 = Date.now();
		const res = await cloudHelper.callCloudData('rush/time');
		const t1 = Date.now();

		if (res && res.now) {
			this._offset = res.now + (t1 - t0) / 2 - t1;
		}
	},

	/** 当前服务端时间（毫秒） */
	_now: function () {
		return Date.now() + this._offset;
	},

	/* ============================================================
	 * 数据
	 * ============================================================ */

	_loadDetail: async function () {
		const detail = await cloudHelper.callCloudData('rush/detail', {
			rushId: this.data.rushId,
		});

		if (!detail) {
			this.setData({ phase: 'error', btnText: '加载失败' });
			return;
		}

		this.setData({
			detail,
			total: detail.total,
			left: detail.left,
			hasStock: detail.hasStock,
			myOrder: detail.myOrder,
		});

		this._refreshPhase();
	},

	/** 拉一次轻量状态（高频轮询走这里） */
	_fetchStatus: async function () {
		const st = await cloudHelper.callCloudData(
			'rush/status',
			{ rushId: this.data.rushId },
			{ hint: false }
		);
		if (!st) return null;

		this.setData({
			left: st.left,
			hasStock: st.hasStock,
		});

		return st;
	},

	/* ============================================================
	 * 状态机与倒计时
	 * ============================================================ */

	/** 根据服务端时间与详情，决定当前处于哪个阶段 */
	_refreshPhase: function () {
		const d = this.data.detail;
		if (!d) return;

		if (this.data.myOrder) {
			this.setData({ phase: 'done', btnText: '查看我的预约', btnEnable: true });
			return;
		}

		const now = this._now();

		if (d.endTime && now > d.endTime) {
			this.setData({ phase: 'over', btnText: '活动已结束', btnEnable: false });
			return;
		}

		if (d.startTime && now < d.startTime) {
			this.setData({ phase: 'waiting', btnEnable: false });
			return;
		}

		if (this._grabbing) {
			this.setData({ phase: 'grabbing', btnText: '抢号中…', btnEnable: false });
			return;
		}

		if (d.paused) {
			this.setData({ phase: 'waiting', btnText: '已暂停放号', btnEnable: false });
			return;
		}

		if (this.data.hasStock || this.data.left > 0) {
			this.setData({ phase: 'ready', btnText: '立即抢购', btnEnable: true });
		} else {
			this.setData({ phase: 'grabbing', btnText: '号源已抢完', btnEnable: false });
		}
	},

	_startTick: function () {
		this._stopTick();
		this._tickTimer = setInterval(() => {
			this._tick();
		}, TICK_INTERVAL);
		this._tick();
	},

	_stopTick: function () {
		if (this._tickTimer) {
			clearInterval(this._tickTimer);
			this._tickTimer = null;
		}
	},

	/** 倒计时跳动；归零则进入抢号窗口 */
	_tick: function () {
		const d = this.data.detail;
		if (!d) return;

		if (this.data.phase === 'over' || this.data.phase === 'done') return;

		const now = this._now();

		// 结束
		if (d.endTime && now > d.endTime) {
			this._stopPoll();
			this._stopTick();
			this.setData({ phase: 'over', btnText: '活动已结束', btnEnable: false });
			return;
		}

		// 未开抢：倒计时
		if (d.startTime && now < d.startTime) {
			const sec = Math.max(0, Math.ceil((d.startTime - now) / 1000));
			this.setData({
				phase: 'waiting',
				countdownSec: sec,
				countdown: this._fmtCountdown(sec),
				btnText: '距开抢 ' + this._fmtCountdown(sec),
				btnEnable: false,
			});

			if (sec <= 0) this._enterGrabWindow();
			return;
		}

		// 已到开抢时刻，但还没进入轮询 → 进入抢号窗口
		if (!this._grabbing && this.data.phase === 'waiting') {
			this._enterGrabWindow();
		}
	},

	_fmtCountdown: function (sec) {
		const h = Math.floor(sec / 3600);
		const m = Math.floor((sec % 3600) / 60);
		const s = sec % 60;
		const pad = (n) => (n < 10 ? '0' + n : '' + n);
		if (h > 0) return pad(h) + ':' + pad(m) + ':' + pad(s);
		return pad(m) + ':' + pad(s);
	},

	/* ============================================================
	 * 抢号窗口：高频轮询直到拿到库存
	 * ============================================================ */

	_enterGrabWindow: function () {
		if (this._grabbing) return;

		this._grabbing = true;
		this._pollStartedAt = Date.now();
		this.setData({ phase: 'grabbing', btnText: '抢号中…', btnEnable: false });

		this._stopTick();

		// 立刻拉一次，避免等一个轮询周期
		this._pollOnce();

		this._pollTimer = setInterval(() => {
			this._pollOnce();
		}, POLL_INTERVAL);
	},

	_stopPoll: function () {
		if (this._pollTimer) {
			clearInterval(this._pollTimer);
			this._pollTimer = null;
		}
	},

	/**
	 * 轮询一次状态；一旦拿到库存立即切换按钮并停止轮询。
	 * 若长时间没抢完（或已抢完），降频避免空转。
	 */
	_pollOnce: async function () {
		// 超过窗口上限则降频为 3 秒一次
		const elapsed = Date.now() - this._pollStartedAt;
		if (elapsed > POLL_WINDOW_MAX && this._pollTimer) {
			this._stopPoll();
			this._pollTimer = setInterval(() => this._pollOnce(), 3000);
		}

		const st = await this._fetchStatus();
		if (!st) return;

		const d = this.data.detail;

		// 已结束
		if (d && d.endTime && this._now() > d.endTime) {
			this._stopPoll();
			this._grabbing = false;
			this.setData({ phase: 'over', btnText: '活动已结束', btnEnable: false });
			return;
		}

		// ★ 关键切换点：服务端说有余量，立刻把按钮点亮
		if (st.hasStock) {
			this._stopPoll();
			this._grabbing = false;
			this.setData({
				phase: 'ready',
				hasStock: true,
				btnText: '立即抢购',
				btnEnable: true,
			});
			wx.vibrateShort && wx.vibrateShort({ type: 'medium' });
			return;
		}

		// 已抢完
		if (st.left <= 0) {
			this.setData({ btnText: '号源已抢完（可等回流）', btnEnable: false });
		}

		// 暂停放号
		if (st.paused) {
			this.setData({ btnText: '已暂停放号', btnEnable: false });
		}
	},

	/* ============================================================
	 * 交互
	 * ============================================================ */

	/** 点击按钮 */
	onTapBtn: async function () {
		if (!this.data.btnEnable) return;

		if (this.data.phase === 'done') {
			// 已有预约，滚动到凭证区
			wx.pageScrollTo && wx.pageScrollTo({ scrollTop: 0, duration: 200 });
			return;
		}

		if (this.data.phase !== 'ready') return;

		await this._doGrab();
	},

	_doGrab: async function () {
		wx.showLoading({ title: '抢号中…', mask: true });

		try {
			const res = await cloudHelper.callCloudSumbit('rush/grab', {
				rushId: this.data.rushId,
			});

			wx.hideLoading();

			if (res && res.data) {
				this._stopPoll();
				this._grabbing = false;
				this.setData({
					phase: 'done',
					myOrder: res.data,
					btnText: '抢号成功',
					btnEnable: false,
				});

				wx.showModal({
					title: '抢号成功',
					content: '你的号码：' + res.data.no + '\n购买码：' + res.data.code + '\n\n到店出示购买码核销',
					showCancel: false,
				});
			}
		} catch (err) {
			// callCloudSumbit 内部已弹窗，这里只恢复状态
			wx.hideLoading();

			// 抢失败很可能因为刚好被抢完，重新回到抢号窗口
			await this._fetchStatus();
			this._refreshPhase();
			if (!this.data.myOrder && this.data.left > 0) {
				this._enterGrabWindow();
			}
		}
	},

	/** 复制购买码 */
	onCopyCode: function () {
		const o = this.data.myOrder;
		if (!o || !o.code) return;
		wx.setClipboardData({
			data: o.code,
			success: () => wx.showToast({ title: '购买码已复制', icon: 'none' }),
		});
	},

	/**
	 * 取消预约
	 * 号码会被放回池子，可能被别人抢走，所以二次确认
	 */
	bindCancelTap: function () {
		const o = this.data.myOrder;
		if (!o || !o.orderId) return;

		pageHelper.showConfirm('取消后号码会被放回池子，可能被别人抢走。确认取消？', async () => {
			try {
				await cloudHelper.callCloudSumbit('rush/cancel', { orderId: o.orderId }).then(async () => {
					this.setData({ myOrder: null });
					pageHelper.showSuccToast('已取消预约');

					await this._syncTime();
					await this._loadDetail();
					if (!this._tickTimer) this._startTick();
				});
			} catch (e) {
				console.log(e);
			}
		});
	},

	/**
	 * 订阅开抢提醒
	 * 微信订阅消息是一次性授权：调起授权 -> 用户同意 -> 落一条待发送记录
	 */
	bindSubscribeTap: async function () {
		const d = this.data.detail;
		if (!d) return;

		const tmplId = d.tmplStart;
		if (!tmplId) {
			pageHelper.showModal('管理员尚未配置开抢提醒模板');
			return;
		}

		if (d.subscribed) {
			pageHelper.showModal('你已经订阅过开抢提醒了');
			return;
		}

		wx.requestSubscribeMessage({
			tmplIds: [tmplId],
			success: async (res) => {
				if (res[tmplId] !== 'accept') {
					pageHelper.showModal('你取消了订阅，将收不到开抢提醒');
					return;
				}

				try {
					await cloudHelper.callCloudSumbit('rush/subscribe', {
						rushId: this.data.rushId,
						type: 1,
						templateId: tmplId,
					}).then(() => {
						this.setData({ 'detail.subscribed': true });
						pageHelper.showSuccToast('已开启开抢提醒');
					});
				} catch (e) {
					console.log(e);
				}
			},
			fail: () => {
				pageHelper.showModal('订阅失败，请重试');
			},
		});
	},

	onPullDownRefresh: async function () {
		await this._syncTime();
		await this._loadDetail();
		wx.stopPullDownRefresh();
	},

	onShareAppMessage: function () {
		const d = this.data.detail;
		return {
			title: d ? d.title : '闪抢预约',
			path: '/projects/meetlib/pages/rush/detail/rush_detail?id=' + this.data.rushId,
		};
	},
});
