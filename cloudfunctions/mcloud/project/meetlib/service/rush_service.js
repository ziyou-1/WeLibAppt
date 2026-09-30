/**
 * Notes: 闪抢内核业务
 *
 * 设计要点：
 *  1. 状态不落库、按时间推导 —— 避免依赖定时器，开抢瞬间天然准确
 *  2. 余量 = 总量 - 已发放 - 锁定，O(1) 只读一个文档 —— 支撑高频状态轮询
 *  3. 防超卖用号码池 CAS：放号预生成 N 个号码文档，抢号 = 带条件原子更新占住其一
 *     条件里带 _id + CODE_TAKEN=0，占住才计数，天然不超发、不重发
 *  4. 时间一律以服务端为准，客户端只做倒计时显示
 */

const BaseProjectService = require('./base_project_service.js');

const RushModel = require('../model/rush_model.js');
const RushCodeModel = require('../model/rush_code_model.js');
const RushOrderModel = require('../model/rush_order_model.js');
const RushCheckinModel = require('../model/rush_checkin_model.js');
const RushBlackModel = require('../model/rush_black_model.js');
const RushSubscribeModel = require('../model/rush_subscribe_model.js');

const dbUtil = require('../../../framework/database/db_util.js');
const timeUtil = require('../../../framework/utils/time_util.js');
const dataUtil = require('../../../framework/utils/data_util.js');
const setupUtil = require('../../../framework/utils/setup/setup_util.js');
const exportUtil = require('../../../framework/utils/export_util.js');
const cloudBase = require('../../../framework/cloud/cloud_base.js');
const appCode = require('../../../framework/core/app_code.js');

// 抢号时最多尝试抢占多少个候选号
const GRAB_MAX_TRY = 8;
// 每次抓取的候选号数量
const GRAB_CANDIDATE_SIZE = 20;
// 购买码随机段长度
const CODE_RAND_LEN = 4;
// 购买码字符集（去掉 0/O/1/I 等易混字符）
const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
// 同一账号两次抢号请求的最小间隔（ms），用于挡住脚本高频刷
const GRAB_COOLDOWN_MS = 300;

// 单实例内的抢号节流表（云函数多实例时各自独立，仅作第一道闸）
const grabThrottle = new Map();

// 导出文件在 setup 表里的 key
const EXPORT_KEY_ORDER = 'rush_export_order';
const EXPORT_KEY_CHECKIN = 'rush_export_checkin';
// 风控节流阈值在 setup 表里的 key
const SETUP_KEY_THROTTLE_MS = 'rush_throttle_ms';

/**
 * 手动扣减（线下预留）占号时写入的占用者标记。
 * 这类占用会消耗号码与 RUSH_TAKEN，但不产生订单，
 * 自检与对账时需要与「真实订单占用」区分开。
 */
const RESERVE_USER = '__ADMIN_REDUCE__';

/** 读一个数值型配置：未配置时返回默认值，配置为 0 时返回 0（表示关闭） */
async function readNumberSetup(key, fallback) {
	const raw = await setupUtil.get(key);
	if (raw === null || raw === undefined || raw === '') return fallback;
	const n = Number(raw);
	return isNaN(n) ? fallback : n;
}

class RushService extends BaseProjectService {

	/* ============================================================
	 * 一、时间与状态（前端轮询用，必须极轻）
	 * ============================================================ */

	/**
	 * 服务端时间。前端用它做校时，算出租端与本地的偏移，
	 * 之后本地倒计时才可信。
	 */
	async getServerTime() {
		return {
			now: timeUtil.time(),
			zone: 'Asia/Shanghai',
		};
	}

	/**
	 * 按时间推导活动状态（不落库）
	 * 草稿态保持草稿，其余按时间轴推进
	 */
	_calcStatus(rush, now) {
		if (rush.RUSH_STATUS === RushModel.STATUS.DRAFT) return RushModel.STATUS.DRAFT;

		if (rush.RUSH_START_TIME && now < rush.RUSH_START_TIME) return RushModel.STATUS.WAIT;
		if (rush.RUSH_END_TIME && now > rush.RUSH_END_TIME) return RushModel.STATUS.OVER;
		if (rush.RUSH_END_TIME && now <= rush.RUSH_END_TIME) return RushModel.STATUS.RUNNING;

		return rush.RUSH_STATUS;
	}

	/**
	 * 可抢余量：总量 - 已发放 - 锁定
	 */
	_calcLeft(rush) {
		const left = Number(rush.RUSH_TOTAL || 0) - Number(rush.RUSH_TAKEN || 0) - Number(rush.RUSH_LOCK_STOCK || 0);
		return left > 0 ? left : 0;
	}

	/**
	 * 轻量状态接口 —— 高频轮询专用
	 * 只读一个文档，不做聚合，保证 1000 人并发时的吞吐
	 */
	async getRushStatus(rushId) {
		const now = timeUtil.time();

		const rush = await RushModel.getOne(
			rushId,
			'RUSH_ID,RUSH_TITLE,RUSH_STATUS,RUSH_START_TIME,RUSH_END_TIME,RUSH_TOTAL,RUSH_TAKEN,RUSH_LOCK_STOCK,RUSH_PAUSE,RUSH_LIMIT'
		);
		if (!rush) this.AppError('活动不存在');

		const status = this._calcStatus(rush, now);
		const left = this._calcLeft(rush);

		// 是否处于可抢状态：进行中 + 未暂停 + 有余量
		const canGrab = status === RushModel.STATUS.RUNNING && rush.RUSH_PAUSE !== 1 && left > 0;

		return {
			now,
			rushId: rush._id,
			title: rush.RUSH_TITLE,
			status,
			statusDesc: RushModel.STATUS_DESC[
				Object.keys(RushModel.STATUS).find((k) => RushModel.STATUS[k] === status)
			],
			startTime: rush.RUSH_START_TIME,
			endTime: rush.RUSH_END_TIME,
			left,
			taken: rush.RUSH_TAKEN,
			paused: rush.RUSH_PAUSE === 1,
			hasStock: canGrab,
			serverNow: now,
		};
	}

	/* ============================================================
	 * 二、抢号（防超卖核心）
	 * ============================================================ */

	/**
	 * 原子占住一个号码。
	 * 失败返回 null（号已被别人抢走或已抢完），调用方决定是否重试。
	 */
	async _takeOneCode(rushId, openid) {
		for (let attempt = 0; attempt < GRAB_MAX_TRY; attempt++) {
			// 抓一批候选号（只取未占用的）
			const candidates = await RushCodeModel.getList(
				{ RUSH_ID: rushId, CODE_TAKEN: 0 },
				'_id,CODE_NO,CODE_VALUE',
				{ CODE_NO: 'asc' },
				1,
				GRAB_CANDIDATE_SIZE,
				false
			);

			if (!candidates || !candidates.list || candidates.list.length === 0) return null;

			// 随机挑一个候选，降低多人抢同一号时的冲突率
			const list = candidates.list;
			const cand = list[Math.floor(Math.random() * list.length)];
			const now = timeUtil.time();

			// ★ 关键：带条件的原子更新（CAS）。
			// where 里同时限定 _id 与 CODE_TAKEN=0，
			// 只有真正把 0 改成 1 的那一次返回 updated=1，其余全部为 0。
			const updated = await RushCodeModel.edit(
				{ _id: cand._id, CODE_TAKEN: 0 },
				{
					CODE_TAKEN: 1,
					CODE_TAKEN_USER: openid,
					CODE_TAKEN_TIME: now,
				}
			);

			if (updated === 1) return cand;
			// 被别人抢先，换一个候选继续
		}
		return null;
	}

	/**
	 * 抢号
	 * @param {string} rushId
	 * @param {string} openid
	 * @param {object} params 预约表单
	 */
	async grab(rushId, openid, params = {}) {
		if (!openid) this.AppError('请先登录');

		const now = timeUtil.time();

		// 1) 读活动
		const rush = await RushModel.getOne(rushId);
		if (!rush) this.AppError('活动不存在');

		// 2) 时间窗 —— 以服务端时间为准，不信任客户端
		if (rush.RUSH_START_TIME && now < rush.RUSH_START_TIME)
			this.AppError('还未到开抢时间');

		if (rush.RUSH_END_TIME && now > rush.RUSH_END_TIME)
			this.AppError('本次活动已结束');

		// 3) 暂停放号
		if (rush.RUSH_PAUSE === 1) this.AppError('当前已暂停放号，请稍后再试');

		// 3.5) 风控：黑名单 —— 必须排在所有业务校验之前，
		//      否则被拉黑的账号会先撞上限购而拿不到风控提示
		const formData = this._pickOrderFields(params);
		await this.assertNotBlack(openid, formData.phone);

		// 3.6) 风控：抢号节流，防脚本高频刷接口
		await this.throttleGrab(openid);

		// 4) 余量快判（快速失败，避免无效竞争）
		if (this._calcLeft(rush) <= 0) this.AppError('号源已被抢完');

		// 5) 限购校验
		const limit = Number(rush.RUSH_LIMIT || 1);
		const mine = await RushOrderModel.count({
			RUSH_ID: rushId,
			RUSH_ORDER_USER_ID: openid,
			RUSH_ORDER_STATUS: ['in', '0,1'],
		});
		if (mine >= limit) this.AppError('你已达限购上限（' + limit + ' 份）');

		// 6) 占号（CAS）
		const code = await this._takeOneCode(rushId, openid);
		if (!code) {
			// 走到这里说明物理号已耗尽，回写真实余量便于前端刷新状态
			this.AppError('手慢了，号源已被抢完');
		}

		// 7) 落订单
		let orderId = '';
		try {
			orderId = await RushOrderModel.insert({
				RUSH_ID: rushId,
				RUSH_ORDER_USER_ID: openid,
				RUSH_ORDER_NO: code.CODE_NO,
				RUSH_ORDER_CODE: code.CODE_VALUE,
				RUSH_ORDER_NAME: formData.name,
				RUSH_ORDER_PHONE: formData.phone,
				RUSH_ORDER_NICK: formData.nick,
				RUSH_ORDER_SESSION: params.session || '',
				RUSH_ORDER_FORMS: params.forms || [],
				RUSH_ORDER_OBJ: params.obj || {},
				RUSH_ORDER_STATUS: RushOrderModel.STATUS.BOOKED,
				RUSH_ORDER_TIME: now,
			});
		} catch (err) {
			// 落库失败必须把号放回去，否则号会被永久占用
			await RushCodeModel.edit(
				{ _id: code._id },
				{ CODE_TAKEN: 0, CODE_TAKEN_USER: '', CODE_TAKEN_TIME: 0 }
			);
			throw err;
		}

		// 8) 回填号码归属 + 计数
		await RushCodeModel.edit({ _id: code._id }, { CODE_ORDER_ID: orderId });
		await RushModel.inc(rushId, 'RUSH_TAKEN', 1);

		return {
			orderId,
			no: code.CODE_NO,
			code: code.CODE_VALUE,
			title: rush.RUSH_TITLE,
			time: now,
		};
	}

	/** 从表单里抽取姓名 / 手机号 / 昵称做冗余字段 */
	_pickOrderFields(params = {}) {
		const obj = params.obj || {};
		const forms = params.forms || [];
		let name = params.name || obj.name || obj.NAME || '';
		let phone = params.phone || obj.phone || obj.mobile || obj.PHONE || '';
		let nick = params.nick || params.nickName || obj.nick || obj.nickName || '';

		if ((!name || !phone) && Array.isArray(forms)) {
			for (const f of forms) {
				if (!f) continue;
				const v = f.val === undefined ? '' : String(f.val);
				if (!name && (f.type === 'text' || f.title === '姓名')) name = v;
				if (!phone && (f.type === 'mobile' || f.title === '手机')) phone = v;
			}
		}
		return { name: name || '', phone: phone || '', nick: nick || '' };
	}

	/**
	 * 我的闪抢预约列表（跨活动）
	 * 用户抢到号后需要一个地方回看购买码，这里按时间倒序汇总。
	 */
	async getMyOrderList(openid, params = {}) {
		if (!openid) return { list: [], total: 0, page: 1, size: 20 };

		const data = await RushOrderModel.getList(
			{ RUSH_ORDER_USER_ID: openid },
			'RUSH_ID,RUSH_ORDER_ID,RUSH_ORDER_NO,RUSH_ORDER_CODE,RUSH_ORDER_STATUS,RUSH_ORDER_TIME,RUSH_ORDER_CHECKIN_TIME,RUSH_ORDER_SESSION,RUSH_ORDER_NICK',
			{ RUSH_ORDER_TIME: 'desc' },
			params.page || 1,
			params.size || 20
		);

		const STATUS_KEY = ['BOOKED', 'CHECKIN', 'CANCEL'];
		const cache = {};

		for (const o of data.list || []) {
			if (cache[o.RUSH_ID] === undefined) {
				const r = await RushModel.getOne({ _id: o.RUSH_ID }, 'RUSH_TITLE,RUSH_PLACE,RUSH_START_TIME,RUSH_END_TIME');
				cache[o.RUSH_ID] = r || {};
			}
			const r = cache[o.RUSH_ID];

			o.rushTitle = r.RUSH_TITLE || '（活动已删除）';
			o.rushPlace = r.RUSH_PLACE || '';
			o.startTime = r.RUSH_START_TIME || 0;
			o.orderId = o._id;
			o.statusDesc = RushOrderModel.STATUS_DESC[STATUS_KEY[o.RUSH_ORDER_STATUS]] || '';
			o.timeText = o.RUSH_ORDER_TIME ? timeUtil.timestamp2Time(o.RUSH_ORDER_TIME, 'Y-M-D h:m') : '';
		}

		return data;
	}

	/**
	 * 用户取消自己的预约
	 *
	 * 取消后号码会回收回池子（CODE_TAKEN 置回 0），可被别人重新抢到；
	 * 同时回退活动计数。用条件更新保证「已核销」的不能被取消。
	 */
	async cancelMyOrder(orderId, openid) {
		if (!openid) this.AppError('请先登录');
		if (!orderId) this.AppError('缺少预约参数');

		const order = await RushOrderModel.getOne(
			orderId,
			'RUSH_ID,RUSH_ORDER_ID,RUSH_ORDER_CODE,RUSH_ORDER_STATUS,RUSH_ORDER_USER_ID'
		);
		if (!order) this.AppError('预约不存在');

		if (order.RUSH_ORDER_USER_ID !== openid) this.AppError('只能取消自己的预约');
		if (order.RUSH_ORDER_STATUS === RushOrderModel.STATUS.CANCEL) this.AppError('该预约已取消');
		if (order.RUSH_ORDER_STATUS === RushOrderModel.STATUS.CHECKIN) this.AppError('已核销的预约不能取消');

		// 原子取消：只有当前仍是「已预约」才能改
		const updated = await RushOrderModel.edit(
			{ _id: orderId, RUSH_ORDER_STATUS: RushOrderModel.STATUS.BOOKED },
			{ RUSH_ORDER_STATUS: RushOrderModel.STATUS.CANCEL }
		);
		if (updated !== 1) this.AppError('取消失败，该预约状态已变化，请刷新后重试');

		// 回收号码，放回池子
		await RushCodeModel.edit(
			{ RUSH_ID: order.RUSH_ID, CODE_VALUE: order.RUSH_ORDER_CODE },
			{ CODE_TAKEN: 0, CODE_ORDER_ID: '', CODE_TAKEN_USER: '', CODE_TAKEN_TIME: 0 }
		);

		await RushModel.inc(order.RUSH_ID, 'RUSH_TAKEN', -1);
		await RushModel.inc(order.RUSH_ID, 'RUSH_TAKEN_BACK', 1);

		return { ok: true };
	}

	/** 我的预约 */
	async getMyOrder(rushId, openid) {		if (!openid) return null;
		const one = await RushOrderModel.getOne(
			{ RUSH_ID: rushId, RUSH_ORDER_USER_ID: openid, RUSH_ORDER_STATUS: ['in', '0,1'] },
			'RUSH_ORDER_ID,RUSH_ORDER_NO,RUSH_ORDER_CODE,RUSH_ORDER_STATUS,RUSH_ORDER_TIME',
			{ RUSH_ORDER_TIME: 'desc' }
		);
		if (!one) return null;
		return {
			// 用主键 _id：取消等后续操作都按主键定位，返回业务ID会对不上
			orderId: one._id,
			no: one.RUSH_ORDER_NO,
			code: one.RUSH_ORDER_CODE,
			status: one.RUSH_ORDER_STATUS,
			statusDesc: RushOrderModel.STATUS_DESC[
				Object.keys(RushOrderModel.STATUS).find((k) => RushOrderModel.STATUS[k] === one.RUSH_ORDER_STATUS)
			],
			time: one.RUSH_ORDER_TIME,
		};
	}

	/**
	 * 前台活动列表
	 * 只返回已发布的活动（草稿不可见），按开抢时间倒序，
	 * 并附带服务端推导出的状态与余量，前端拿到即可直接渲染。
	 */
	async getRushList(params = {}) {
		const now = timeUtil.time();

		const where = {
			RUSH_STATUS: ['<>', RushModel.STATUS.DRAFT],
		};

		const data = await RushModel.getList(
			where,
			'RUSH_ID,RUSH_TITLE,RUSH_DESC,RUSH_PIC,RUSH_PLACE,RUSH_START_TIME,RUSH_END_TIME,RUSH_TOTAL,RUSH_TAKEN,RUSH_LOCK_STOCK,RUSH_LIMIT,RUSH_STATUS,RUSH_PAUSE',
			{ RUSH_START_TIME: 'desc' },
			params.page || 1,
			params.size || 20
		);

		const STATUS_KEY = ['DRAFT', 'WAIT', 'RUNNING', 'OVER'];

		data.list = (data.list || []).map((r) => {
			const status = this._calcStatus(r, now);
			const left = this._calcLeft(r);
			const paused = r.RUSH_PAUSE === 1;

			return {
				id: r._id,
				title: r.RUSH_TITLE,
				desc: r.RUSH_DESC,
				pic: r.RUSH_PIC,
				place: r.RUSH_PLACE,
				startTime: r.RUSH_START_TIME,
				endTime: r.RUSH_END_TIME,
				total: r.RUSH_TOTAL,
				limit: r.RUSH_LIMIT,
				left,
				status,
				statusDesc: RushModel.STATUS_DESC[STATUS_KEY[status]] || '',
				paused,
				hasStock: status === RushModel.STATUS.RUNNING && !paused && left > 0,
			};
		});

		data.serverNow = now;
		return data;
	}

	/** 前台详情（含我的预约状态） */
	async getRushDetail(rushId, openid) {		const rush = await RushModel.getOne(
			rushId,
			'RUSH_ID,RUSH_TITLE,RUSH_DESC,RUSH_PIC,RUSH_NOTICE,RUSH_PLACE,RUSH_START_TIME,RUSH_END_TIME,RUSH_TOTAL,RUSH_TAKEN,RUSH_LOCK_STOCK,RUSH_PAUSE,RUSH_LIMIT,RUSH_STATUS,RUSH_FORMS'
		);
		if (!rush) this.AppError('活动不存在');

		const now = timeUtil.time();
		const status = this._calcStatus(rush, now);
		const left = this._calcLeft(rush);
		const myOrder = await this.getMyOrder(rushId, openid);

		// 下发开抢提醒的模板 ID，前端拿它调 wx.requestSubscribeMessage
		const tmplStart = (await setupUtil.get(RushSubscribeModel.SETUP_KEY.START)) || '';

		// 该用户是否已经订阅过（用于按钮文案）
		let subscribed = false;
		if (openid && tmplStart) {
			const sub = await RushSubscribeModel.getOne(
				{
					SUB_USER_ID: openid,
					SUB_RUSH_ID: rushId,
					SUB_TYPE: RushSubscribeModel.TYPE.START,
					SUB_STATUS: RushSubscribeModel.STATUS.WAIT,
				},
				'SUB_ID'
			);
			subscribed = !!sub;
		}

		return {
			rushId: rush._id,
			title: rush.RUSH_TITLE,
			desc: rush.RUSH_DESC,
			pic: rush.RUSH_PIC,
			notice: rush.RUSH_NOTICE,
			place: rush.RUSH_PLACE,
			startTime: rush.RUSH_START_TIME,
			endTime: rush.RUSH_END_TIME,
			total: rush.RUSH_TOTAL,
			left,
			limit: rush.RUSH_LIMIT,
			status,
			paused: rush.RUSH_PAUSE === 1,
			hasStock: status === RushModel.STATUS.RUNNING && rush.RUSH_PAUSE !== 1 && left > 0,
			forms: rush.RUSH_FORMS || [],
			myOrder,
			tmplStart,
			subscribed,
			serverNow: now,
		};
	}

	/* ============================================================
	 * 三、放号与库存管理（后台）
	 * ============================================================ */

	/** 生成购买码：短、唯一度足够、去掉易混字符 */
	_makeCode(no) {
		let rand = '';
		for (let i = 0; i < CODE_RAND_LEN; i++) {
			rand += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
		}
		return 'R' + String(no).padStart(5, '0') + rand;
	}

	/**
	 * 放号：预生成号码池
	 * @param {string} rushId
	 * @param {number} count 放号数量
	 */
	async adminPublish(rushId, count) {
		count = Math.floor(Number(count) || 0);
		if (count <= 0) this.AppError('放号数量必须大于 0');
		if (count > 2000) this.AppError('单次放号不能超过 2000');

		const rush = await RushModel.getOne(rushId, 'RUSH_ID,RUSH_TOTAL,RUSH_TITLE');
		if (!rush) this.AppError('活动不存在');

		// 从当前最大序号往后排，保证号码连续且不重复
		const maxNo = await RushCodeModel.max({ RUSH_ID: rushId }, 'CODE_NO');
		const startNo = Number(maxNo || 0) + 1;

		const now = timeUtil.time();
		const batch = [];
		for (let i = 0; i < count; i++) {
			const no = startNo + i;
			batch.push({
				RUSH_ID: rushId,
				CODE_NO: no,
				CODE_VALUE: this._makeCode(no),
				CODE_TAKEN: 0,
				CODE_ORDER_ID: '',
				CODE_TAKEN_TIME: 0,
				CODE_TAKEN_USER: '',
			});
		}

		await RushCodeModel.insertBatch(batch, 500);
		await RushModel.inc(rushId, 'RUSH_TOTAL', count);

		return { published: count, total: Number(rush.RUSH_TOTAL || 0) + count, startNo };
	}

	/** 一键暂停 / 恢复放号 */
	async adminTogglePause(rushId, pause) {
		const p = pause ? 1 : 0;
		const updated = await RushModel.edit(rushId, { RUSH_PAUSE: p });
		if (!updated) this.AppError('活动不存在');
		return { pause: p, desc: p ? '已暂停放号' : '已恢复放号' };
	}

	/** 锁定库存（锁定部分不放出） */
	async adminSetLock(rushId, lock) {
		lock = Math.floor(Number(lock) || 0);
		if (lock < 0) this.AppError('锁定数量不能为负');
		const updated = await RushModel.edit(rushId, { RUSH_LOCK_STOCK: lock });
		if (!updated) this.AppError('活动不存在');
		return { lock };
	}

	/** 手动扣减库存：直接占掉若干号码（如线下预留） */
	async adminReduceStock(rushId, count) {
		count = Math.floor(Number(count) || 0);
		if (count <= 0) this.AppError('扣减数量必须大于 0');

		let done = 0;
		for (let i = 0; i < count; i++) {
			const code = await this._takeOneCode(rushId, RESERVE_USER);
			if (!code) break;
			await RushModel.inc(rushId, 'RUSH_TAKEN', 1);
			done++;
		}
		if (done === 0) this.AppError('没有可扣减的号源');
		return { reduced: done };
	}

	/* ============================================================
	 * 四、后台：活动管理
	 * ============================================================ */

	async adminList(params = {}) {
		const where = {};
		if (params.title) where.RUSH_TITLE = ['like', params.title];
		if (util_isDefined(params.status)) where.RUSH_STATUS = Number(params.status);

		const data = await RushModel.getList(
			where,
			'RUSH_ID,RUSH_TITLE,RUSH_START_TIME,RUSH_END_TIME,RUSH_TOTAL,RUSH_TAKEN,RUSH_LOCK_STOCK,RUSH_STATUS,RUSH_PAUSE,RUSH_LIMIT,RUSH_ADD_TIME',
			{ RUSH_ORDER: 'asc', RUSH_ADD_TIME: 'desc' },
			params.page || 1,
			params.size || 20
		);

		const now = timeUtil.time();
		data.list = (data.list || []).map((r) => {
			const status = this._calcStatus(r, now);
			return Object.assign({}, r, {
				id: r._id,
				realStatus: status,
				realStatusDesc: RushModel.STATUS_DESC[
					Object.keys(RushModel.STATUS).find((k) => RushModel.STATUS[k] === status)
				],
				left: this._calcLeft(r),
			});
		});
		return data;
	}

	async adminDetail(rushId) {
		const rush = await RushModel.getOne(rushId);
		if (!rush) this.AppError('活动不存在');
		const now = timeUtil.time();
		const status = this._calcStatus(rush, now);
		return Object.assign({}, rush, {
			id: rush._id,
			realStatus: status,
			realStatusDesc: RushModel.STATUS_DESC[
				Object.keys(RushModel.STATUS).find((k) => RushModel.STATUS[k] === status)
			],
			left: this._calcLeft(rush),
		});
	}

	async adminInsert(params, admin) {
		const startTime = Number(params.startTime || 0);
		const endTime = Number(params.endTime || 0);
		if (!startTime) this.AppError('请设置开抢时间');
		if (!endTime) this.AppError('请设置结束时间');
		if (endTime <= startTime) this.AppError('结束时间必须晚于开抢时间');

		const data = {
			RUSH_TITLE: params.title || '未命名活动',
			RUSH_DESC: params.desc || '',
			RUSH_PIC: params.pic || '',
			RUSH_NOTICE: params.notice || '',
			RUSH_PLACE: params.place || '',
			RUSH_START_TIME: startTime,
			RUSH_END_TIME: endTime,
			RUSH_TOTAL: 0,
			RUSH_LIMIT: Number(params.limit || 1),
			RUSH_LOCK_STOCK: 0,
			RUSH_TAKEN: 0,
			RUSH_TAKEN_BACK: 0,
			// 创建即进入"待开抢"（草稿可显式传 0）
			RUSH_STATUS: util_isDefined(params.status) ? Number(params.status) : RushModel.STATUS.WAIT,
			RUSH_PAUSE: 0,
			RUSH_ORDER: Number(params.order || 9999),
			RUSH_FORMS: params.forms || [
				{ type: 'text', title: '姓名', must: true, mark: 'name' },
				{ type: 'mobile', title: '手机', must: true, mark: 'phone' },
			],
			RUSH_OBJ: {},
			RUSH_SESSIONS: params.sessions || [],
			RUSH_ADMIN_ID: (admin && admin.ADMIN_ID) || '',
		};

		const id = await RushModel.insert(data);
		return { id };
	}

	async adminEdit(rushId, params) {
		const rush = await RushModel.getOne(rushId, 'RUSH_ID');
		if (!rush) this.AppError('活动不存在');

		const data = {};
		if (util_isDefined(params.title)) data.RUSH_TITLE = params.title;
		if (util_isDefined(params.desc)) data.RUSH_DESC = params.desc;
		if (util_isDefined(params.pic)) data.RUSH_PIC = params.pic;
		if (util_isDefined(params.notice)) data.RUSH_NOTICE = params.notice;
		if (util_isDefined(params.place)) data.RUSH_PLACE = params.place;
		if (util_isDefined(params.limit)) data.RUSH_LIMIT = Number(params.limit);
		if (util_isDefined(params.order)) data.RUSH_ORDER = Number(params.order);
		if (util_isDefined(params.forms)) data.RUSH_FORMS = params.forms;
		if (util_isDefined(params.sessions)) data.RUSH_SESSIONS = params.sessions;

		if (util_isDefined(params.startTime) || util_isDefined(params.endTime)) {
			const st = Number(params.startTime || (rush.RUSH_START_TIME || 0));
			const et = Number(params.endTime || (rush.RUSH_END_TIME || 0));
			if (et <= st) this.AppError('结束时间必须晚于开抢时间');
			data.RUSH_START_TIME = st;
			data.RUSH_END_TIME = et;
		}

		// 状态流转只允许显式设置草稿 / 待开抢（进行中、已结束由时间推导）
		if (util_isDefined(params.status)) {
			const s = Number(params.status);
			if (s === RushModel.STATUS.DRAFT || s === RushModel.STATUS.WAIT) data.RUSH_STATUS = s;
		}

		if (Object.keys(data).length === 0) return { updated: 0 };
		const updated = await RushModel.edit(rushId, data);
		return { updated };
	}

	async adminDel(rushId) {
		const updated = await RushModel.edit(rushId, { RUSH_STATUS: RushModel.STATUS.OVER });
		return { updated };
	}

	/* ============================================================
	 * 五、后台：名单 / 核销 / 导出
	 * ============================================================ */

	async adminOrderList(params = {}) {
		const where = {};
		if (params.rushId) where.RUSH_ID = params.rushId;
		if (util_isDefined(params.status)) where.RUSH_ORDER_STATUS = Number(params.status);
		if (params.key) {
			// 手机号 / 购买码 / 号码 模糊搜
			where.or = [
				{ RUSH_ORDER_PHONE: ['like', params.key] },
				{ RUSH_ORDER_CODE: ['like', params.key] },
				{ RUSH_ORDER_NAME: ['like', params.key] },
			];
		}

		const data = await RushOrderModel.getList(
			where,
			'RUSH_ID,RUSH_ORDER_ID,RUSH_ORDER_USER_ID,RUSH_ORDER_NO,RUSH_ORDER_CODE,RUSH_ORDER_NAME,RUSH_ORDER_PHONE,RUSH_ORDER_NICK,RUSH_ORDER_SESSION,RUSH_ORDER_STATUS,RUSH_ORDER_TIME,RUSH_ORDER_CHECKIN_TIME,RUSH_ORDER_CHECKIN_ADMIN',
			{ RUSH_ORDER_NO: 'asc', RUSH_ORDER_TIME: 'desc' },
			params.page || 1,
			params.size || 20
		);

		data.list = (data.list || []).map((o) =>
			Object.assign({}, o, {
				statusDesc: RushOrderModel.STATUS_DESC[
					Object.keys(RushOrderModel.STATUS).find((k) => RushOrderModel.STATUS[k] === o.RUSH_ORDER_STATUS)
				],
			})
		);
		return data;
	}

	/**
	 * 核销：按购买码
	 * 同样用条件更新做原子校验，避免同一码被两个核销员同时核销
	 */
	async adminCheckin(code, admin, device = '') {
		if (!code) this.AppError('请提供购买码');
		const c = String(code).trim().toUpperCase();

		const order = await RushOrderModel.getOne(
			{ RUSH_ORDER_CODE: c },
			'RUSH_ORDER_ID,RUSH_ID,RUSH_ORDER_CODE,RUSH_ORDER_NO,RUSH_ORDER_STATUS,RUSH_ORDER_NAME,RUSH_ORDER_PHONE,RUSH_ORDER_USER_ID'
		);
		if (!order) this.AppError('购买码不存在');

		if (order.RUSH_ORDER_STATUS === RushOrderModel.STATUS.CHECKIN) this.AppError('该码已核销过了');
		if (order.RUSH_ORDER_STATUS === RushOrderModel.STATUS.CANCEL) this.AppError('该预约已取消');

		const now = timeUtil.time();
		// 原子核销：只有状态仍为「已预约」时才能改成「已核销」
		const updated = await RushOrderModel.edit(
			{ _id: order._id, RUSH_ORDER_STATUS: RushOrderModel.STATUS.BOOKED },
			{
				RUSH_ORDER_STATUS: RushOrderModel.STATUS.CHECKIN,
				RUSH_ORDER_CHECKIN_TIME: now,
				RUSH_ORDER_CHECKIN_ADMIN: (admin && admin.ADMIN_NAME) || '',
				RUSH_ORDER_CHECKIN_ADMIN_ID: (admin && admin.ADMIN_ID) || '',
				RUSH_ORDER_CHECKIN_DEVICE: device || '',
			}
		);

		if (updated !== 1) this.AppError('核销失败，该码可能刚被其他核销员处理');

		// 落核销流水
		await this._writeCheckinLog(order, RushCheckinModel.TYPE.CHECKIN, admin, device, now);

		return {
			no: order.RUSH_ORDER_NO,
			code: order.RUSH_ORDER_CODE,
			name: order.RUSH_ORDER_NAME,
			phone: order.RUSH_ORDER_PHONE,
			time: now,
		};
	}

	/** 撤销核销 */
	async adminCancelCheckin(orderId, admin) {

		const order = await RushOrderModel.getOne(orderId,
			'RUSH_ORDER_ID,RUSH_ID,RUSH_ORDER_CODE,RUSH_ORDER_NO,RUSH_ORDER_NAME,RUSH_ORDER_PHONE,RUSH_ORDER_USER_ID,RUSH_ORDER_STATUS');
		if (!order) this.AppError('订单不存在');

		const updated = await RushOrderModel.edit(
			{ _id: orderId, RUSH_ORDER_STATUS: RushOrderModel.STATUS.CHECKIN },
			{
				RUSH_ORDER_STATUS: RushOrderModel.STATUS.BOOKED,
				RUSH_ORDER_CHECKIN_TIME: 0,
				RUSH_ORDER_CHECKIN_ADMIN: '',
				RUSH_ORDER_CHECKIN_ADMIN_ID: '',
			}
		);
		if (updated !== 1) this.AppError('撤销失败，该记录不是已核销状态');

		await this._writeCheckinLog(order, RushCheckinModel.TYPE.REVERT, admin, '', timeUtil.time());

		return { updated };
	}

	/**
	 * 取消预约并回收号码（号回到池子里，可被别人抢）
	 */
	async adminCancelOrder(orderId) {
		const order = await RushOrderModel.getOne(orderId, 'RUSH_ID,RUSH_ORDER_CODE,RUSH_ORDER_STATUS');
		if (!order) this.AppError('订单不存在');
		if (order.RUSH_ORDER_STATUS === RushOrderModel.STATUS.CANCEL) this.AppError('该预约已取消');

		await RushOrderModel.edit({ _id: orderId }, { RUSH_ORDER_STATUS: RushOrderModel.STATUS.CANCEL });

		// 释放号码
		await RushCodeModel.edit(
			{ RUSH_ID: order.RUSH_ID, CODE_VALUE: order.RUSH_ORDER_CODE },
			{ CODE_TAKEN: 0, CODE_ORDER_ID: '', CODE_TAKEN_USER: '', CODE_TAKEN_TIME: 0 }
		);

		await RushModel.inc(order.RUSH_ID, 'RUSH_TAKEN', -1);
		await RushModel.inc(order.RUSH_ID, 'RUSH_TAKEN_BACK', 1);
		return { ok: true };
	}

	/** 导出用全量数据 */
	async adminOrderExportList(params = {}) {
		const where = {};
		if (params.rushId) where.RUSH_ID = params.rushId;
		if (util_isDefined(params.status)) where.RUSH_ORDER_STATUS = Number(params.status);

		return await RushOrderModel.getAllBig(
			where,
			'RUSH_ORDER_NO,RUSH_ORDER_CODE,RUSH_ORDER_NAME,RUSH_ORDER_PHONE,RUSH_ORDER_NICK,RUSH_ORDER_SESSION,RUSH_ORDER_USER_ID,RUSH_ORDER_STATUS,RUSH_ORDER_TIME,RUSH_ORDER_CHECKIN_TIME,RUSH_ORDER_CHECKIN_ADMIN',
			{ RUSH_ORDER_NO: 'asc' }
		);
	}

	/* ============================================================
	 * 六、核销流水
	 * ============================================================ */

	/** 写一条核销 / 撤销核销流水 */
	async _writeCheckinLog(order, type, admin, device, time) {
		await RushCheckinModel.insert({
			RUSH_ID: order.RUSH_ID || '',
			// 存订单主键 _id：后台与撤销接口都按主键定位，存业务 ID 会对不上
			CHECKIN_ORDER_ID: order._id || order.RUSH_ORDER_ID || '',
			CHECKIN_CODE: order.RUSH_ORDER_CODE || '',
			CHECKIN_NO: Number(order.RUSH_ORDER_NO || 0),
			CHECKIN_USER_ID: order.RUSH_ORDER_USER_ID || '',
			CHECKIN_NAME: order.RUSH_ORDER_NAME || '',
			CHECKIN_PHONE: order.RUSH_ORDER_PHONE || '',
			CHECKIN_TYPE: type,
			CHECKIN_ADMIN_ID: (admin && admin.ADMIN_ID) || '',
			CHECKIN_ADMIN_NAME: (admin && admin.ADMIN_NAME) || '',
			CHECKIN_DEVICE: device || '',
			CHECKIN_TIME: time || timeUtil.time(),
		});
	}

	/** 核销流水列表 */
	async adminCheckinList(params = {}) {
		const where = {};
		if (params.rushId) where.RUSH_ID = params.rushId;
		if (util_isDefined(params.type)) where.CHECKIN_TYPE = Number(params.type);
		if (params.adminId) where.CHECKIN_ADMIN_ID = params.adminId;
		if (params.key) {
			where.or = [
				{ CHECKIN_CODE: ['like', params.key] },
				{ CHECKIN_PHONE: ['like', params.key] },
				{ CHECKIN_NAME: ['like', params.key] },
			];
		}

		const data = await RushCheckinModel.getList(
			where,
			'RUSH_ID,CHECKIN_ID,CHECKIN_ORDER_ID,CHECKIN_CODE,CHECKIN_NO,CHECKIN_NAME,CHECKIN_PHONE,CHECKIN_TYPE,CHECKIN_ADMIN_NAME,CHECKIN_DEVICE,CHECKIN_TIME',
			{ CHECKIN_TIME: 'desc' },
			params.page || 1,
			params.size || 20
		);

		data.list = (data.list || []).map((o) =>
			Object.assign({}, o, {
				typeDesc: RushCheckinModel.TYPE_DESC[
					Object.keys(RushCheckinModel.TYPE).find((k) => RushCheckinModel.TYPE[k] === o.CHECKIN_TYPE)
				],
			})
		);
		return data;
	}

	/** 核销流水导出用全量 */
	async adminCheckinExportList(params = {}) {
		const where = {};
		if (params.rushId) where.RUSH_ID = params.rushId;
		if (util_isDefined(params.type)) where.CHECKIN_TYPE = Number(params.type);

		return await RushCheckinModel.getAllBig(
			where,
			'RUSH_ID,CHECKIN_CODE,CHECKIN_NO,CHECKIN_NAME,CHECKIN_PHONE,CHECKIN_TYPE,CHECKIN_ADMIN_NAME,CHECKIN_DEVICE,CHECKIN_TIME',
			{ CHECKIN_TIME: 'desc' }
		);
	}

	/* ============================================================
	 * 七、风控：黑名单与节流
	 * ============================================================ */

	/** 黑名单拦截：命中直接拒绝抢号 */
	async assertNotBlack(openid, phone) {
		if (openid) {
			const hit = await RushBlackModel.getOne(
				{ BLACK_TYPE: RushBlackModel.TYPE.OPENID, BLACK_VALUE: openid, BLACK_STATUS: 1 },
				'BLACK_ID,BLACK_REASON'
			);
			if (hit) this.AppError('账号已被限制参与活动' + (hit.BLACK_REASON ? '（' + hit.BLACK_REASON + '）' : ''));
		}
		if (phone) {
			const hit = await RushBlackModel.getOne(
				{ BLACK_TYPE: RushBlackModel.TYPE.PHONE, BLACK_VALUE: String(phone), BLACK_STATUS: 1 },
				'BLACK_ID,BLACK_REASON'
			);
			if (hit) this.AppError('该手机号已被限制参与活动' + (hit.BLACK_REASON ? '（' + hit.BLACK_REASON + '）' : ''));
		}
	}

	/** 抢号节流：同一账号在冷却窗口内只放行一次请求 */
	async throttleGrab(openid) {
		// 阈值可在后台配置；配置为 0 表示关闭节流
		const cooldown = await readNumberSetup(SETUP_KEY_THROTTLE_MS, GRAB_COOLDOWN_MS);
		if (!(cooldown > 0)) return;

		const now = Date.now();
		const last = grabThrottle.get(openid) || 0;
		if (now - last < cooldown) {
			this.AppError('操作过于频繁，请稍后再试');
		}
		grabThrottle.set(openid, now);

		// 顺手清理，避免 Map 无限增长
		if (grabThrottle.size > 5000) {
			const cutoff = now - cooldown * 10;
			for (const pair of grabThrottle) {
				if (pair[1] < cutoff) grabThrottle.delete(pair[0]);
			}
		}
	}

	/** 读取风控配置 */
	async adminRiskGet() {
		return {
			throttleMs: await readNumberSetup(SETUP_KEY_THROTTLE_MS, GRAB_COOLDOWN_MS),
			blackActive: await RushBlackModel.count({ BLACK_STATUS: 1 }),
			blackTotal: await RushBlackModel.count({}),
		};
	}

	/** 保存风控配置（限流阈值等） */
	async adminRiskSet(params, admin) {
		if (util_isDefined(params.throttleMs)) {
			const v = Math.floor(Number(params.throttleMs));
			if (isNaN(v) || v < 0 || v > 60000) this.AppError('节流间隔需在 0 ~ 60000 毫秒之间（0 表示关闭）');
			await setupUtil.set(SETUP_KEY_THROTTLE_MS, v);
		}
		return await this.adminRiskGet();
	}

	/** 黑名单列表 */
	async adminBlackList(params = {}) {
		const where = {};
		if (util_isDefined(params.type)) where.BLACK_TYPE = Number(params.type);
		if (util_isDefined(params.status)) where.BLACK_STATUS = Number(params.status);
		if (params.key) where.BLACK_VALUE = ['like', params.key];

		const data = await RushBlackModel.getList(
			where,
			'BLACK_ID,BLACK_TYPE,BLACK_VALUE,BLACK_REASON,BLACK_STATUS,BLACK_ADMIN_NAME,BLACK_TIME',
			{ BLACK_TIME: 'desc' },
			params.page || 1,
			params.size || 20
		);

		data.list = (data.list || []).map((o) =>
			Object.assign({}, o, {
				id: o._id,
				typeDesc: RushBlackModel.TYPE_DESC[
					Object.keys(RushBlackModel.TYPE).find((k) => RushBlackModel.TYPE[k] === o.BLACK_TYPE)
				],
			})
		);
		return data;
	}

	/** 加入黑名单 */
	async adminBlackInsert(params, admin) {
		const type = Number(params.type) || RushBlackModel.TYPE.OPENID;
		const value = String(params.value || '').trim();
		if (!value) this.AppError('请填写要拉黑的值');

		const exist = await RushBlackModel.getOne(
			{ BLACK_TYPE: type, BLACK_VALUE: value, BLACK_STATUS: 1 },
			'BLACK_ID'
		);
		if (exist) this.AppError('该记录已在黑名单中');

		const id = await RushBlackModel.insert({
			BLACK_TYPE: type,
			BLACK_VALUE: value,
			BLACK_REASON: params.reason || '',
			BLACK_ADMIN_ID: (admin && admin.ADMIN_ID) || '',
			BLACK_ADMIN_NAME: (admin && admin.ADMIN_NAME) || '',
			BLACK_STATUS: 1,
			BLACK_TIME: timeUtil.time(),
		});

		return { id };
	}

	/** 解除黑名单 */
	async adminBlackDelete(id, admin) {
		const updated = await RushBlackModel.edit({ _id: id }, { BLACK_STATUS: 0 });
		if (!updated) this.AppError('记录不存在');
		return { updated };
	}

	/* ============================================================
	 * 八、订阅消息
	 * ============================================================ */

	/** 读取模板配置 */
	async adminTmplGet() {
		return {
			start: (await setupUtil.get(RushSubscribeModel.SETUP_KEY.START)) || '',
			success: (await setupUtil.get(RushSubscribeModel.SETUP_KEY.SUCCESS)) || '',
			checkin: (await setupUtil.get(RushSubscribeModel.SETUP_KEY.CHECKIN)) || '',
		};
	}

	/** 保存模板配置 */
	async adminTmplSet(params, admin) {
		if (util_isDefined(params.start)) await setupUtil.set(RushSubscribeModel.SETUP_KEY.START, params.start || '');
		if (util_isDefined(params.success)) await setupUtil.set(RushSubscribeModel.SETUP_KEY.SUCCESS, params.success || '');
		if (util_isDefined(params.checkin)) await setupUtil.set(RushSubscribeModel.SETUP_KEY.CHECKIN, params.checkin || '');
		return await this.adminTmplGet();
	}

	/** 按类型取模板 ID */
	async _tmplIdOf(type) {
		const keyMap = {
			1: RushSubscribeModel.SETUP_KEY.START,
			2: RushSubscribeModel.SETUP_KEY.SUCCESS,
			3: RushSubscribeModel.SETUP_KEY.CHECKIN,
		};
		const key = keyMap[type] || RushSubscribeModel.SETUP_KEY.START;
		return (await setupUtil.get(key)) || '';
	}

	/**
	 * 用户授权订阅后落记录。
	 * 微信订阅消息是一次性授权，每次授权对应一条待发送记录。
	 */
	async addSubscribe(openid, params = {}) {
		if (!openid) this.AppError('请先登录');

		const type = Number(params.type) || RushSubscribeModel.TYPE.START;
		const tmplId = params.templateId || (await this._tmplIdOf(type));
		if (!tmplId) this.AppError('管理员尚未配置订阅消息模板');

		const rushId = params.rushId || '';

		// 同一活动同一类型的待发送订阅只保留一条，避免重复授权堆叠
		const exist = await RushSubscribeModel.getOne(
			{
				SUB_USER_ID: openid,
				SUB_RUSH_ID: rushId,
				SUB_TYPE: type,
				SUB_STATUS: RushSubscribeModel.STATUS.WAIT,
			},
			'SUB_ID'
		);
		if (exist) return { id: exist._id, duplicated: true };

		const id = await RushSubscribeModel.insert({
			SUB_USER_ID: openid,
			SUB_RUSH_ID: rushId,
			SUB_TEMPLATE_ID: tmplId,
			SUB_TYPE: type,
			SUB_PAGE: params.page || '',
			SUB_STATUS: RushSubscribeModel.STATUS.WAIT,
			SUB_TIMES: 1,
			SUB_SEND_TIME: 0,
			SUB_ERR: '',
		});

		return { id };
	}

	/** 发送一条订阅消息（发完即扣减次数） */
	async sendSubscribe(openid, type, rushId, data, page) {
		const rec = await RushSubscribeModel.getOne(
			{
				SUB_USER_ID: openid,
				SUB_RUSH_ID: rushId || '',
				SUB_TYPE: type,
				SUB_STATUS: RushSubscribeModel.STATUS.WAIT,
				SUB_TIMES: ['>', 0],
			},
			'SUB_ID,SUB_TEMPLATE_ID',
			{ SUB_ADD_TIME: 'desc' }
		);
		if (!rec) return { sent: false, reason: 'no_subscription' };

		try {
			const cloud = cloudBase.getCloud();
			await cloud.openapi.subscribeMessage.send({
				touser: openid,
				templateId: rec.SUB_TEMPLATE_ID,
				page: page || '',
				data: data || {},
			});

			await RushSubscribeModel.edit({ _id: rec._id }, {
				SUB_STATUS: RushSubscribeModel.STATUS.SENT,
				SUB_SEND_TIME: timeUtil.time(),
				SUB_TIMES: 0,
			});
			return { sent: true };
		} catch (err) {
			const msg = String((err && err.message) || err);
			await RushSubscribeModel.edit({ _id: rec._id }, {
				SUB_STATUS: RushSubscribeModel.STATUS.FAIL,
				SUB_ERR: msg.slice(0, 200),
			});
			return { sent: false, reason: msg };
		}
	}

	/** 放号前提醒：给该活动所有待发送订阅者群发 */
	async adminSendRemind(rushId, admin) {
		const rush = await RushModel.getOne(rushId, 'RUSH_ID,RUSH_TITLE,RUSH_START_TIME');
		if (!rush) this.AppError('活动不存在');

		const list = await RushSubscribeModel.getAll(
			{
				SUB_RUSH_ID: rushId,
				SUB_TYPE: RushSubscribeModel.TYPE.START,
				SUB_STATUS: RushSubscribeModel.STATUS.WAIT,
			},
			'SUB_USER_ID',
			{ SUB_ADD_TIME: 'asc' },
			1000
		);

		let sent = 0;
		let failed = 0;

		for (const one of list) {
			const r = await this.sendSubscribe(
				one.SUB_USER_ID,
				RushSubscribeModel.TYPE.START,
				rushId,
				{
					thing1: { value: String(rush.RUSH_TITLE).slice(0, 20) },
					time2: { value: timeUtil.timestamp2Time(rush.RUSH_START_TIME, 'Y-M-D h:m') },
				},
				'/projects/meetlib/pages/rush/detail/rush_detail?id=' + rushId
			);
			if (r.sent) sent++;
			else failed++;
		}

		return { total: list.length, sent, failed };
	}

	/** 订阅记录列表 */
	async adminSubList(params = {}) {
		const where = {};
		if (params.rushId) where.SUB_RUSH_ID = params.rushId;
		if (util_isDefined(params.type)) where.SUB_TYPE = Number(params.type);
		if (util_isDefined(params.status)) where.SUB_STATUS = Number(params.status);

		const data = await RushSubscribeModel.getList(
			where,
			'SUB_ID,SUB_USER_ID,SUB_RUSH_ID,SUB_TYPE,SUB_STATUS,SUB_TIMES,SUB_SEND_TIME,SUB_ERR,SUB_ADD_TIME',
			{ SUB_ADD_TIME: 'desc' },
			params.page || 1,
			params.size || 20
		);

		data.list = (data.list || []).map((o) =>
			Object.assign({}, o, {
				id: o._id,
				typeDesc: RushSubscribeModel.TYPE_DESC[
					Object.keys(RushSubscribeModel.TYPE).find((k) => RushSubscribeModel.TYPE[k] === o.SUB_TYPE)
				],
				statusDesc: RushSubscribeModel.STATUS_DESC[
					Object.keys(RushSubscribeModel.STATUS).find((k) => RushSubscribeModel.STATUS[k] === o.SUB_STATUS)
				],
			})
		);
		return data;
	}

	/* ============================================================
	 * 九、数据备份导出
	 * ============================================================ */

	/**
	 * 导出业务数据快照（JSON）
	 * 号码池只导出已占用的部分 —— 未占用号属于可再生成数据，导出无意义且体积大
	 */
	async adminBackup(params = {}) {
		const rushId = params.rushId || '';
		const where = rushId ? { RUSH_ID: rushId } : {};

		const rushList = await RushModel.getAllBig({}, '*', { RUSH_ADD_TIME: 'desc' }, 1000);
		const orderList = await RushOrderModel.getAllBig(where, '*', { RUSH_ORDER_NO: 'asc' }, 1000);
		const checkinList = await RushCheckinModel.getAllBig(where, '*', { CHECKIN_TIME: 'desc' }, 1000);
		const blackList = await RushBlackModel.getAllBig({}, '*', { BLACK_TIME: 'desc' }, 1000);
		const codeList = await RushCodeModel.getAllBig(
			rushId ? { RUSH_ID: rushId, CODE_TAKEN: 1 } : { CODE_TAKEN: 1 },
			'RUSH_ID,CODE_NO,CODE_VALUE,CODE_TAKEN,CODE_TAKEN_USER,CODE_TAKEN_TIME',
			{ CODE_NO: 'asc' },
			1000
		);

		const now = timeUtil.time();

		return {
			version: 1,
			exportTime: now,
			exportTimeStr: timeUtil.timestamp2Time(now),
			scope: rushId || 'ALL',
			counts: {
				rush: rushList.length,
				order: orderList.length,
				checkin: checkinList.length,
				black: blackList.length,
				code: codeList.length,
			},
			data: {
				rush: rushList,
				order: orderList,
				checkin: checkinList,
				black: blackList,
				code: codeList,
			},
		};
	}

	/* ============================================================
	 * 十一、数据一致性自检与修复
	 * ============================================================ */

	/** 按号码池与订单重新聚合出每个活动的正确计数 */
	async _recountAll() {
		const codes = await RushCodeModel.getAllBig({}, 'RUSH_ID,CODE_TAKEN,CODE_TAKEN_USER', {}, 1000);
		const orders = await RushOrderModel.getAllBig({}, 'RUSH_ID,RUSH_ORDER_STATUS', {}, 1000);

		const poolTotal = {};   // 号码池总数 = 放号总量
		const poolTaken = {};   // 全部占用（含预留）
		const orderTaken = {};  // 仅因订单而占用
		const orderCnt = {};    // 有效订单数

		for (const c of codes) {
			poolTotal[c.RUSH_ID] = (poolTotal[c.RUSH_ID] || 0) + 1;
			if (Number(c.CODE_TAKEN) === 1) {
				poolTaken[c.RUSH_ID] = (poolTaken[c.RUSH_ID] || 0) + 1;

				// 预留占用不产生订单，单独剔除
				if (c.CODE_TAKEN_USER !== RESERVE_USER) {
					orderTaken[c.RUSH_ID] = (orderTaken[c.RUSH_ID] || 0) + 1;
				}
			}
		}

		for (const o of orders) {
			// 只有未取消的订单才算有效占用
			if (Number(o.RUSH_ORDER_STATUS) !== RushOrderModel.STATUS.CANCEL) {
				orderCnt[o.RUSH_ID] = (orderCnt[o.RUSH_ID] || 0) + 1;
			}
		}

		return {
			poolTotal,
			poolTaken,
			orderTaken,
			orderCnt,
			codeCount: codes.length,
			orderCount: orders.length,
		};
	}

	/**
	 * 一致性自检
	 *
	 * 三个口径必须自洽：
	 *   RUSH_TOTAL = 号码池文档数
	 *   RUSH_TAKEN = CODE_TAKEN=1 的号码数
	 *   且 RUSH_TAKEN 应等于该活动的有效订单数
	 */
	async adminCheckConsistency() {
		const rushes = await RushModel.getAllBig(
			{},
			'RUSH_ID,RUSH_TITLE,RUSH_TOTAL,RUSH_TAKEN,RUSH_LOCK_STOCK,RUSH_STATUS',
			{},
			1000
		);

		const { poolTotal, poolTaken, orderTaken, orderCnt, codeCount, orderCount } = await this._recountAll();

		const issues = [];

		for (const r of rushes) {
			const t = poolTotal[r._id] || 0;
			const k = poolTaken[r._id] || 0;
			const ot = orderTaken[r._id] || 0;
			const o = orderCnt[r._id] || 0;

			const problems = [];
			if (Number(r.RUSH_TOTAL) !== t) problems.push('放号总量应为 ' + t + '，当前 ' + r.RUSH_TOTAL);
			if (Number(r.RUSH_TAKEN) !== k) problems.push('已发放应为 ' + k + '，当前 ' + r.RUSH_TAKEN);
			// 只比对「因订单产生的占用」，预留占用本就不产生订单
			if (ot !== o) problems.push('订单占用号码 ' + ot + ' 与有效订单数 ' + o + ' 不符');

			if (problems.length) {
				issues.push({
					id: r._id,
					title: r.RUSH_TITLE,
					problems,
					shouldTotal: t,
					shouldTaken: k,
					currentTotal: r.RUSH_TOTAL,
					currentTaken: r.RUSH_TAKEN,
				});
			}
		}

		return {
			checked: {
				rush: rushes.length,
				code: codeCount,
				order: orderCount,
			},
			issueCount: issues.length,
			issues: issues.slice(0, 50),
		};
	}

	/** 一键修复：按号码池重新校准计数 */
	async adminFixConsistency(admin) {
		const rushes = await RushModel.getAllBig({}, 'RUSH_ID,RUSH_TITLE,RUSH_TOTAL,RUSH_TAKEN', {}, 1000);
		const { poolTotal, poolTaken } = await this._recountAll();

		const fixed = [];

		for (const r of rushes) {
			const t = poolTotal[r._id] || 0;
			const k = poolTaken[r._id] || 0;

			if (Number(r.RUSH_TOTAL) !== t || Number(r.RUSH_TAKEN) !== k) {
				await RushModel.edit({ _id: r._id }, { RUSH_TOTAL: t, RUSH_TAKEN: k });
				fixed.push({
					id: r._id,
					title: r.RUSH_TITLE,
					from: { total: r.RUSH_TOTAL, taken: r.RUSH_TAKEN },
					to: { total: t, taken: k },
				});
			}
		}

		return { fixedCount: fixed.length, fixed: fixed.slice(0, 50) };
	}

	/**
	 * 运营看板
	 * 汇总今日预约、核销率、活动状态分布与库存水位
	 */
	async adminDashboard() {
		const now = timeUtil.time();

		const d = new Date();
		d.setHours(0, 0, 0, 0);
		const todayTs = d.getTime();

		// 今日维度
		const todayOrders = await RushOrderModel.count({ RUSH_ORDER_ADD_TIME: ['>=', todayTs] });
		const todayCheckin = await RushCheckinModel.count({
			CHECKIN_TIME: ['>=', todayTs],
			CHECKIN_TYPE: RushCheckinModel.TYPE.CHECKIN,
		});

		// 订单维度
		const totalOrders = await RushOrderModel.count({});
		const booked = await RushOrderModel.count({ RUSH_ORDER_STATUS: RushOrderModel.STATUS.BOOKED });
		const checked = await RushOrderModel.count({ RUSH_ORDER_STATUS: RushOrderModel.STATUS.CHECKIN });
		const canceled = await RushOrderModel.count({ RUSH_ORDER_STATUS: RushOrderModel.STATUS.CANCEL });

		// 活动维度
		const rushes = await RushModel.getAllBig(
			{},
			'RUSH_TITLE,RUSH_START_TIME,RUSH_END_TIME,RUSH_TOTAL,RUSH_TAKEN,RUSH_LOCK_STOCK,RUSH_STATUS,RUSH_PAUSE',
			{},
			1000
		);

		let running = 0;
		let waiting = 0;
		let over = 0;
		let draft = 0;
		let totalStock = 0;
		let totalTaken = 0;
		const active = [];

		for (const r of rushes) {
			const st = this._calcStatus(r, now);

			if (st === RushModel.STATUS.DRAFT) draft++;
			else if (st === RushModel.STATUS.WAIT) waiting++;
			else if (st === RushModel.STATUS.RUNNING) running++;
			else over++;

			if (st !== RushModel.STATUS.DRAFT) {
				totalStock += Number(r.RUSH_TOTAL || 0);
				totalTaken += Number(r.RUSH_TAKEN || 0);
			}

			// 收集进行中/待开抢的活动摘要，供看板直接展示
			if (st === RushModel.STATUS.RUNNING || st === RushModel.STATUS.WAIT) {
				active.push({
					id: r._id,
					title: r.RUSH_TITLE,
					status: st,
					paused: r.RUSH_PAUSE === 1,
					left: this._calcLeft(r),
					total: r.RUSH_TOTAL,
					taken: r.RUSH_TAKEN,
					startTime: r.RUSH_START_TIME,
				});
			}
		}

		// 核销率：已核销 / 已发放
		const checkinRate = totalTaken > 0 ? Math.round((checked / totalTaken) * 1000) / 10 : 0;

		return {
			now,
			today: { orders: todayOrders, checkin: todayCheckin },
			order: { total: totalOrders, booked, checked, canceled },
			rush: { total: rushes.length, draft, waiting, running, over },
			stock: { total: totalStock, taken: totalTaken, left: totalStock - totalTaken },
			checkinRate,
			active: active.slice(0, 10),
		};
	}

	/** 数据量概览 */
	async adminDataStats() {		const rush = await RushModel.count({});
		const order = await RushOrderModel.count({});
		const checkin = await RushCheckinModel.count({});
		const black = await RushBlackModel.count({});
		const codeTaken = await RushCodeModel.count({ CODE_TAKEN: 1 });

		return { rush, order, checkin, black, codeTaken };
	}

	/* ============================================================
	 * 十、Excel 导出
	 * ============================================================ */

	/** 订单状态文案 */
	_orderStatusDesc(status) {
		const key = Object.keys(RushOrderModel.STATUS).find((k) => RushOrderModel.STATUS[k] === status);
		return RushOrderModel.STATUS_DESC[key] || '';
	}

	/**
	 * 导出预约名单为 Excel
	 * 用框架的 exportDataExcel：node-xlsx 生成 xlsx → 传云存储 → 记录下载链接
	 */
	async adminOrderExportExcel(params = {}) {
		const list = await this.adminOrderExportList(params);

		const rows = [[
			'号码', '购买码', '姓名', '昵称', '手机号', 'openid',
			'所选时段', '状态', '预约时间', '核销时间', '核销员',
		]];

		for (const o of list) {
			rows.push([
				o.RUSH_ORDER_NO || 0,
				o.RUSH_ORDER_CODE || '',
				o.RUSH_ORDER_NAME || '',
				o.RUSH_ORDER_NICK || '',
				o.RUSH_ORDER_PHONE || '',
				o.RUSH_ORDER_USER_ID || '',
				o.RUSH_ORDER_SESSION || '',
				this._orderStatusDesc(o.RUSH_ORDER_STATUS),
				o.RUSH_ORDER_TIME ? timeUtil.timestamp2Time(o.RUSH_ORDER_TIME) : '',
				o.RUSH_ORDER_CHECKIN_TIME ? timeUtil.timestamp2Time(o.RUSH_ORDER_CHECKIN_TIME) : '',
				o.RUSH_ORDER_CHECKIN_ADMIN || '',
			]);
		}

		return await exportUtil.exportDataExcel(
			EXPORT_KEY_ORDER,
			'闪抢预约名单',
			rows.length - 1,
			rows
		);
	}

	/** 导出核销流水为 Excel */
	async adminCheckinExportExcel(params = {}) {
		const list = await this.adminCheckinExportList(params);

		const rows = [[
			'操作时间', '类型', '号码', '购买码', '姓名', '手机号', '核销员', '设备',
		]];

		for (const o of list) {
			const typeKey = Object.keys(RushCheckinModel.TYPE).find((k) => RushCheckinModel.TYPE[k] === o.CHECKIN_TYPE);
			rows.push([
				o.CHECKIN_TIME ? timeUtil.timestamp2Time(o.CHECKIN_TIME) : '',
				RushCheckinModel.TYPE_DESC[typeKey] || '',
				o.CHECKIN_NO || 0,
				o.CHECKIN_CODE || '',
				o.CHECKIN_NAME || '',
				o.CHECKIN_PHONE || '',
				o.CHECKIN_ADMIN_NAME || '',
				o.CHECKIN_DEVICE || '',
			]);
		}

		return await exportUtil.exportDataExcel(
			EXPORT_KEY_CHECKIN,
			'核销流水',
			rows.length - 1,
			rows
		);
	}

	/** 取最近一次导出的下载链接 */
	async adminExportUrl(type) {
		const key = type === 'checkin' ? EXPORT_KEY_CHECKIN : EXPORT_KEY_ORDER;
		return await exportUtil.getExportDataURL(key);
	}

	/** 删除导出文件 */
	async adminExportDel(type) {
		const key = type === 'checkin' ? EXPORT_KEY_CHECKIN : EXPORT_KEY_ORDER;
		await exportUtil.deleteDataExcel(key);
		return { ok: true };
	}
}

// 局部小工具，避免与框架 util 命名冲突
function util_isDefined(v) {
	return v !== undefined && v !== null;
}

module.exports = RushService;
