/**
 * Notes: 后台管理控制模块（项目级基类）
 * Ver : CCMiniCloud Framework 2.0.1 ALL RIGHTS RESERVED BY cclinux0730 (wechat)
 * Date: 2021-03-15 19:20:00 
 */

const BaseAdminController = require('../../../../framework/platform/controller/base_admin_controller.js');
const BaseProjectService = require('../../service/base_project_service.js');

const AdminModel = require('../../../../framework/platform/model/admin_model.js');
const AppError = require('../../../../framework/core/app_error.js');
const appCode = require('../../../../framework/core/app_code.js');

class BaseProjectAdminController extends BaseAdminController {

	async initSetup() {
		let service = new BaseProjectService();
		await service.initSetup();
	}

	/**
	 * 登录 + 权限校验
	 *
	 * 注意：这里用 LOGIC(1600) 而不是 ADMIN_ERROR(2401)。
	 * 因为前端 cloud_helper 把 2401 当成"登录失效"并强制跳登录页，
	 * 权限不足时应该弹提示而不是把人踢出去。
	 *
	 * @param {string|string[]} perm 权限点；传数组表示任一满足即可
	 */
	async checkPerm(perm) {
		if (!this._admin) await this.isAdmin();

		let perms = Array.isArray(perm) ? perm : [perm];
		let ok = perms.some((p) => AdminModel.can(this._admin, p));

		if (!ok) {
			let role = AdminModel.resolveRole(this._admin);
			let roleName = AdminModel.getDesc('ROLE', role);
			throw new AppError('当前角色「' + roleName + '」无权执行此操作', appCode.LOGIC);
		}

		return this._admin;
	}

	/** 仅超级管理员 */
	async checkSuper() {
		return await this.checkPerm('MGR_MANAGE');
	}

	/** 当前角色的权限集合，供前端按角色渲染按钮 */
	async currentPerms() {
		if (!this._admin) await this.isAdmin();

		let role = AdminModel.resolveRole(this._admin);
		let perms = {};
		for (let key in AdminModel.PERM) {
			perms[key] = AdminModel.can(this._admin, key);
		}

		return {
			name: this._admin.ADMIN_NAME,
			role,
			roleDesc: AdminModel.getDesc('ROLE', role),
			isSuper: role === AdminModel.ROLE.SUPER,
			perms,
		};
	}

}

module.exports = BaseProjectAdminController;
