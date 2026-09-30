/**
 * Notes: 闪抢活动/场次实体
 * 开抢时刻驱动的高并发放号场景：开抢时间、放号总量、单人限购、状态流转
 */

const BaseProjectModel = require('./base_project_model.js');

class RushModel extends BaseProjectModel {

}

// 集合名
RushModel.CL = BaseProjectModel.C('rush');

RushModel.DB_STRUCTURE = {
	_pid: 'string|true',
	RUSH_ID: 'string|true',
	RUSH_ADMIN_ID: 'string|true|comment=创建管理员',

	RUSH_TITLE: 'string|true|comment=活动名称',
	RUSH_DESC: 'string|false|comment=活动简介',
	RUSH_PIC: 'string|false|comment=Banner图',
	RUSH_NOTICE: 'string|false|comment=活动须知',
	RUSH_PLACE: 'string|false|comment=活动地点',

	RUSH_START_TIME: 'int|true|default=0|comment=开抢时间(ms时间戳)',
	RUSH_END_TIME: 'int|true|default=0|comment=结束时间(ms时间戳)',

	RUSH_TOTAL: 'int|true|default=0|comment=放号总量',
	RUSH_LIMIT: 'int|true|default=1|comment=单人限购',
	RUSH_LOCK_STOCK: 'int|true|default=0|comment=锁定库存(不放出)',
	RUSH_TAKEN: 'int|true|default=0|comment=已发放数',
	RUSH_TAKEN_BACK: 'int|true|default=0|comment=已撤回数',

	RUSH_STATUS: 'int|true|default=0|comment=状态 0草稿 1待开抢 2进行中 3已结束',
	RUSH_PAUSE: 'int|true|default=0|comment=一键暂停 0=正常 1=暂停放号',
	RUSH_ORDER: 'int|true|default=9999',

	RUSH_FORMS: 'array|true|default=[]|comment=预约表单字段',
	RUSH_OBJ: 'object|true|default={}',
	RUSH_SESSIONS: 'array|true|default=[]|comment=可选时段 [{name,start,end}]',

	RUSH_ADD_TIME: 'int|true',
	RUSH_EDIT_TIME: 'int|true',
	RUSH_ADD_IP: 'string|false',
	RUSH_EDIT_IP: 'string|false',
};

// 字段前缀
RushModel.FIELD_PREFIX = 'RUSH_';

/**
 * 状态机：草稿 -> 待开抢 -> 进行中 -> 已结束
 */
RushModel.STATUS = {
	DRAFT: 0,
	WAIT: 1,
	RUNNING: 2,
	OVER: 3,
};

RushModel.STATUS_DESC = {
	DRAFT: '草稿',
	WAIT: '待开抢',
	RUNNING: '进行中',
	OVER: '已结束',
};

module.exports = RushModel;
