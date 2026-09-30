'use strict';
/**
 * mock-db.js —— 本地云数据库模拟引擎
 *
 * 实现 wx-server-sdk `cloud.database()` 的子集，语义对齐微信云开发：
 *   collection(name).add / where / doc / skip / limit / field / orderBy / get / count / update / remove
 *   collection(name).aggregate() -> match / group / sort / project / lookup / unwind / sample / skip / limit / count / end
 *   db.command: eq neq lt lte gt gte in nin and or not exists inc mul set remove
 *   db.command.aggregate: sum avg max min first last push addToSet count
 *   db.createCollection / db.RegExp / db.serverDate
 *
 * 数据落盘为 local-dev/data/<collection>.json，每个文档带 _id。
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

/* ------------------------------------------------------------------ *
 * 操作符
 * ------------------------------------------------------------------ */

class Command {
  constructor(op, val) {
    this.__cmd = op;
    this.__cmdVal = val;
  }
  and(...args) {
    return new Command('and', [this, ...flatten(args)]);
  }
  or(...args) {
    return new Command('or', [this, ...flatten(args)]);
  }
  toJSON() {
    return { __cmd: this.__cmd };
  }
}

class AggOp {
  constructor(op, val) {
    this.__agg = op;
    this.__aggVal = val;
  }
}

class DbRegExp {
  constructor(opts) {
    this.regexp = opts && opts.regexp ? opts.regexp : String(opts || '');
    this.options = (opts && opts.options) || '';
  }
  toRegExp() {
    return new RegExp(this.regexp, this.options);
  }
}

function flatten(args) {
  const out = [];
  for (const a of args) {
    if (Array.isArray(a)) out.push(...a);
    else out.push(a);
  }
  return out;
}

function isCommand(v) {
  return v instanceof Command;
}
function isAggOp(v) {
  return v instanceof AggOp;
}
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

const aggregateNs = {
  sum: (v) => new AggOp('sum', v),
  avg: (v) => new AggOp('avg', v),
  max: (v) => new AggOp('max', v),
  min: (v) => new AggOp('min', v),
  first: (v) => new AggOp('first', v),
  last: (v) => new AggOp('last', v),
  push: (v) => new AggOp('push', v),
  addToSet: (v) => new AggOp('addToSet', v),
  count: () => new AggOp('count', 1),
};

const command = {
  eq: (v) => new Command('eq', v),
  neq: (v) => new Command('neq', v),
  lt: (v) => new Command('lt', v),
  lte: (v) => new Command('lte', v),
  gt: (v) => new Command('gt', v),
  gte: (v) => new Command('gte', v),
  in: (v) => new Command('in', v),
  nin: (v) => new Command('nin', v),
  exists: (v) => new Command('exists', v),
  not: (v) => new Command('not', v),
  and: (...args) => new Command('and', flatten(args)),
  or: (...args) => new Command('or', flatten(args)),
  // 更新操作符
  set: (v) => new Command('set', v),
  remove: () => new Command('remove', null),
  inc: (v) => new Command('inc', v),
  mul: (v) => new Command('mul', v),
  // 聚合操作符命名空间（项目里用 dbCmd.aggregate / dbAggr）
  aggregate: aggregateNs,
};

/* ------------------------------------------------------------------ *
 * 比较 / 匹配
 * ------------------------------------------------------------------ */

function getField(doc, keyPath) {
  if (keyPath.indexOf('.') < 0) return doc[keyPath];
  let cur = doc;
  for (const part of keyPath.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
}

function setField(doc, keyPath, value) {
  if (keyPath.indexOf('.') < 0) {
    doc[keyPath] = value;
    return;
  }
  const parts = keyPath.split('.');
  let cur = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isPlainObject(cur[parts[i]])) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function unsetField(doc, keyPath) {
  if (keyPath.indexOf('.') < 0) {
    delete doc[keyPath];
    return;
  }
  const parts = keyPath.split('.');
  let cur = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur[parts[i]];
    if (!cur) return;
  }
  delete cur[parts[parts.length - 1]];
}

function deepEq(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) {
    // 云数据库为强类型比较，但本地 JSON 可能出现 "1" vs 1，保持严格
    return false;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEq(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEq(a[k], b[k]));
  }
  return false;
}

function toComparable(v) {
  return v;
}

/** 单个字段值 vs 条件 的匹配 */
function matchCondition(fieldValue, cond) {
  if (isCommand(cond)) {
    const v = cond.__cmdVal;
    switch (cond.__cmd) {
      case 'eq':
        return deepEq(fieldValue, v);
      case 'neq':
        return !deepEq(fieldValue, v);
      case 'lt':
        return toComparable(fieldValue) < v;
      case 'lte':
        return toComparable(fieldValue) <= v;
      case 'gt':
        return toComparable(fieldValue) > v;
      case 'gte':
        return toComparable(fieldValue) >= v;
      case 'in':
        return Array.isArray(v) && v.some((x) => deepEq(fieldValue, x));
      case 'nin':
        return !(Array.isArray(v) && v.some((x) => deepEq(fieldValue, x)));
      case 'exists':
        return v ? fieldValue !== undefined : fieldValue === undefined;
      case 'not':
        return !matchCondition(fieldValue, v);
      case 'and':
        return v.every((c) => matchCondition(fieldValue, c));
      case 'or':
        return v.some((c) => matchCondition(fieldValue, c));
      // 更新类操作符出现在查询里视为等值（容错）
      case 'inc':
      case 'mul':
      case 'set':
        return deepEq(fieldValue, v);
      default:
        throw new Error('[mock-db] unknown command: ' + cond.__cmd);
    }
  }

  // Mongo 风格正则条件（项目 fmtWhereSimple 的 'like'）
  if (isPlainObject(cond) && ('$regex' in cond || '$options' in cond)) {
    const re = new RegExp(cond.$regex, cond.$options || '');
    return re.test(String(fieldValue === undefined ? '' : fieldValue));
  }

  if (cond instanceof DbRegExp) {
    return cond.toRegExp().test(String(fieldValue === undefined ? '' : fieldValue));
  }

  // 数组字段：等值匹配包含关系（云数据库语义）
  if (Array.isArray(fieldValue) && !Array.isArray(cond)) {
    return fieldValue.some((x) => deepEq(x, cond));
  }

  if (isPlainObject(cond) && isPlainObject(fieldValue)) {
    // 嵌套对象条件，逐字段匹配
    return Object.keys(cond).every((k) => matchCondition(fieldValue[k], cond[k]));
  }

  return deepEq(fieldValue, cond);
}

/** 顶层 where 匹配（where 可能是 Command('and'/'or') 或普通对象） */
function matchWhere(doc, where) {
  if (!where) return true;

  if (isCommand(where)) {
    if (where.__cmd === 'and') return where.__cmdVal.every((c) => matchWhere(doc, c));
    if (where.__cmd === 'or') return where.__cmdVal.some((c) => matchWhere(doc, c));
    throw new Error('[mock-db] top-level command must be and/or, got ' + where.__cmd);
  }

  return Object.keys(where).every((key) => matchCondition(getField(doc, key), where[key]));
}

/* ------------------------------------------------------------------ *
 * 排序 / 投影
 * ------------------------------------------------------------------ */

function compareValues(a, b) {
  if (a === b) return 0;
  if (a === undefined || a === null) return 1; // 空值排后
  if (b === undefined || b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function applySort(list, sortSpec) {
  const keys = Object.keys(sortSpec || {});
  if (!keys.length) return list;
  return list.slice().sort((x, y) => {
    for (const k of keys) {
      const dir = Number(sortSpec[k]) < 0 ? -1 : 1;
      const c = compareValues(getField(x, k), getField(y, k));
      if (c !== 0) return c * dir;
    }
    return 0;
  });
}

/** field() 投影：true = 保留，false = 排除 */
function projectDoc(doc, spec) {
  if (!spec || typeof spec !== 'object') return doc;
  const keys = Object.keys(spec);
  if (!keys.length) return doc;
  const includes = keys.filter((k) => spec[k] === true || Number(spec[k]) === 1);
  const excludes = keys.filter((k) => spec[k] === false || Number(spec[k]) === 0);

  if (includes.length && !excludes.length) {
    const out = { _id: doc._id };
    for (const k of includes) {
      const v = getField(doc, k);
      if (v !== undefined) setField(out, k, v);
    }
    return out;
  }
  const out = Object.assign({}, doc);
  for (const k of excludes) unsetField(out, k);
  return out;
}

/* ------------------------------------------------------------------ *
 * 存储
 * ------------------------------------------------------------------ */

class Store {
  constructor(dir) {
    this.dir = dir || DATA_DIR;
    this.collections = new Map();
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
  }

  fileFor(name) {
    return path.join(this.dir, name + '.json');
  }

  /** 内存中的集合数组（惰性加载） */
  docs(name) {
    if (this.collections.has(name)) return this.collections.get(name);
    let arr = [];
    const f = this.fileFor(name);
    if (fs.existsSync(f)) {
      try {
        const raw = fs.readFileSync(f, 'utf8').trim();
        arr = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(arr)) arr = [];
      } catch (err) {
        throw new Error('[mock-db] 集合文件解析失败 ' + f + ' :: ' + err.message);
      }
    }
    this.collections.set(name, arr);
    return arr;
  }

  flush(name) {
    const arr = this.docs(name);
    const f = this.fileFor(name);
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(arr, null, 2), 'utf8');
    fs.renameSync(tmp, f);
    return arr.length;
  }

  create(name) {
    const f = this.fileFor(name);
    if (fs.existsSync(f)) return false;
    this.collections.set(name, []);
    this.flush(name);
    return true;
  }

  exists(name) {
    return fs.existsSync(this.fileFor(name));
  }

  /**
   * 与真实云数据库一致：集合不存在时访问会抛 errCode -502005。
   * 项目的 initSetup() 正是依赖这个异常来判断是否需要初始化，
   * 因此这里必须抛错而不是静默返回空集合。
   */
  assertExists(name) {
    if (!fs.existsSync(this.fileFor(name))) {
      const err = new Error('database collection not exists');
      err.errCode = -502005;
      err.errMsg = `database collection not exists [${name}]`;
      throw err;
    }
  }

  listCollections() {
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'))
      .map((f) => f.slice(0, -5))
      .sort();
  }

  drop(name) {
    this.collections.delete(name);
    const f = this.fileFor(name);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  nextId() {
    this._seq = (this._seq || 0) + 1;
    return (
      Date.now().toString(36) +
      this._seq.toString(36).padStart(3, '0') +
      Math.random().toString(36).slice(2, 8)
    );
  }
}

/* ------------------------------------------------------------------ *
 * 查询构建器
 * ------------------------------------------------------------------ */

class Query {
  constructor(store, name) {
    this._store = store;
    this._name = name;
    this._where = null;
    this._docId = null;
    this._skip = 0;
    this._limit = 0;
    this._field = null;
    this._orderBy = {};
  }

  where(cond) {
    if (cond === undefined || cond === null) return this;
    if (isPlainObject(cond) && Object.keys(cond).length === 0) {
      this._where = null;
      return this;
    }
    this._where = cond;
    return this;
  }

  doc(id) {
    this._docId = id;
    return this;
  }

  skip(n) {
    this._skip = Number(n) || 0;
    return this;
  }

  limit(n) {
    this._limit = Number(n) || 0;
    return this;
  }

  field(spec) {
    this._field = spec;
    return this;
  }

  orderBy(key, dir) {
    if (key) this._orderBy[key] = dir === 'desc' || dir === -1 ? -1 : 1;
    return this;
  }

  /** 执行筛选（不投影） */
  _select() {
    this._store.assertExists(this._name);
    let list = this._store.docs(this._name);
    if (this._docId !== null) {
      list = list.filter((d) => deepEq(d._id, this._docId));
    }
    if (this._where) {
      list = list.filter((d) => matchWhere(d, this._where));
    }
    return list;
  }

  async get() {
    let list = this._select();
    list = applySort(list, this._orderBy);
    if (this._skip) list = list.slice(this._skip);
    if (this._limit) list = list.slice(0, this._limit);
    list = this._field ? list.map((d) => projectDoc(d, this._field)) : list.map((d) => Object.assign({}, d));
    return { data: list, errMsg: 'collection.get:ok' };
  }

  async count() {
    return { total: this._select().length, errMsg: 'collection.count:ok' };
  }

  async add({ data }) {
    this._store.assertExists(this._name);
    if (!isPlainObject(data)) throw new Error('[mock-db] add() 需要 data 对象');
    const arr = this._store.docs(this._name);
    const doc = Object.assign({}, data);
    if (doc._id === undefined || doc._id === null || doc._id === '') doc._id = this._store.nextId();
    arr.push(doc);
    this._store.flush(this._name);
    return { _id: doc._id, errMsg: 'collection.add:ok' };
  }

  _applyUpdate(doc, data) {
    let touched = false;
    for (const key of Object.keys(data)) {
      const v = data[key];
      if (isCommand(v)) {
        switch (v.__cmd) {
          case 'inc':
            setField(doc, key, Number(getField(doc, key) || 0) + Number(v.__cmdVal));
            touched = true;
            break;
          case 'mul':
            setField(doc, key, Number(getField(doc, key) || 0) * Number(v.__cmdVal));
            touched = true;
            break;
          case 'set':
            setField(doc, key, v.__cmdVal);
            touched = true;
            break;
          case 'remove':
            unsetField(doc, key);
            touched = true;
            break;
          default:
            setField(doc, key, v.__cmdVal);
            touched = true;
        }
      } else {
        setField(doc, key, v);
        touched = true;
      }
    }
    return touched;
  }

  async update({ data }) {
    if (!isPlainObject(data)) throw new Error('[mock-db] update() 需要 data 对象');
    const targets = this._select();
    let updated = 0;
    for (const doc of targets) {
      if (this._applyUpdate(doc, data)) updated++;
    }
    if (updated) this._store.flush(this._name);
    return { stats: { updated }, errMsg: 'collection.update:ok' };
  }

  async remove() {
    const arr = this._store.docs(this._name);
    const targets = this._select();
    const ids = new Set(targets.map((d) => d._id));
    const removed = ids.size;
    if (removed) {
      const kept = arr.filter((d) => !ids.has(d._id));
      arr.length = 0;
      arr.push(...kept);
      this._store.flush(this._name);
    }
    return { stats: { removed }, errMsg: 'collection.remove:ok' };
  }

  aggregate() {
    return new Aggregate(this._store, this._name);
  }
}

/* ------------------------------------------------------------------ *
 * 聚合构建器
 * ------------------------------------------------------------------ */

class Aggregate {
  constructor(store, name) {
    this._store = store;
    this._name = name;
    this._steps = [];
  }

  match(cond) {
    this._steps.push({ op: 'match', v: cond });
    return this;
  }
  group(spec) {
    this._steps.push({ op: 'group', v: spec });
    return this;
  }
  sort(spec) {
    this._steps.push({ op: 'sort', v: spec });
    return this;
  }
  project(spec) {
    this._steps.push({ op: 'project', v: spec });
    return this;
  }
  lookup(spec) {
    this._steps.push({ op: 'lookup', v: spec });
    return this;
  }
  unwind(field) {
    this._steps.push({ op: 'unwind', v: field });
    return this;
  }
  sample(spec) {
    this._steps.push({ op: 'sample', v: spec });
    return this;
  }
  replaceRoot(spec) {
    this._steps.push({ op: 'replaceRoot', v: spec });
    return this;
  }
  skip(n) {
    this._steps.push({ op: 'skip', v: Number(n) || 0 });
    return this;
  }
  limit(n) {
    this._steps.push({ op: 'limit', v: Number(n) || 0 });
    return this;
  }
  count(fieldName) {
    this._steps.push({ op: 'count', v: fieldName || 'count' });
    return this;
  }
  end() {
    return this._run();
  }

  /** 解析聚合表达式：'$FIELD' 取文档字段，AggOp 求值，其他原样 */
  _evalExpr(expr, doc) {
    if (typeof expr === 'string' && expr.startsWith('$')) return getField(doc, expr.slice(1));
    if (isAggOp(expr)) {
      const field = expr.__aggVal;
      const val = typeof field === 'string' && field.startsWith('$')
        ? getField(doc, field.slice(1))
        : field;
      return val;
    }
    if (isPlainObject(expr)) {
      const out = {};
      for (const k of Object.keys(expr)) out[k] = this._evalExpr(expr[k], doc);
      return out;
    }
    return expr;
  }

  _run() {
    this._store.assertExists(this._name);
    let list = this._store.docs(this._name).map((d) => Object.assign({}, d));

    for (const step of this._steps) {
      switch (step.op) {
        case 'match':
          list = list.filter((d) => matchWhere(d, step.v));
          break;

        case 'unwind': {
          const field = typeof step.v === 'string' && step.v.startsWith('$') ? step.v.slice(1) : step.v;
          const out = [];
          for (const d of list) {
            const arr = getField(d, field);
            if (Array.isArray(arr)) {
              if (arr.length === 0) continue; // 与云开发一致：空数组不产出
              for (const item of arr) {
                const copy = Object.assign({}, d);
                if (isPlainObject(item)) {
                  // 对象元素：字段提升到顶层并保留原数组字段为单元素数组
                  Object.assign(copy, item);
                }
                setField(copy, field, item);
                out.push(copy);
              }
            } else {
              out.push(d);
            }
          }
          list = out;
          break;
        }

        case 'lookup': {
          const spec = step.v || {};
          const from = spec.from;
          const localField = spec.localField;
          const foreignField = spec.foreignField;
          const as = spec.as || 'joined';
          const foreign = from ? this._store.docs(from) : [];
          list = list.map((d) => {
            const lv = getField(d, localField);
            const vals = Array.isArray(lv) ? lv : [lv];
            const matched = foreign.filter((f) => {
              const fv = getField(f, foreignField);
              const fvs = Array.isArray(fv) ? fv : [fv];
              return fvs.some((x) => vals.some((y) => deepEq(x, y)));
            });
            const copy = Object.assign({}, d);
            copy[as] = matched.map((m) => Object.assign({}, m));
            return copy;
          });
          break;
        }

        case 'group': {
          const spec = step.v || {};
          const accKeys = Object.keys(spec).filter((k) => k !== '_id');
          const groups = new Map();
          for (const d of list) {
            const idExpr = spec._id;
            let gid;
            if (idExpr === null || idExpr === undefined) gid = null;
            else if (typeof idExpr === 'string') gid = this._evalExpr(idExpr, d);
            else if (isPlainObject(idExpr)) {
              gid = {};
              for (const k of Object.keys(idExpr)) gid[k] = this._evalExpr(idExpr[k], d);
            } else gid = idExpr;

            const key = JSON.stringify(gid === undefined ? null : gid);
            if (!groups.has(key)) {
              const init = { _id: gid === undefined ? null : gid };
              for (const k of accKeys) init[k] = undefined;
              groups.set(key, { doc: init, raw: [] });
            }
            groups.get(key).raw.push(d);
          }

          const outList = [];
          for (const { doc, raw } of groups.values()) {
            for (const k of accKeys) {
              const op = spec[k];
              if (!isAggOp(op)) {
                doc[k] = this._evalExpr(op, raw[0] || {});
                continue;
              }
              const values = raw.map((d) => {
                const f = op.__aggVal;
                if (typeof f === 'string' && f.startsWith('$')) return getField(d, f.slice(1));
                return f;
              });
              doc[k] = reduceAgg(op.__agg, values);
            }
            outList.push(doc);
          }
          list = outList;
          break;
        }

        case 'sort':
          list = applySort(list, step.v);
          break;

        case 'project':
          list = list.map((d) => projectDoc(d, step.v));
          break;

        case 'skip':
          list = list.slice(step.v);
          break;

        case 'limit':
          if (step.v) list = list.slice(0, step.v);
          break;

        case 'sample': {
          const size = Number((step.v && step.v.size) || 0) || 1;
          const pool = list.slice();
          const picked = [];
          for (let i = 0; i < size && pool.length; i++) {
            const idx = Math.floor(Math.random() * pool.length);
            picked.push(pool.splice(idx, 1)[0]);
          }
          list = picked;
          break;
        }

        case 'replaceRoot':
          // 项目里未启用，做最小兼容
          list = list.map((d) => d);
          break;

        case 'count': {
          const field = step.v;
          list = [{ [field]: list.length }];
          break;
        }

        default:
          throw new Error('[mock-db] unknown aggregate step: ' + step.op);
      }
    }

    return { list, errMsg: 'aggregate.end:ok' };
  }
}

function reduceAgg(op, values) {
  const nums = values.filter((v) => typeof v === 'number' && !Number.isNaN(v));
  switch (op) {
    case 'sum': {
      // dbAggr.sum(1) 用于计数
      const allOnes = values.every((v) => v === 1 || v === undefined);
      if (allOnes) return values.filter((v) => v !== undefined).length;
      return nums.reduce((a, b) => a + b, 0);
    }
    case 'avg':
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    case 'max':
      return nums.length ? Math.max(...nums) : 0;
    case 'min':
      return nums.length ? Math.min(...nums) : 0;
    case 'count':
      return values.length;
    case 'first':
      return values[0];
    case 'last':
      return values[values.length - 1];
    case 'push':
      return values;
    case 'addToSet': {
      const out = [];
      for (const v of values) {
        if (!out.some((x) => deepEq(x, v))) out.push(v);
      }
      return out;
    }
    default:
      throw new Error('[mock-db] unknown aggregate operator: ' + op);
  }
}

/* ------------------------------------------------------------------ *
 * Database 门面
 * ------------------------------------------------------------------ */

class Database {
  constructor(store) {
    this._store = store;
    this.command = command;
    this.RegExp = DbRegExp;
  }

  collection(name) {
    if (!name) throw new Error('[mock-db] collection() 需要集合名');
    return new Query(this._store, name);
  }

  async createCollection(name) {
    const created = this._store.create(name);
    return { errMsg: 'createCollection:ok', created };
  }

  serverDate() {
    return new Date();
  }
}

module.exports = {
  Store,
  Database,
  Query,
  Aggregate,
  Command,
  AggOp,
  DbRegExp,
  command,
  aggregate: aggregateNs,
  matchWhere,
  matchCondition,
  deepEq,
  getField,
  setField,
  DATA_DIR,
};
