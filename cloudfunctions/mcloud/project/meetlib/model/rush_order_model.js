/**
 * Notes: 闪抢订单实体
 */

const BaseProjectModel = require('./base_project_model.js');

class RushOrderModel extends BaseProjectModel {

}

// 集合名
RushOrderModel.CL = BaseProjectModel.C('rush_order');

RushOrderModel.DB_STRUCTURE = {
	_pid: 'string|true',
	RUSH_ID: 'string|true',
	RUSH_ORDER_ID: 'string|true',

	RUSH_ORDER_USER_ID: 'string|true|comment=openid',
	RUSH_ORDER_NO: 'int|true|default=0|comment=号码',
	RUSH_ORDER_CODE: 'string|true|comment=购买码',

	RUSH_ORDER_NAME: 'string|false|comment=姓名',
	RUSH_ORDER_PHONE: 'string|false|comment=手机号',
	RUSH_ORDER_NICK: 'string|false|comment=微信昵称',
	RUSH_ORDER_SESSION: 'string|false|comment=所选时段',
	RUSH_ORDER_FORMS: 'array|true|default=[]|comment=表单数据',
	RUSH_ORDER_OBJ: 'object|true|default={}',

	RUSH_ORDER_STATUS: 'int|true|default=0|comment=0=已预约 1=已核销 2=已取消',
	RUSH_ORDER_TIME: 'int|true|default=0|comment=预约时间',

	RUSH_ORDER_CHECKIN_TIME: 'int|true|default=0|comment=核销时间',
	RUSH_ORDER_CHECKIN_ADMIN: 'string|false|comment=核销员',
	RUSH_ORDER_CHECKIN_ADMIN_ID: 'string|false',
	RUSH_ORDER_CHECKIN_DEVICE: 'string|false|comment=核销设备',

	RUSH_ORDER_ADD_TIME: 'int|true',
	RUSH_ORDER_EDIT_TIME: 'int|true',
	RUSH_ORDER_ADD_IP: 'string|false',
	RUSH_ORDER_EDIT_IP: 'string|false',
};

// 字段前缀
RushOrderModel.FIELD_PREFIX = 'RUSH_ORDER_';

RushOrderModel.STATUS = {
	BOOKED: 0,
	CHECKIN: 1,
	CANCEL: 2,
};

RushOrderModel.STATUS_DESC = {
	BOOKED: '已预约',
	CHECKIN: '已核销',
	CANCEL: '已取消',
};

module.exports = RushOrderModel;
