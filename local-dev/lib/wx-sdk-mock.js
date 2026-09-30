'use strict';
/**
 * wx-sdk-mock.js —— `wx-server-sdk` 的本地实现
 *
 * 让 cloudfunctions/mcloud 的业务代码可以原封不动地跑在 Node 本地：
 *   cloud.init / database / getWXContext / logger / uploadFile / downloadFile
 *   deleteFile / getTempFileURL / getOpenData / DYNAMIC_CURRENT_ENV
 *
 * 请求级上下文（OPENID / APPID / CLIENTIP）通过 AsyncLocalStorage 传递，
 * 并发请求之间互不串号。
 */

const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { Store, Database } = require('./mock-db.js');

const ENV = {
  /** 本地开发用的默认身份，可用环境变量覆盖 */
  OPENID: process.env.LOCAL_OPENID || 'local-openid-user-0001',
  ADMIN_OPENID: process.env.LOCAL_ADMIN_OPENID || 'local-openid-admin-0001',
  APPID: process.env.LOCAL_APPID || 'wxlocal0000000000',
  UNIONID: process.env.LOCAL_UNIONID || 'local-unionid-0001',
  CLIENTIP: process.env.LOCAL_CLIENTIP || '127.0.0.1',
};

const UPLOAD_DIR = path.join(__dirname, '..', 'data', '_files');

const ctx = new AsyncLocalStorage();
const store = new Store();
const database = new Database(store);

/** 当前请求上下文（无请求时回落到默认身份） */
function currentContext() {
  return ctx.getStore() || ENV;
}

function init(options) {
  if (options && options.env) initOptions.env = options.env;
  return module.exports;
}

const initOptions = { env: 'local-env' };

function databaseApi() {
  return database;
}

function getWXContext() {
  const c = currentContext();
  return {
    OPENID: c.OPENID,
    APPID: c.APPID || ENV.APPID,
    UNIONID: c.UNIONID || ENV.UNIONID,
    CLIENTIP: c.CLIENTIP || ENV.CLIENTIP,
    ENV: initOptions.env,
    SOURCE: 'local-mock',
  };
}

function logger() {
  const wrap = (level) => (payload) => {
    const time = new Date().toISOString();
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    process.stdout.write(`[cloud-logger:${level}] ${time} ${body}\n`);
  };
  return {
    log: wrap('log'),
    info: wrap('info'),
    warn: wrap('warn'),
    error: wrap('error'),
    debug: wrap('debug'),
  };
}

async function uploadFile({ cloudPath, fileContent, filePath }) {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const target = path.join(UPLOAD_DIR, cloudPath.replace(/[\\/]+/g, '_'));
  const buf = fileContent ? Buffer.from(fileContent) : fs.readFileSync(filePath);
  fs.writeFileSync(target, buf);
  const fileID = 'cloud://' + initOptions.env + '.' + cloudPath;
  return { fileID, statusCode: 200, errMsg: 'uploadFile:ok' };
}

async function downloadFile({ fileID }) {
  const name = String(fileID || '').split('/').pop();
  const file = path.join(UPLOAD_DIR, name.replace(/[\\/]+/g, '_'));
  if (!fs.existsSync(file)) throw new Error('文件不存在: ' + fileID);
  return { fileContent: fs.readFileSync(file), statusCode: 200, errMsg: 'downloadFile:ok' };
}

async function deleteFile({ fileList }) {
  const list = (fileList || []).map((fileID) => {
    const name = String(fileID).split('/').pop().replace(/[\\/]+/g, '_');
    const file = path.join(UPLOAD_DIR, name);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return { fileID, status: 0, errMsg: 'ok' };
  });
  return { fileList: list, errMsg: 'deleteFile:ok' };
}

async function getTempFileURL({ fileList }) {
  const list = (fileList || []).map((fileID) => ({
    fileID,
    tempFileURL: 'http://127.0.0.1:' + (process.env.LOCAL_PORT || 3081) + '/file/' + encodeURIComponent(String(fileID).split('/').pop()),
    maxAge: 7200,
    status: 0,
    errMsg: 'ok',
  }));
  return { fileList: list, errMsg: 'getTempFileURL:ok' };
}

async function getOpenData() {
  return { dataList: [] };
}

/**
 * openapi 的本地实现
 * 订阅消息在本地没有真实通道，这里做落日志 + 返回成功，
 * 让业务链路（扣减次数、记录发送结果）能完整跑通。
 */
const openapi = {
  subscribeMessage: {
    send: async (opts) => {
      const { touser, templateId, page, data } = opts || {};
      process.stdout.write(
        '[mock-openapi] subscribeMessage.send => touser=' + touser +
        ' templateId=' + templateId +
        ' page=' + (page || '') +
        ' data=' + JSON.stringify(data || {}) + '\n'
      );
      return { errCode: 0, errMsg: 'openapi.subscribeMessage.send:ok' };
    },
  },
  wxacode: {
    getUnlimited: async () => {
      const err = new Error('本地环境不支持生成小程序码');
      err.errCode = -1;
      throw err;
    },
  },
};

/** 自定义导出（非 wx 官方 API）：用于本地测试脚本注入身份 */
function __withContext(identity, fn) {
  return ctx.run(Object.assign({}, ENV, identity), fn);
}

function __store() {
  return store;
}

module.exports = {
  DYNAMIC_CURRENT_ENV: 'local-env',
  init,
  database: databaseApi,
  getWXContext,
  logger,
  uploadFile,
  downloadFile,
  deleteFile,
  getTempFileURL,
  getOpenData,
  openapi,
  // 本地扩展
  __env: ENV,
  __withContext,
  __store,
  __database: database,
};
