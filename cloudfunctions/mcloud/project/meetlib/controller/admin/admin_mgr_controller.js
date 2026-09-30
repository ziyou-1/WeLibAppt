/**
 * Notes: 管理员控制模块（含角色分级）
 * Ver : CCMiniCloud Framework 2.0.1 ALL RIGHTS RESERVED BY cclinux0730 (wechat)
 * Date: 2021-07-11 10:20:00 
 */

const BaseProjectAdminController = require('./base_project_admin_controller.js');
const LogModel = require('../../../../framework/platform/model/log_model.js');
const AdminModel = require('../../../../framework/platform/model/admin_model.js');

const AdminMgrService = require('../../service/admin/admin_mgr_service.js');
const timeUtil = require('../../../../framework/utils/time_util.js');
const contentCheck = require('../../../../framework/validate/content_check.js');

class AdminMgrController extends BaseProjectAdminController {

	// 管理员登录  
	async adminLogin() {

		// 数据校验
		let rules = {
			name: 'must|string|min:2|max:30|name=管理员名',
			pwd: 'must|string|min:5|max:30|name=密码',
		};

		// 取得数据
		let input = this.validateData(rules);

		let service = new AdminMgrService();
		return await service.adminLogin(input.name, input.pwd);
	}

	/** 当前登录管理员的角色与权限（前端按角色渲染按钮） */
	async getMyPerms() {
		return await this.currentPerms();
	}

	/** 管理员列表 */
	async getMgrList() {
		await this.checkPerm('MGR_MANAGE');

		// 数据校验
		let rules = {
			search: 'string|min:1|max:30|name=搜索条件',
			sortType: 'string|name=搜索类型',
			sortVal: 'name=搜索类型值',
			orderBy: 'object|name=排序',
			whereEx: 'object|name=附加查询条件',
			page: 'must|int|default=1',
			size: 'int|default=10',
			isTotal: 'bool',
			oldTotal: 'int',
		};

		// 取得数据
		let input = this.validateData(rules);

		let service = new AdminMgrService();
		let result = await service.getMgrList(input);

		// 数据格式化
		let list = result.list;
		for (let k = 0; k < list.length; k++) {
			list[k].ADMIN_EDIT_TIME = timeUtil.timestamp2Time(list[k].ADMIN_EDIT_TIME);
			list[k].ADMIN_LOGIN_TIME = (list[k].ADMIN_LOGIN_TIME == 0) ? '未登录' : timeUtil.timestamp2Time(list[k].ADMIN_LOGIN_TIME);

			// 兼容还没有 ADMIN_ROLE 字段的老数据
			let role = AdminModel.resolveRole(list[k]);
			list[k].ADMIN_ROLE = role;
			list[k].ADMIN_ROLE_DESC = AdminModel.getDesc('ROLE', role);
		}
		result.list = list;
		return result;
	}

	/** 添加管理员 */
	async insertMgr() {
		await this.checkSuper();

		// 数据校验
		let rules = {
			name: 'must|string|min:2|max:30|name=账号',
			desc: 'must|string|max:30|name=姓名',
			phone: 'string|len:11|name=手机',
			password: 'must|string|min:6|max:30|name=密码',
			role: 'must|int|in:1,2,3,4|name=角色',
		};

		// 取得数据
		let input = this.validateData(rules);

		// 内容审核（只审文本字段）
		await contentCheck.checkTextMultiAdmin({ name: input.name, desc: input.desc });

		let service = new AdminMgrService();
		return await service.insertMgr(input, this._admin);
	}

	/** 修改管理员 */
	async editMgr() {
		await this.checkSuper();

		// 数据校验
		let rules = {
			id: 'must|id|name=id',
			name: 'string|min:2|max:30|name=账号',
			desc: 'string|max:30|name=姓名',
			phone: 'string|len:11|name=手机',
			role: 'int|in:1,2,3,4|name=角色',
		};

		// 取得数据
		let input = this.validateData(rules);

		// 内容审核（只审文本字段）
		await contentCheck.checkTextMultiAdmin({
			name: input.name || '',
			desc: input.desc || '',
		});

		let service = new AdminMgrService();
		return await service.editMgr(input.id, input, this._admin);
	}

	/** 管理员状态修改（启用/停用） */
	async statusMgr() {
		await this.checkSuper();

		// 数据校验
		let rules = {
			id: 'must|id',
			status: 'must|int|in:0,1',
		};

		// 取得数据
		let input = this.validateData(rules);

		let service = new AdminMgrService();
		return await service.statusMgr(input.id, input.status, this._admin);
	}

	/** 删除管理员 */
	async delMgr() {
		await this.checkSuper();

		// 数据校验
		let rules = {
			id: 'must|id',
		};

		// 取得数据
		let input = this.validateData(rules);

		let service = new AdminMgrService();
		return await service.delMgr(input.id, this._admin);
	}

	/** 重置他人密码（超管） */
	async resetMgrPwd() {
		await this.checkSuper();

		let rules = {
			id: 'must|id',
			password: 'must|string|min:6|max:30|name=新密码',
		};

		let input = this.validateData(rules);

		let service = new AdminMgrService();
		return await service.resetMgrPwd(input.id, input.password, this._admin);
	}

	/** 修改自己的密码 */
	async pwdMgr() {
		await this.isAdmin();

		// 数据校验
		let rules = {
			oldPassword: 'must|string|min:6|max:30|name=旧密码',
			password: 'must|string|min:6|max:30|name=新密码',
			password2: 'must|string|min:6|max:30|name=新密码再次填写',

		};

		// 取得数据
		let input = this.validateData(rules);

		if (input.password !== input.password2)
			this.AppError('两次输入的新密码不一致');

		// 内容审核
		await contentCheck.checkTextMultiAdmin(input);

		let service = new AdminMgrService();
		return await service.pwdtMgr(this._adminId, input.oldPassword, input.password);
	}

	/** 获取管理员信息用于编辑修改 */
	async getMgrDetail() {
		await this.checkPerm('MGR_MANAGE');

		// 数据校验
		let rules = {
			id: 'must|id',
		};

		// 取得数据
		let input = this.validateData(rules);

		let service = new AdminMgrService();
		return await service.getMgrDetail(input.id);

	}

	/** 清空操作日志 */
	async clearLog() {
		await this.checkSuper();

		let service = new AdminMgrService();
		return await service.clearLog(this._admin);

	}

	/** 操作日志列表 */
	async getLogList() {
		await this.checkPerm('LOG_VIEW');

		// 数据校验
		let rules = {
			search: 'string|min:1|max:30|name=搜索条件',
			sortType: 'string|name=搜索类型',
			sortVal: 'name=搜索类型值',
			orderBy: 'object|name=排序',
			whereEx: 'object|name=附加查询条件',
			page: 'must|int|default=1',
			size: 'int',
			isTotal: 'bool',
			oldTotal: 'int',
		};

		// 取得数据
		let input = this.validateData(rules);

		let service = new AdminMgrService();
		let result = await service.getLogList(input);

		// 数据格式化
		let list = result.list;
		for (let k = 0; k < list.length; k++) {
			list[k].LOG_TYPE_DESC = LogModel.getDesc('TYPE', list[k].LOG_TYPE);
			list[k].LOG_ADD_TIME = timeUtil.timestamp2Time(list[k].LOG_ADD_TIME);
		}
		result.list = list;

		return result;

	}
}

module.exports = AdminMgrController;
