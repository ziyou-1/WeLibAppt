/**
 * Notes: 系统管理员实体 
 * Date: 2021-03-15 19:20:00 
 * Ver : CCMiniCloud Framework 2.0.5 ALL RIGHTS RESERVED BY CCLINUX0730 (wechat)
 */


const BaseModel = require('./base_model.js');

class AdminModel extends BaseModel {

}

// 集合名
AdminModel.CL = BaseModel.C('admin');

AdminModel.DB_STRUCTURE = {
	_pid: 'string|true',
	ADMIN_ID: 'string|true',
	ADMIN_NAME: 'string|true', 
	ADMIN_DESC: 'string|true',
	ADMIN_PHONE: 'string|false|comment=手机',
	ADMIN_PASSWORD: 'string|true|comment=密码',
	ADMIN_STATUS: 'int|true|default=1|comment=状态：0=禁用 1=启用',
	ADMIN_ROLE: 'int|true|default=4|comment=角色 1=超级管理员 2=运营 3=核销员 4=只读',

	ADMIN_LOGIN_CNT: 'int|true|default=0|comment=登录次数',
	ADMIN_LOGIN_TIME: 'int|true|default=0|comment=最后登录时间',
	ADMIN_TYPE: 'int|true|default=0|comment=类型 0=普通管理员 1=超级管理员',

	ADMIN_TOKEN: 'string|false|comment=当前登录token',
	ADMIN_TOKEN_TIME: 'int|true|default=0|comment=当前登录token time',

	ADMIN_ADD_TIME: 'int|true',
	ADMIN_EDIT_TIME: 'int|true',
	ADMIN_ADD_IP: 'string|false',
	ADMIN_EDIT_IP: 'string|false',
};

// 字段前缀
AdminModel.FIELD_PREFIX = "ADMIN_";

/**
 * 角色分级
 * 超管：全部权限
 * 运营：活动、库存、名单、核销、导出，不能管账号
 * 核销员：只能核销与查看名单
 * 只读：只能查看
 */
AdminModel.ROLE = {
	SUPER: 1,
	OPERATOR: 2,
	CHECKER: 3,
	VIEWER: 4,
};

AdminModel.ROLE_DESC = {
	SUPER: '超级管理员',
	OPERATOR: '运营',
	CHECKER: '核销员',
	VIEWER: '只读',
};

/**
 * 权限点 -> 允许的角色
 */
AdminModel.PERM = {
	// 活动增删改
	RUSH_MANAGE: [1, 2],
	// 放号 / 补放 / 扣减 / 锁定 / 暂停
	RUSH_STOCK: [1, 2],
	// 查看名单
	ORDER_VIEW: [1, 2, 3, 4],
	// 核销
	CHECKIN: [1, 2, 3],
	// 撤销核销 / 取消预约
	CHECKIN_CANCEL: [1, 2],
	// 导出
	EXPORT: [1, 2, 4],
	// 账号管理
	MGR_MANAGE: [1],
	// 系统设置 / 数据备份
	SYS_MANAGE: [1],
	// 操作日志
	LOG_VIEW: [1, 2],
};

/**
 * 取管理员角色。
 * 兼容老数据：没有 ADMIN_ROLE 字段时按 ADMIN_TYPE 推导
 * （ADMIN_TYPE=1 视为超管，其余视为只读）。
 */
AdminModel.resolveRole = function (admin) {
	if (!admin) return AdminModel.ROLE.VIEWER;
	if (admin.ADMIN_ROLE !== undefined && admin.ADMIN_ROLE !== null && admin.ADMIN_ROLE !== 0) {
		return Number(admin.ADMIN_ROLE);
	}
	if (Number(admin.ADMIN_TYPE) === 1) return AdminModel.ROLE.SUPER;
	return AdminModel.ROLE.VIEWER;
};

/** 该角色是否具备某权限 */
AdminModel.can = function (admin, permKey) {
	const allow = AdminModel.PERM[permKey];
	if (!allow) return false;
	return allow.indexOf(AdminModel.resolveRole(admin)) >= 0;
};






module.exports = AdminModel;