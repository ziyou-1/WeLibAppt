/**
 * Notes: 闪抢号码池实体
 *
 * 这是防超卖的核心：放号时预生成 N 个号码文档，
 * 抢号 = 用带条件的原子更新占住其中一个（CAS），
 * 占住成功才代表真正拿到号，天然不会超发、不会重复发号。
 */

const BaseProjectModel = require('./base_project_model.js');

class RushCodeModel extends BaseProjectModel {

}

// 集合名
RushCodeModel.CL = BaseProjectModel.C('rush_code');

RushCodeModel.DB_STRUCTURE = {
	_pid: 'string|true',
	CODE_ID: 'string|true',
	RUSH_ID: 'string|true',

	CODE_NO: 'int|true|default=0|comment=号码序号(从1开始)',
	CODE_VALUE: 'string|true|comment=购买码(唯一)',
	CODE_TAKEN: 'int|true|default=0|comment=占用标记 0=未占用 1=已占用',

	CODE_ORDER_ID: 'string|false|comment=占用它的订单ID',
	CODE_TAKEN_TIME: 'int|true|default=0|comment=占用时间',
	CODE_TAKEN_USER: 'string|false|comment=占用人openid',

	CODE_ADD_TIME: 'int|true',
	CODE_EDIT_TIME: 'int|true',
	CODE_ADD_IP: 'string|false',
	CODE_EDIT_IP: 'string|false',
};

// 字段前缀
RushCodeModel.FIELD_PREFIX = 'CODE_';

module.exports = RushCodeModel;
