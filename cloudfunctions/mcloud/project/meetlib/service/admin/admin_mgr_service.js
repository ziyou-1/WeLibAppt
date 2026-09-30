/**
 * Notes: 管理员管理（含角色分级）
 * Ver : CCMiniCloud Framework 2.0.1 ALL RIGHTS RESERVED BY cclinux0730 (wechat)
 * Date: 2021-07-11 07:48:00 
 *
 * 说明：原版把这套功能全部屏蔽（提示"该功能暂不开放，请联系作者"），
 * 这里按需求补全实现：账号增删改查、启停用、改密、重置密码、日志清空。
 */

const BaseProjectAdminService = require('./base_project_admin_service.js');
const util = require('../../../../framework/utils/util.js');
const dataUtil = require('../../../../framework/utils/data_util.js');
const timeUtil = require('../../../../framework/utils/time_util.js');
const AdminModel = require('../../../../framework/platform/model/admin_model.js');
const LogModel = require('../../../../framework/platform/model/log_model.js');
const md5Lib = require('../../../../framework/lib/md5_lib.js');

class AdminMgrService extends BaseProjectAdminService {

	//**管理员登录  */
	async adminLogin(name, password) {

		// 判断是否存在
		let where = {
			ADMIN_STATUS: 1,
			ADMIN_NAME: name,
			ADMIN_PASSWORD: md5Lib.md5(password)
		}
		let fields = 'ADMIN_ID,ADMIN_NAME,ADMIN_DESC,ADMIN_TYPE,ADMIN_ROLE,ADMIN_LOGIN_TIME,ADMIN_LOGIN_CNT';
		let admin = await AdminModel.getOne(where, fields);
		if (!admin)
			this.AppError('管理员不存在或者已停用');

		let cnt = admin.ADMIN_LOGIN_CNT;

		// 生成token
		let token = dataUtil.genRandomString(32);
		let tokenTime = timeUtil.time();
		let data = {
			ADMIN_TOKEN: token,
			ADMIN_TOKEN_TIME: tokenTime,
			ADMIN_LOGIN_TIME: timeUtil.time(),
			ADMIN_LOGIN_CNT: cnt + 1
		}
		await AdminModel.edit(where, data);

		let type = admin.ADMIN_TYPE;
		let role = AdminModel.resolveRole(admin);
		let last = (!admin.ADMIN_LOGIN_TIME) ? '尚未登录' : timeUtil.timestamp2Time(admin.ADMIN_LOGIN_TIME);

		// 写日志
		this.insertLog('登录了系统', admin, LogModel.TYPE.SYS);

		return {
			token,
			name: admin.ADMIN_NAME,
			type,
			role,
			roleDesc: AdminModel.getDesc('ROLE', role),
			last,
			cnt
		}

	}

	/** 清空操作日志 */
	async clearLog(admin) {
		await LogModel.clear();
		if (admin) this.insertLog('清空了操作日志', admin, LogModel.TYPE.SYS);
		return { ok: true };
	}

	/** 取得日志分页列表 */
	async getLogList({
		search, // 搜索条件
		sortType, // 搜索菜单
		sortVal, // 搜索菜单
		orderBy, // 排序
		whereEx, //附加查询条件 
		page,
		size,
		oldTotal = 0
	}) {

		orderBy = orderBy || {
			LOG_ADD_TIME: 'desc'
		};
		let fields = '*';
		let where = {};

		if (util.isDefined(search) && search) {
			where.or = [{
				LOG_CONTENT: ['like', search]
			}, {
				LOG_ADMIN_DESC: ['like', search]
			}, {
				LOG_ADMIN_NAME: ['like', search]
			}];

		} else if (sortType && util.isDefined(sortVal)) {
			// 搜索菜单
			switch (sortType) {
				case 'type':
					// 按类型
					where.LOG_TYPE = Number(sortVal);
					break;
			}
		}
		let result = await LogModel.getList(where, fields, orderBy, page, size, true, oldTotal);

		return result;
	}

	/** 获取所有管理员 */
	async getMgrList({
		search, // 搜索条件
		sortType, // 搜索菜单
		sortVal, // 搜索菜单
		orderBy, // 排序
		whereEx, //附加查询条件
		page,
		size,
		isTotal = true,
		oldTotal
	}) {
		orderBy = {
			ADMIN_ADD_TIME: 'desc'
		}
		let fields = 'ADMIN_NAME,ADMIN_STATUS,ADMIN_PHONE,ADMIN_TYPE,ADMIN_ROLE,ADMIN_LOGIN_CNT,ADMIN_LOGIN_TIME,ADMIN_DESC,ADMIN_EDIT_TIME,ADMIN_EDIT_IP';

		let where = {};
		where.and = {
			_pid: this.getProjectId() //复杂的查询在此处标注PID
		};
		if (util.isDefined(search) && search) {
			where.or = [{
				ADMIN_NAME: ['like', search]
			},
			{
				ADMIN_PHONE: ['like', search]
			},
			{
				ADMIN_DESC: ['like', search]
			}
			];
		} else if (sortType && util.isDefined(sortVal)) {
			// 搜索菜单
			switch (sortType) {
				case 'status':
					// 按类型
					where.and.ADMIN_STATUS = Number(sortVal);
					break;
				case 'type':
					// 按类型
					where.and.ADMIN_TYPE = Number(sortVal);
					break;
				case 'role':
					where.and.ADMIN_ROLE = Number(sortVal);
					break;
			}
		}

		return await AdminModel.getList(where, fields, orderBy, page, size, isTotal, oldTotal);
	}

	/** 添加新的管理员 */
	async insertMgr({ name, desc, phone, password, role }, myAdmin) {

		if (!name) this.AppError('请填写登录账号');
		if (!password) this.AppError('请填写登录密码');

		// 账号唯一
		let exist = await AdminModel.getOne({ ADMIN_NAME: name }, 'ADMIN_ID');
		if (exist) this.AppError('账号「' + name + '」已存在');

		let roleVal = Number(role);
		if (!AdminModel.ROLE_DESC[Object.keys(AdminModel.ROLE).find((k) => AdminModel.ROLE[k] === roleVal)])
			roleVal = AdminModel.ROLE.VIEWER;

		// ADMIN_TYPE 与 ADMIN_ROLE 保持同步，兼容框架内既有的 isSuperAdmin 判断
		let type = roleVal === AdminModel.ROLE.SUPER ? 1 : 0;

		let id = await AdminModel.insert({
			ADMIN_NAME: name,
			ADMIN_DESC: desc || name,
			ADMIN_PHONE: phone || '',
			ADMIN_PASSWORD: md5Lib.md5(password),
			ADMIN_ROLE: roleVal,
			ADMIN_TYPE: type,
			ADMIN_STATUS: 1,
			ADMIN_LOGIN_CNT: 0,
			ADMIN_LOGIN_TIME: 0,
			ADMIN_TOKEN: '',
			ADMIN_TOKEN_TIME: 0,
		});

		if (myAdmin) {
			this.insertLog('新增管理员「' + name + '」（' + AdminModel.getDesc('ROLE', roleVal) + '）', myAdmin, LogModel.TYPE.SYS);
		}

		return { id };
	}

	/** 修改管理员 */
	async editMgr(id, { name, desc, phone, role }, myAdmin) {

		let target = await AdminModel.getOne({ _id: id }, 'ADMIN_ID,ADMIN_NAME,ADMIN_ROLE,ADMIN_TYPE,ADMIN_STATUS');
		if (!target) this.AppError('管理员不存在');

		// 改名时校验唯一
		if (name && name !== target.ADMIN_NAME) {
			let exist = await AdminModel.getOne({ ADMIN_NAME: name }, 'ADMIN_ID');
			if (exist) this.AppError('账号「' + name + '」已存在');
		}

		let data = {};
		if (util.isDefined(name)) data.ADMIN_NAME = name;
		if (util.isDefined(desc)) data.ADMIN_DESC = desc;
		if (util.isDefined(phone)) data.ADMIN_PHONE = phone;

		if (util.isDefined(role)) {
			let roleVal = Number(role);
			if (AdminModel.resolveRole(target) === AdminModel.ROLE.SUPER && roleVal !== AdminModel.ROLE.SUPER) {
				// 降级超管前确认还有人能管系统
				await this._assertNotLastSuper(id);
			}
			data.ADMIN_ROLE = roleVal;
			data.ADMIN_TYPE = roleVal === AdminModel.ROLE.SUPER ? 1 : 0;
		}

		if (Object.keys(data).length === 0) return { updated: 0 };

		let updated = await AdminModel.edit({ _id: id }, data);

		if (myAdmin) {
			this.insertLog('修改管理员「' + (name || target.ADMIN_NAME) + '」', myAdmin, LogModel.TYPE.SYS);
		}

		return { updated };
	}

	/** 修改状态（启用/停用） */
	async statusMgr(id, status, myAdmin) {

		let target = await AdminModel.getOne({ _id: id }, 'ADMIN_ID,ADMIN_NAME,ADMIN_ROLE,ADMIN_TYPE');
		if (!target) this.AppError('管理员不存在');

		status = Number(status);

		// 不能停用自己
		if (myAdmin && String(myAdmin._id) === String(id) && status === 0)
			this.AppError('不能停用自己的账号');

		// 不能停用最后一个超管
		if (status === 0 && AdminModel.resolveRole(target) === AdminModel.ROLE.SUPER)
			await this._assertNotLastSuper(id);

		await AdminModel.edit({ _id: id }, { ADMIN_STATUS: status });

		if (myAdmin) {
			this.insertLog((status ? '启用' : '停用') + '管理员「' + target.ADMIN_NAME + '」', myAdmin, LogModel.TYPE.SYS);
		}

		return { status };
	}

	/** 删除管理员 */
	async delMgr(id, myAdmin) {

		let target = await AdminModel.getOne({ _id: id }, 'ADMIN_ID,ADMIN_NAME,ADMIN_ROLE,ADMIN_TYPE');
		if (!target) this.AppError('管理员不存在');

		if (myAdmin && String(myAdmin._id) === String(id))
			this.AppError('不能删除自己的账号');

		if (AdminModel.resolveRole(target) === AdminModel.ROLE.SUPER)
			await this._assertNotLastSuper(id);

		await AdminModel.del({ _id: id });

		if (myAdmin) {
			this.insertLog('删除管理员「' + target.ADMIN_NAME + '」', myAdmin, LogModel.TYPE.SYS);
		}

		return { ok: true };
	}

	/** 修改自身密码 */
	async pwdtMgr(adminId, oldPassword, password) {

		let admin = await AdminModel.getOne({ _id: adminId }, 'ADMIN_NAME,ADMIN_PASSWORD');
		if (!admin) this.AppError('管理员不存在');

		if (admin.ADMIN_PASSWORD !== md5Lib.md5(oldPassword))
			this.AppError('原密码不正确');

		if (oldPassword === password)
			this.AppError('新密码不能与原密码相同');

		await AdminModel.edit({ _id: adminId }, {
			ADMIN_PASSWORD: md5Lib.md5(password),
			ADMIN_TOKEN: '',
			ADMIN_TOKEN_TIME: 0,
		});

		return { ok: true };
	}

	/** 重置他人密码（超管） */
	async resetMgrPwd(id, password, myAdmin) {

		let target = await AdminModel.getOne({ _id: id }, 'ADMIN_NAME');
		if (!target) this.AppError('管理员不存在');

		await AdminModel.edit({ _id: id }, {
			ADMIN_PASSWORD: md5Lib.md5(password),
			ADMIN_TOKEN: '',
			ADMIN_TOKEN_TIME: 0,
		});

		if (myAdmin) {
			this.insertLog('重置了管理员「' + target.ADMIN_NAME + '」的密码', myAdmin, LogModel.TYPE.SYS);
		}

		return { ok: true };
	}

	/** 获取管理员信息 */
	async getMgrDetail(id) {
		let fields = '*';

		let where = {
			_id: id
		}
		let mgr = await AdminModel.getOne(where, fields);
		if (!mgr) return null;

		mgr.ROLE = AdminModel.resolveRole(mgr);
		mgr.ROLE_DESC = AdminModel.getDesc('ROLE', mgr.ROLE);

		return mgr;
	}

	/**
	 * 确认这不是"最后一个启用的超级管理员"
	 * 避免把系统管到没人能登录
	 */
	async _assertNotLastSuper(id) {
		let cnt = await AdminModel.count({
			ADMIN_ROLE: AdminModel.ROLE.SUPER,
			ADMIN_STATUS: 1,
		});

		// 兼容尚未写入 ADMIN_ROLE 的老数据
		if (cnt === 0) {
			cnt = await AdminModel.count({
				ADMIN_TYPE: 1,
				ADMIN_STATUS: 1,
			});
		}

		if (cnt <= 1) this.AppError('系统必须保留至少一个启用的超级管理员');
	}
}

module.exports = AdminMgrService;
