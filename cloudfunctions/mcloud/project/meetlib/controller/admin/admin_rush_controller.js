/**
 * Notes: 闪抢模块后台管理-控制器（带角色权限校验）
 */

const BaseProjectAdminController = require('./base_project_admin_controller.js');
const RushService = require('../../service/rush_service.js');

class AdminRushController extends BaseProjectAdminController {

	/* ---------------- 活动管理 ---------------- */

	/** 活动列表（只读及以上） */
	async getRushList() {
		await this.checkPerm('ORDER_VIEW');

		let rules = {
			title: 'string|max:30',
			status: 'int',
			page: 'must|int|default=1',
			size: 'int|default=20',
		};
		let input = this.validateData(rules);

		let service = new RushService();
		return await service.adminList(input);
	}

	/** 活动详情（只读及以上） */
	async getRushDetail() {
		await this.checkPerm('ORDER_VIEW');

		let input = this.validateData({ id: 'must|string|min:1' });

		let service = new RushService();
		return await service.adminDetail(input.id);
	}

	/** 新建活动（超管 / 运营） */
	async insertRush() {
		await this.checkPerm('RUSH_MANAGE');

		let rules = {
			title: 'must|string|min:1|max:50|name=活动名称',
			desc: 'string|max:200',
			pic: 'string|max:300',
			notice: 'string|max:2000',
			place: 'string|max:100',
			startTime: 'must|int|name=开抢时间',
			endTime: 'must|int|name=结束时间',
			limit: 'int|default=1',
			order: 'int',
			status: 'int',
			forms: 'array',
			sessions: 'array',
		};
		let input = this.validateData(rules);

		let service = new RushService();
		let ret = await service.adminInsert(input, this._admin);
		await this.log('新增闪抢活动：' + input.title);
		return ret;
	}

	/** 编辑活动（超管 / 运营） */
	async editRush() {
		await this.checkPerm('RUSH_MANAGE');

		let rules = {
			id: 'must|string|min:1',
			title: 'string|max:50',
			desc: 'string|max:200',
			pic: 'string|max:300',
			notice: 'string|max:2000',
			place: 'string|max:100',
			startTime: 'int',
			endTime: 'int',
			limit: 'int',
			order: 'int',
			status: 'int',
			forms: 'array',
			sessions: 'array',
		};
		let input = this.validateData(rules);

		let service = new RushService();
		let ret = await service.adminEdit(input.id, input);
		await this.log('修改闪抢活动：' + (input.title || input.id));
		return ret;
	}

	/** 关闭活动（超管 / 运营） */
	async delRush() {
		await this.checkPerm('RUSH_MANAGE');

		let input = this.validateData({ id: 'must|string|min:1' });

		let service = new RushService();
		let ret = await service.adminDel(input.id);
		await this.log('关闭闪抢活动：' + input.id);
		return ret;
	}

	/* ---------------- 库存 ---------------- */

	/** 放号：预生成号码池（超管 / 运营） */
	async publishRush() {
		await this.checkPerm('RUSH_STOCK');

		let rules = {
			id: 'must|string|min:1',
			count: 'must|int|min:1|max:2000|name=放号数量',
		};
		let input = this.validateData(rules);

		let service = new RushService();
		let ret = await service.adminPublish(input.id, input.count);
		await this.log('放号 ' + input.count + ' 个，活动：' + input.id);
		return ret;
	}

	/** 一键暂停 / 恢复放号（超管 / 运营） */
	async pauseRush() {
		await this.checkPerm('RUSH_STOCK');

		let rules = {
			id: 'must|string|min:1',
			pause: 'must|int|in:0,1',
		};
		let input = this.validateData(rules);

		let service = new RushService();
		let ret = await service.adminTogglePause(input.id, input.pause);
		await this.log(ret.desc + '，活动：' + input.id);
		return ret;
	}

	/** 锁定库存（超管 / 运营） */
	async lockRush() {
		await this.checkPerm('RUSH_STOCK');

		let rules = {
			id: 'must|string|min:1',
			lock: 'must|int|min:0',
		};
		let input = this.validateData(rules);

		let service = new RushService();
		return await service.adminSetLock(input.id, input.lock);
	}

	/** 手动扣减库存（超管 / 运营） */
	async reduceRush() {
		await this.checkPerm('RUSH_STOCK');

		let rules = {
			id: 'must|string|min:1',
			count: 'must|int|min:1',
		};
		let input = this.validateData(rules);

		let service = new RushService();
		let ret = await service.adminReduceStock(input.id, input.count);
		await this.log('手动扣减库存 ' + ret.reduced + ' 个，活动：' + input.id);
		return ret;
	}

	/* ---------------- 名单 / 核销 ---------------- */

	/** 预约名单（只读及以上） */
	async getRushOrderList() {
		await this.checkPerm('ORDER_VIEW');

		let rules = {
			rushId: 'string',
			status: 'int',
			key: 'string|max:30',
			page: 'must|int|default=1',
			size: 'int|default=20',
		};
		let input = this.validateData(rules);

		let service = new RushService();
		return await service.adminOrderList(input);
	}

	/** 核销（超管 / 运营 / 核销员） */
	async checkinRush() {
		await this.checkPerm('CHECKIN');

		let rules = {
			code: 'must|string|min:1|max:40|name=购买码',
			device: 'string|max:60',
		};
		let input = this.validateData(rules);

		let service = new RushService();
		let ret = await service.adminCheckin(input.code, this._admin, input.device);
		await this.log('核销购买码 ' + input.code);
		return ret;
	}

	/** 撤销核销（超管 / 运营） */
	async cancelCheckinRush() {
		await this.checkPerm('CHECKIN_CANCEL');

		let input = this.validateData({ orderId: 'must|string|min:1' });

		let service = new RushService();
		let ret = await service.adminCancelCheckin(input.orderId, this._admin);
		await this.log('撤销核销，订单：' + input.orderId);
		return ret;
	}

	/** 取消预约并回收号码（超管 / 运营） */
	async cancelRushOrder() {
		await this.checkPerm('CHECKIN_CANCEL');

		let input = this.validateData({ orderId: 'must|string|min:1' });

		let service = new RushService();
		let ret = await service.adminCancelOrder(input.orderId);
		await this.log('取消预约，订单：' + input.orderId);
		return ret;
	}

	/** 导出名单为 Excel（超管 / 运营 / 只读） */
	async exportRushOrder() {
		await this.checkPerm('EXPORT');

		let rules = {
			rushId: 'string',
			status: 'int',
		};
		let input = this.validateData(rules);

		let service = new RushService();
		let ret = await service.adminOrderExportExcel(input);
		await this.log('导出预约名单 Excel，共 ' + ret.total + ' 条');
		return ret;
	}

	/* ---------------- 核销流水 ---------------- */

	/** 核销流水列表（只读及以上） */
	async getCheckinList() {
		await this.checkPerm('ORDER_VIEW');

		let rules = {
			rushId: 'string',
			type: 'int',
			adminId: 'string',
			key: 'string|max:30',
			page: 'must|int|default=1',
			size: 'int|default=20',
		};
		let input = this.validateData(rules);

		let service = new RushService();
		return await service.adminCheckinList(input);
	}

	/** 核销流水导出为 Excel（超管 / 运营 / 只读） */
	async exportCheckin() {
		await this.checkPerm('EXPORT');

		let rules = {
			rushId: 'string',
			type: 'int',
		};
		let input = this.validateData(rules);

		let service = new RushService();
		let ret = await service.adminCheckinExportExcel(input);
		await this.log('导出核销流水 Excel，共 ' + ret.total + ' 条');
		return ret;
	}

	/** 取最近一次导出文件的下载链接 */
	async getExportUrl() {
		await this.checkPerm('EXPORT');

		let input = this.validateData({ type: 'string|max:20' });

		let service = new RushService();
		return await service.adminExportUrl(input.type);
	}

	/** 删除导出文件 */
	async delExport() {
		await this.checkPerm('SYS_MANAGE');

		let input = this.validateData({ type: 'string|max:20' });

		let service = new RushService();
		return await service.adminExportDel(input.type);
	}

	/* ---------------- 风控 ---------------- */

	/** 黑名单列表（超管 / 运营） */
	async getBlackList() {
		await this.checkPerm('RUSH_STOCK');

		let rules = {
			type: 'int',
			status: 'int',
			key: 'string|max:50',
			page: 'must|int|default=1',
			size: 'int|default=20',
		};
		let input = this.validateData(rules);

		let service = new RushService();
		return await service.adminBlackList(input);
	}

	/** 加入黑名单（超管 / 运营） */
	async insertBlack() {
		await this.checkPerm('RUSH_STOCK');

		let rules = {
			type: 'must|int|in:1,2|name=类型',
			value: 'must|string|min:1|max:60|name=拉黑值',
			reason: 'string|max:100',
		};
		let input = this.validateData(rules);

		let service = new RushService();
		let ret = await service.adminBlackInsert(input, this._admin);
		await this.log('新增黑名单：' + input.value);
		return ret;
	}

	/** 解除黑名单（超管 / 运营） */
	async delBlack() {
		await this.checkPerm('RUSH_STOCK');

		let input = this.validateData({ id: 'must|string|min:1' });

		let service = new RushService();
		let ret = await service.adminBlackDelete(input.id, this._admin);
		await this.log('解除黑名单：' + input.id);
		return ret;
	}

	/* ---------------- 订阅消息 ---------------- */

	/** 读取订阅模板配置（超管 / 运营） */
	async getTmpl() {
		await this.checkPerm('RUSH_MANAGE');

		let service = new RushService();
		return await service.adminTmplGet();
	}

	/** 保存订阅模板配置（超管 / 运营） */
	async setTmpl() {
		await this.checkPerm('RUSH_MANAGE');

		let rules = {
			start: 'string|max:100',
			success: 'string|max:100',
			checkin: 'string|max:100',
		};
		let input = this.validateData(rules);

		let service = new RushService();
		let ret = await service.adminTmplSet(input, this._admin);
		await this.log('修改订阅消息模板配置');
		return ret;
	}

	/** 放号前提醒群发（超管 / 运营） */
	async sendRemind() {
		await this.checkPerm('RUSH_STOCK');

		let input = this.validateData({ rushId: 'must|string|min:1' });

		let service = new RushService();
		let ret = await service.adminSendRemind(input.rushId, this._admin);
		await this.log('发送放号提醒 ' + ret.sent + '/' + ret.total);
		return ret;
	}

	/** 订阅记录（只读及以上） */
	async getSubList() {
		await this.checkPerm('ORDER_VIEW');

		let rules = {
			rushId: 'string',
			type: 'int',
			status: 'int',
			page: 'must|int|default=1',
			size: 'int|default=20',
		};
		let input = this.validateData(rules);

		let service = new RushService();
		return await service.adminSubList(input);
	}

	/* ---------------- 数据备份 ---------------- */

	/** 数据量概览（超管） */
	async dataStats() {
		await this.checkPerm('SYS_MANAGE');

		let service = new RushService();
		return await service.adminDataStats();
	}

	/* ---------------- 风控配置 ---------------- */

	/** 读取风控配置（超管 / 运营） */
	async getRisk() {
		await this.checkPerm('RUSH_STOCK');

		let service = new RushService();
		return await service.adminRiskGet();
	}

	/** 保存风控配置：限流阈值等（超管 / 运营） */
	async setRisk() {
		await this.checkPerm('RUSH_STOCK');

		let input = this.validateData({ throttleMs: 'int|min:0|max:60000' });

		let service = new RushService();
		let ret = await service.adminRiskSet(input, this._admin);
		await this.log('修改风控节流阈值为 ' + ret.throttleMs + 'ms');
		return ret;
	}

	/** 运营看板（超管 / 运营） */
	async dashboard() {
		await this.checkPerm('RUSH_STOCK');

		let service = new RushService();
		return await service.adminDashboard();
	}

	/** 数据一致性自检（超管） */
	async checkConsistency() {
		await this.checkPerm('SYS_MANAGE');

		let service = new RushService();
		return await service.adminCheckConsistency();
	}

	/** 一键修复计数（超管） */
	async fixConsistency() {
		await this.checkPerm('SYS_MANAGE');

		let service = new RushService();
		let ret = await service.adminFixConsistency(this._admin);
		await this.log('修复数据一致性，涉及 ' + ret.fixedCount + ' 个活动');
		return ret;
	}

	/** 导出数据快照（超管） */
	async backup() {		await this.checkPerm('SYS_MANAGE');

		let input = this.validateData({ rushId: 'string' });

		let service = new RushService();
		let ret = await service.adminBackup(input);
		await this.log('导出数据备份，范围：' + ret.scope);
		return ret;
	}

}

module.exports = AdminRushController;
