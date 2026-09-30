'use strict';
/**
 * server.js —— WeLibAppt 本地云开发模拟服务器
 *
 * 作用：不改动 cloudfunctions/mcloud 一行业务代码，在本地 Node 里执行真实云函数逻辑。
 *   1. 拦截 `require('wx-server-sdk')`，重定向到 lib/wx-sdk-mock.js
 *   2. 直接加载 framework/core/application.js（真实入口）
 *   3. 用 HTTP 暴露 /mcloud，参数与 wx.cloud.callFunction({name:'mcloud', data}) 完全一致
 *
 * 启动：node local-dev/server.js  （或 npm run dev:local）
 * 默认端口 3081，可用环境变量 LOCAL_PORT 覆盖。
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const Module = require('module');

const sdkMock = require('./lib/wx-sdk-mock.js');

/* ---------- 1. require 拦截：wx-server-sdk -> 本地实现 ---------- */
const CLOUD_FN_DIR = path.join(__dirname, '..', 'cloudfunctions', 'mcloud');
const BUILTINS = new Set(Module.builtinModules);

// 微信云函数运行时会把云函数根目录加入模块搜索路径，
// 因此源码里存在 require('project/meetlib/public/route.js') 这类裸路径。
// 这里复刻该行为：标准解析失败时回落到云函数根目录。
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (
    typeof request === 'string' &&
    !request.startsWith('.') &&
    !path.isAbsolute(request) &&
    !request.startsWith('node:') &&
    !BUILTINS.has(request) &&
    request !== 'wx-server-sdk'
  ) {
    try {
      return originalResolve.call(this, request, parent, isMain, options);
    } catch (err) {
      const candidate = path.join(CLOUD_FN_DIR, request);
      if (fs.existsSync(candidate) || fs.existsSync(candidate + '.js')) {
        return originalResolve.call(this, candidate, parent, isMain, options);
      }
      throw err;
    }
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return sdkMock;
  return originalLoad.apply(this, arguments);
};

/* ---------- 2. 加载真实云函数入口 ---------- */
const application = require(path.join(CLOUD_FN_DIR, 'framework', 'core', 'application.js'));

const PORT = Number(process.env.LOCAL_PORT || 3081);
const HOST = process.env.LOCAL_HOST || '127.0.0.1';

/* ---------- 3. 身份池：模拟不同 openid 的多个用户 ---------- */
const IDENTITIES = {
  user: {
    OPENID: process.env.LOCAL_OPENID || 'local-openid-user-0001',
    APPID: process.env.LOCAL_APPID || 'wxlocal0000000000',
    UNIONID: process.env.LOCAL_UNIONID || 'local-unionid-0001',
    CLIENTIP: '127.0.0.1',
  },
  admin: {
    OPENID: process.env.LOCAL_ADMIN_OPENID || 'local-openid-admin-0001',
    APPID: process.env.LOCAL_APPID || 'wxlocal0000000000',
    UNIONID: 'local-unionid-admin-0001',
    CLIENTIP: '127.0.0.1',
  },
};

function pickIdentity(body) {
  if (body && body.openid) {
    return Object.assign({}, IDENTITIES.user, { OPENID: body.openid });
  }
  const who = (body && body.as) || 'user';
  return IDENTITIES[who] || IDENTITIES.user;
}

/* ---------- 4. 请求处理 ---------- */
async function invokeCloudFunction(body) {
  const event = {
    route: body.route,
    token: body.token || '',
    PID: body.PID || 'meetlib',
    params: body.params || {},
  };
  const identity = pickIdentity(body);

  const started = Date.now();
  const result = await sdkMock.__withContext(identity, async () => {
    return await application.app(event, {});
  });
  const cost = Date.now() - started;

  return { result, cost, openid: identity.OPENID };
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 20 * 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const HELP = `WeLibAppt 本地云开发模拟服务器

POST /mcloud      调用云函数（等价 wx.cloud.callFunction）
   body: { "route": "home/list", "PID": "meetlib", "token": "", "params": {}, "as": "user"|"admin" }
   例:   curl -X POST http://127.0.0.1:${PORT}/mcloud -H "Content-Type: application/json" \\
           -d '{"route":"home/list","PID":"meetlib","params":{"page":1,"size":5}}'

GET  /health      健康检查
GET  /collections 列出本地已存在的集合
GET  /routes      列出云函数路由表
`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + HOST);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    });
    res.end();
    return;
  }

  try {
    if (req.method === 'POST' && url.pathname === '/mcloud') {
      const raw = await readBody(req);
      let body;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch (err) {
        sendJson(res, 400, { code: 400, msg: '请求体不是合法 JSON', data: null });
        return;
      }
      if (!body.route) {
        sendJson(res, 400, { code: 400, msg: '缺少 route 参数', data: null });
        return;
      }
      const { result, cost, openid } = await invokeCloudFunction(body);
      process.stdout.write(
        `[local-mcloud] ${body.route} openid=${openid} as=${body.as || 'user'} ${cost}ms code=${result && result.code}\n`
      );
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        port: PORT,
        cloudFn: CLOUD_FN_DIR,
        collections: sdkMock.__store().listCollections(),
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/collections') {
      const store = sdkMock.__store();
      sendJson(res, 200, {
        collections: store.listCollections().map((name) => ({
          name,
          count: store.docs(name).length,
        })),
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/routes') {
      const routes = require(path.join(CLOUD_FN_DIR, 'project', 'meetlib', 'public', 'route.js'));
      sendJson(res, 200, { routes: Object.keys(routes).sort() });
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/file/')) {
      const name = decodeURIComponent(url.pathname.slice('/file/'.length));
      const dir = path.join(__dirname, 'data', '_files');
      let target = null;

      if (fs.existsSync(dir) && name && name.indexOf('..') < 0) {
        const exact = path.join(dir, name);
        if (fs.existsSync(exact)) {
          target = exact;
        } else {
          // 云存储的 fileID 尾段与落盘名不一定完全一致，按后缀兜底匹配
          const hit = fs.readdirSync(dir).find((f) => f.endsWith(name) || f.endsWith('_' + name));
          if (hit) target = path.join(dir, hit);
        }
      }

      if (!target) {
        sendJson(res, 404, { code: 404, msg: '文件不存在: ' + name });
        return;
      }

      const buf = fs.readFileSync(target);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Length': buf.length,
        'Access-Control-Allow-Origin': '*',
      });
      res.end(buf);
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/help')) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(HELP);
      return;
    }

    sendJson(res, 404, { code: 404, msg: 'Not Found: ' + url.pathname });
  } catch (err) {
    process.stderr.write('[local-mcloud] ERROR ' + (err && err.stack ? err.stack : err) + '\n');
    sendJson(res, 500, { code: 500, msg: String(err && err.message), data: null });
  }
});

server.listen(PORT, HOST, () => {
  const dataDir = path.join(__dirname, 'data');
  process.stdout.write(
    '\n' +
      '  WeLibAppt 本地云开发模拟服务器已启动\n' +
      '  ------------------------------------------------\n' +
      '  调用地址 : http://' + HOST + ':' + PORT + '/mcloud\n' +
      '  健康检查 : http://' + HOST + ':' + PORT + '/health\n' +
      '  云函数源 : ' + CLOUD_FN_DIR + '\n' +
      '  数据目录 : ' + dataDir + '\n' +
      '  ------------------------------------------------\n' +
      '  小程序端请在 miniprogram/setting/setting.js 里开启 LOCAL_DEV\n\n'
  );
});

process.on('SIGINT', () => {
  process.stdout.write('\n[local-mcloud] 正在退出...\n');
  server.close(() => process.exit(0));
});

module.exports = { server, invokeCloudFunction };
