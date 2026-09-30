/**
 * Notes: 闪抢模块控制器（前台）
 */

const BaseProjectController = require('./base_project_controller.js');
const RushService = require('../service/rush_service.js');

class RushController extends BaseProjectController {

	/**
	 * 服务端时间 —— 前端用它做校时
	 * 页面加载时调一次，算出本地与服务端的时间偏移，本地倒计时才准
	 */
	async getServerTime() {
		let service = new RushService();
		return await service.getServerTime();
	}

	/**
	 * 轻量状态接口 —— 倒计时归零后的高频轮询专用
	 * 只读一个文档，不做任何聚合，保证高并发下的吞吐
	 */
	async getRushStatus() {
		let rules = {
			rushId: 'must|string|min:1|name=活动ID',
		};
		let input = this.validateData(rules);

		let service = new RushService();
		return await service.getRushStatus(input.rushId);
	}

	/** 活动列表（前台） */
	async getRushList() {
		let rules = {
			page: 'must|int|default=1',
			size: 'int|default=20',
		};
		let input = this.validateData(rules);

		let service = new RushService();
		return await service.getRushList(input);
	}

	/** 活动详情（含我的预约状态） */
	async getRushDetail() {		let rules = {
			rushId: 'must|string|min:1|name=活动ID',
		};
		let input = this.validateData(rules);

		let service = new RushService();
		return await service.getRushDetail(input.rushId, this._userId);
	}

	/** 抢号 */
	async grab() {
		let rules = {
			rushId: 'must|string|min:1|name=活动ID',
			name: 'string|max:30',
			phone: 'string|max:20',
			nick: 'string|max:30',
			session: 'string|max:30',
			forms: 'array',
			obj: 'object',
		};
		let input = this.validateData(rules);

		let service = new RushService();
		return await service.grab(input.rushId, this._userId, input);
	}

	/** 我的预约 */
	async getMyOrder() {
		let rules = {
			rushId: 'must|string|min:1|name=活动ID',
		};
		let input = this.validateData(rules);

		let service = new RushService();
		return await service.getMyOrder(input.rushId, this._userId);
	}

	/** 用户取消自己的预约 */
	async cancelMyOrder() {
		let rules = {
			orderId: 'must|string|min:1|name=预约ID',
		};
		let input = this.validateData(rules);

		let service = new RushService();
		return await service.cancelMyOrder(input.orderId, this._userId);
	}

	/** 我的闪抢预约列表 */
	async getMyOrderList() {
		let rules = {
			page: 'must|int|default=1',
			size: 'int|default=20',
		};
		let input = this.validateData(rules);

		let service = new RushService();
		return await service.getMyOrderList(this._userId, input);
	}

	/**
	 * 订阅开抢提醒
	 * 前端在 wx.requestSubscribeMessage 授权成功后调用，落一条待发送记录
	 */
	async subscribe() {
		let rules = {
			rushId: 'string|max:60',
			type: 'int|default=1',
			templateId: 'string|max:100',
			page: 'string|max:200',
		};
		let input = this.validateData(rules);

		let service = new RushService();
		return await service.addSubscribe(this._userId, input);
	}

}

module.exports = RushController;
