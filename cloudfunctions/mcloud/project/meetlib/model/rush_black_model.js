/**
 * Notes: 风控黑名单实体
 *
 * 支持按 openid / 手机号 维度拉黑，
 * 抢号链路会在占号前先过黑名单。
 */

const BaseProjectModel = require('./base_project_model.js');

class RushBlackModel extends BaseProjectModel {

}

// 集合名
RushBlackModel.CL = BaseProjectModel.C('rush_black');

RushBlackModel.DB_STRUCTURE = {
	_pid: 'string|true',
	BLACK_ID: 'string|true',

	BLACK_TYPE: 'int|true|default=1|comment=类型 1=openid 2=手机号',
	BLACK_VALUE: 'string|true|comment=拉黑的值',
	BLACK_REASON: 'string|false|comment=拉黑原因',

	BLACK_ADMIN_ID: 'string|false|comment=操作人',
	BLACK_ADMIN_NAME: 'string|false',

	BLACK_STATUS: 'int|true|default=1|comment=0=已解除 1=生效中',
	BLACK_TIME: 'int|true|default=0|comment=拉黑时间',

	BLACK_ADD_TIME: 'int|true',
	BLACK_EDIT_TIME: 'int|true',
	BLACK_ADD_IP: 'string|false',
	BLACK_EDIT_IP: 'string|false',
};

// 字段前缀
RushBlackModel.FIELD_PREFIX = 'BLACK_';

RushBlackModel.TYPE = {
	OPENID: 1,
	PHONE: 2,
};

RushBlackModel.TYPE_DESC = {
	OPENID: 'openid',
	PHONE: '手机号',
};

module.exports = RushBlackModel;
