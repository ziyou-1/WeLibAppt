/**
 * Notes: 订阅消息记录实体
 *
 * 微信订阅消息是"一次性授权"：用户每授权一次，只能收到一条。
 * 这里为每次授权落一条记录并扣减可发送次数，
 * 既保证不超发，也能在后台看到订阅明细与发送结果。
 */

const BaseProjectModel = require('./base_project_model.js');

class RushSubscribeModel extends BaseProjectModel {

}

// 集合名
RushSubscribeModel.CL = BaseProjectModel.C('rush_subscribe');

RushSubscribeModel.DB_STRUCTURE = {
	_pid: 'string|true',
	SUB_ID: 'string|true',

	SUB_USER_ID: 'string|true|comment=订阅人openid',
	SUB_RUSH_ID: 'string|false|comment=关联活动',
	SUB_TEMPLATE_ID: 'string|true|comment=模板ID',

	SUB_TYPE: 'int|true|default=1|comment=类型 1=开抢提醒 2=预约成功 3=核销成功',
	SUB_PAGE: 'string|false|comment=点击跳转页面',

	SUB_STATUS: 'int|true|default=0|comment=0=待发送 1=已发送 2=发送失败',
	SUB_TIMES: 'int|true|default=1|comment=剩余可发送次数（微信订阅为一次性授权）',
	SUB_SEND_TIME: 'int|true|default=0',
	SUB_ERR: 'string|false|comment=失败原因',

	SUB_ADD_TIME: 'int|true',
	SUB_EDIT_TIME: 'int|true',
	SUB_ADD_IP: 'string|false',
	SUB_EDIT_IP: 'string|false',
};

// 字段前缀
RushSubscribeModel.FIELD_PREFIX = 'SUB_';

RushSubscribeModel.TYPE = {
	START: 1,
	SUCCESS: 2,
	CHECKIN: 3,
};

RushSubscribeModel.TYPE_DESC = {
	START: '开抢提醒',
	SUCCESS: '预约成功',
	CHECKIN: '核销成功',
};

RushSubscribeModel.STATUS = {
	WAIT: 0,
	SENT: 1,
	FAIL: 2,
};

RushSubscribeModel.STATUS_DESC = {
	WAIT: '待发送',
	SENT: '已发送',
	FAIL: '发送失败',
};

/**
 * 模板配置的 SETUP key（存在框架自带的 setup 表里）
 */
RushSubscribeModel.SETUP_KEY = {
	START: 'rush_tmpl_start',
	SUCCESS: 'rush_tmpl_success',
	CHECKIN: 'rush_tmpl_checkin',
};

module.exports = RushSubscribeModel;
