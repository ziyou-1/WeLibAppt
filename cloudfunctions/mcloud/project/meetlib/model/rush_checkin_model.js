/**
 * Notes: 核销流水实体
 *
 * 每一次核销、撤销核销都单独落一条流水，
 * 支持按场次/核销员/时间回溯，且可导出。
 * 订单表只保存"当前状态"，流水表保存"发生过什么"。
 */

const BaseProjectModel = require('./base_project_model.js');

class RushCheckinModel extends BaseProjectModel {

}

// 集合名
RushCheckinModel.CL = BaseProjectModel.C('rush_checkin');

RushCheckinModel.DB_STRUCTURE = {
	_pid: 'string|true',
	CHECKIN_ID: 'string|true',
	RUSH_ID: 'string|true',

	CHECKIN_ORDER_ID: 'string|true',
	CHECKIN_CODE: 'string|true|comment=购买码',
	CHECKIN_NO: 'int|true|default=0|comment=号码',

	CHECKIN_USER_ID: 'string|false|comment=预约人openid',
	CHECKIN_NAME: 'string|false|comment=姓名',
	CHECKIN_PHONE: 'string|false|comment=手机号',

	CHECKIN_TYPE: 'int|true|default=1|comment=类型 1=核销 2=撤销核销',
	CHECKIN_ADMIN_ID: 'string|false|comment=操作人ID',
	CHECKIN_ADMIN_NAME: 'string|false|comment=操作人姓名',
	CHECKIN_DEVICE: 'string|false|comment=核销设备',

	CHECKIN_TIME: 'int|true|default=0|comment=操作时间',

	CHECKIN_ADD_TIME: 'int|true',
	CHECKIN_EDIT_TIME: 'int|true',
	CHECKIN_ADD_IP: 'string|false',
	CHECKIN_EDIT_IP: 'string|false',
};

// 字段前缀
RushCheckinModel.FIELD_PREFIX = 'CHECKIN_';

RushCheckinModel.TYPE = {
	CHECKIN: 1,
	REVERT: 2,
};

RushCheckinModel.TYPE_DESC = {
	CHECKIN: '核销',
	REVERT: '撤销核销',
};

module.exports = RushCheckinModel;
