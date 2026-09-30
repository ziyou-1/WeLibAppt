# WeLibAppt 本地部署运行说明

博物馆门票预约小程序（微信小程序 + 云开发）在**本机完整运行**的离线方案。
不依赖微信云开发账号、不需要服务器和域名，云函数业务代码按原样执行。

---

## 一、这套东西是什么

微信小程序云开发项目的代码分两半：`miniprogram`（前端，跑在微信客户端）和 `cloudfunctions/mcloud`（后端，跑在腾讯云）。
官方跑法必须开通云开发环境，本地方案用一层模拟把这半边搬到本机：

```
┌──────────────────────────┐        ┌────────────────────────────────────┐
│ 微信开发者工具模拟器      │        │ local-dev/server.js                │
│  miniprogram/            │        │  ├─ 拦截 require('wx-server-sdk')  │
│   setting.LOCAL_DEV=true │──HTTP─▶│  ├─ 加载真实 application.js        │
│   → wx.request           │ :3081  │  ├─ mock 云数据库（JSON 落盘）      │
└──────────────────────────┘        │  └─ 复用 cloudfunctions/mcloud/**   │
                                    └────────────────────────────────────┘
```

关键点：**云函数业务代码一行没改**。`server.js` 用 `Module._load` 钩子把 `wx-server-sdk`
替换成本地实现，然后直接 `require` 真实的 `framework/core/application.js`。
数据库读写落到 `local-dev/data/*.json`。

---

## 二、快速开始

### 1. 启动本地云函数服务

双击 `local-dev/start.bat`，或命令行：

```bash
cd D:\Desktop\wh\ds\WeLibAppt
node local-dev/server.js
```

看到下面这段就是成功了：

```
  WeLibAppt 本地云开发模拟服务器已启动
  调用地址 : http://127.0.0.1:3081/mcloud
  健康检查 : http://127.0.0.1:3081/health
```

首次收到请求时会自动执行 `initSetup()`：建全部集合、写入默认超管和示例数据。

### 2. 打开小程序

用**微信开发者工具**导入本项目根目录 `D:\Desktop\wh\ds\WeLibAppt`：

- 项目类型：小程序
- AppID：已配置为 `touristappid`（测试号），无需自己的 AppID
- 后端服务：**不用**勾选「微信云开发」

开发工具必须登录微信账号（扫码），这是工具本身的要求。

导入后确认两个开关（项目配置里已设好）：

- 详情 → 本地设置 → **不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书** ✅
- `project.config.json` 中 `setting.urlCheck` 已为 `false`

否则 `wx.request` 请求 `http://127.0.0.1:3081` 会被拦截。

### 3. 开始使用

- 编译（Ctrl+B）后模拟器即显示首页
- 后台管理入口：个人中心 → 管理后台，或直接打开页面
  `projects/meetlib/pages/admin/index/login/admin_login`
- 默认超管账号：**admin** / **123456**

---

## 三、目录结构

```
local-dev/
├── server.js              入口：HTTP 服务 + require 钩子 + 身份池
├── start.bat              一键启动
├── lib/
│   ├── wx-sdk-mock.js     wx-server-sdk 本地实现（含请求级身份上下文）
│   └── mock-db.js         云数据库模拟引擎（查询/聚合/命令操作符）
├── test/
│   └── call.js            命令行调用云函数（调接口、排错用）
└── data/                  数据落盘目录（一个集合一个 JSON 文件）
    ├── bx_admin.json
    ├── bx_meet.json
    ├── bx_join.json
    └── ...
```

小程序端的改动（均已做成开关，不影响原云开发逻辑）：

| 文件 | 改动 |
| --- | --- |
| `miniprogram/setting/setting.js` | 新增 `LOCAL_DEV` / `LOCAL_DEV_URL` 开关 |
| `miniprogram/helper/cloud_helper.js` | `callCloud` 增加本地分支；图片相关跳过云存储 |
| `miniprogram/app.js` | 本地模式下跳过 `wx.cloud.init` |
| `project.config.json` | `appid` 改为 `touristappid`，原值为 `wxb100b44af794708e` |

---

## 四、命令行调接口（排错用）

服务跑起来后，可以不打开开发工具直接验证后端：

```bash
# 首页数据
node local-dev/test/call.js home/list --page=1 --size=5

# 门票/活动列表
node local-dev/test/call.js meet/list --page=1 --size=5

# 管理员登录（拿 token）
node local-dev/test/call.js admin/login --as=admin --name=admin --pwd=123456

# 带 token 调后台接口
node local-dev/test/call.js admin/meet_list --as=admin --token=<上一步的token> --page=1 --size=5
node local-dev/test/call.js admin/user_list --as=admin --token=<token> --page=1 --size=5
```

其他可用命令：

```bash
curl http://127.0.0.1:3081/health        # 健康检查 + 集合列表
curl http://127.0.0.1:3081/collections   # 各集合文档数
curl http://127.0.0.1:3081/routes        # 全部云函数路由
```

`--as=admin` 会切换到 `local-openid-admin-0001`，`--openid=xxx` 可指定任意身份，
用来模拟多用户（例如验证「同一时段余票扣减」「一人多单」）。

---

## 五、切换回真实微信云开发

本地方案只是调试用。要正式上线：

1. `miniprogram/setting/setting.js` → `LOCAL_DEV: false`
2. `project.config.json` → `appid` 改成你自己的小程序 AppID（测试号不支持云开发）
3. 微信开发者工具中开通云开发，创建环境，复制环境 ID
4. 填入两处：
   - `miniprogram/setting/setting.js` 的 `CLOUD_ID`
   - `cloudfunctions/mcloud/config/config.js` 的 `CLOUD_ID`
5. 右键 `cloudfunctions/mcloud` → 上传并部署（云端安装依赖）
6. 云端配置：内存 256M、超时 60 秒、环境变量 `TZ=Asia/Shanghai`
7. 编译运行，首次调用会自动初始化数据库

---

## 六、已知限制

- **图片上传**：本地模式下跳过云存储，使用临时路径，重启开发工具后图片可能失效。需要持久化就走真实云开发。
- **内容安全校验**：`wx.serviceMarket` 图像审核接口本地不可用；`config.js` 中两项校验开关默认已是 `false`，不影响功能。
- **小程序码 / 签到码生成**：依赖 `cloud.openapi`（`admin/setup_qr`、`admin/self_checkin_qr` 路由），本地无法生成。
- **订阅消息推送**：`msg_service.js` 依赖真实云环境，本地不生效。
- **数据非并发安全**：本地 JSON 存储是单进程读写，仅用于开发调试，不做高并发防超卖验证。
- `node-xlsx` 的 Excel 导出走本地依赖，可正常出文件，但需要开发工具的文件系统权限。

---

## 七、故障排查

### IDE 打开的是别的项目，不是本项目（已查明）

**症状**：命令行传 `-o <项目路径>` 启动 IDE，打开的却是上次的项目（例如 `wx-service-app`）。

**根因（实测确认）**：

1. 这个版本的微信开发者工具**不认** `-o` / `--open` 启动参数（实测 `MD5(项目路径)` 对应的缓存目录始终不生成）。
2. IDE 的"当前项目"由 **Electron 主进程**的 localStorage 决定：
   `C:\Users\Administrator\AppData\Roaming\微信开发者工具\Local Storage\leveldb\`
3. `D:\微信开发者工具\User Data\<hash>\WeappLocalData\` 下的
   `localstorage_<MD5(key)>.json` 只是**模拟器层**的副本，改它会在下次启动时被主进程覆盖。

顺带查清的编码规则（便于排查）：`WeappLocalData` 下的文件名 = `MD5(key)`，
对照表在 `hash_key_map_2.json`，关键键位：

| 键 | 含义 |
| --- | --- |
| `last_select` | 启动时打开的项目 |
| `last_all_projects` | 最近项目列表 |
| `reduxPersist:projectList` | 项目元信息字典（appId / 路径 / 名称） |
| `project2_<项目路径>` | 该项目的 IDE 配置与状态 |
| `toolbar_<项目路径>` | 模拟器设备等工具栏状态 |

**正确做法**：不要靠命令行参数，用 IDE 界面导入：

`项目 → 导入项目`（或在项目列表页点 `+`），目录选 `D:\Desktop\wh\ds\WeLibAppt`。

**想让我后续全自动操作 IDE**：在 IDE 里打开
`设置 → 安全设置 → 服务端口` 并开启。开启后即可用 CLI：

```bash
"D:\ruanjian\weixingongju\微信web开发者工具\cli.bat" open --project "D:\Desktop\wh\ds\WeLibAppt"
```

（未开启时 CLI 一律返回 `IDE service port disabled`，且它要求的 `y` 确认无法通过管道自动完成。）


### 微信开发者工具扫码登录卡住（已在本机修复）

**症状**：登录二维码能显示，扫码后无反应或一直转圈；IDE 几乎没有外部连接。

**根因**：本机运行 v2rayN(xray，监听 `127.0.0.1:10808`)，系统代理指向它。
微信开发者工具的登录走**长连接**，经 HTTP 代理时握手能过、长连接维持不住。
注意用 curl 探测 `mp.weixin.qq.com` 等域名是**正常的**（短请求能被代理转发），
所以「网络通不通」的测试会得出错误结论 —— 必须看 IDE 进程的 TCP 连接数。

**判定方法**：IDE 正常时应有 8~10 条对外 `Established` 连接（腾讯 IPv4 + 多个 `2409:8c1e::` / `240e:e1::` IPv6）。
若只有 0~1 条，即为登录通道未建立。

**修复（本机已应用）**：

1. 启动参数禁用 Chromium 代理 —— 这是关键：

```bash
"D:\ruanjian\weixingongju\微信web开发者工具\微信开发者工具.exe" --no-proxy-server
```

2. 系统代理绕过列表追加微信域名（注册表 `HKCU\...\Internet Settings\ProxyOverride`），
   原值已备份至 `local-dev/_proxy_override_backup.txt`：

```
*.weixin.qq.com;*.qq.com;*.wechat.com;*.weixin.com;*.qpic.cn;*.gtimg.cn;*.qcloud.com
```

3. 开始菜单与桌面快捷方式已自动带上 `--no-proxy-server`，直接点快捷方式启动即可。

**注意本机装了两个微信开发者工具**（版本同为 2.02.0）：

| 路径 | 说明 |
| --- | --- |
| `D:\ruanjian\weixingongju\微信web开发者工具` | 开始菜单指向的，日常使用这个 |
| `C:\Program Files (x86)\Tencent\微信web开发者工具` | 另一个安装，两者同时运行会抢用户数据与端口 |

必须用 D 盘那个，用错了会出现项目打不开、登录态丢失等怪现象。

| 现象 | 处理 |
| --- | --- |
| 小程序弹「无法连接本地服务」 | `server.js` 没启动，或端口被占用（改 `LOCAL_PORT`） |
| 小程序弹「网络故障，请稍后重试」 | 开发者工具未勾选「不校验合法域名」 |
| 接口返回「系统开小差了」 | 看 `server.js` 控制台日志，通常是集合未初始化 |
| 想重置数据 | 停止服务，删除 `local-dev/data/` 下对应 JSON，重启后自动重建 |
| 端口冲突 | `set LOCAL_PORT=3082 && node local-dev/server.js`，同步改 `setting.LOCAL_DEV_URL` |
| 真机预览连不上 | `127.0.0.1` 改为本机局域网 IP，并确保手机与电脑同网段 |

---

## 八、实现说明（关键语义对齐）

为了让真实业务代码跑通，模拟层复刻了几个云开发的关键行为：

- **集合不存在时抛错**（`errCode: -502005`）。项目的 `initSetup()` 正是靠捕获这个异常判断是否需要初始化，静默返回空集合会导致初始化被跳过。
- **裸路径 require**：云函数里存在 `require('project/meetlib/public/route.js')` 这种写法，依赖云运行时的模块搜索路径。`server.js` 在标准解析失败后回落到云函数根目录。
- **操作符体系**：完整实现 `eq/neq/lt/lte/gt/gte/in/nin/and/or/inc/mul` 与 `aggregate` 命名空间（`sum/max/min/addToSet`），以及 `match/group/sort/project/lookup/unwind/sample/skip/limit/count/end` 聚合管线。
- **请求级身份隔离**：`OPENID` / `CLIENTIP` 通过 `AsyncLocalStorage` 传递，并发请求不会串号。

---

# 九、闪抢模块（门店闪购预约）

在原预约体系之外新增的一套开抢时刻驱动的高并发放号能力。

## 数据结构

| 集合 | 作用 |
| --- | --- |
| `bx_rush` | 活动/场次：开抢时间、结束时间、放号总量、单人限购、锁定库存、暂停开关、状态 |
| `bx_rush_code` | **号码池**：放号时预生成 N 个号码文档，防超卖的核心载体 |
| `bx_rush_order` | 预约订单：号码、购买码、核销状态与流水 |

## 防超卖原理（实测 1000 并发抢 100，零超发）

不用"先查余量再扣减"这种有竞态的做法，而是把库存做成**号码池 + CAS**：

1. 放号时预生成 N 个号码文档，每个 `CODE_TAKEN = 0`
2. 抢号 = 用带条件的原子更新占住其中一个：

```js
const updated = await RushCodeModel.edit(
  { _id: cand._id, CODE_TAKEN: 0 },   // 条件：该号仍未占用
  { CODE_TAKEN: 1, CODE_TAKEN_USER: openid, CODE_TAKEN_TIME: now }
);
if (updated === 1) { /* 真正抢到 */ }
```

`where` 同时限定 `_id` 与 `CODE_TAKEN=0`，只有把 0 改成 1 的那一次返回 `updated=1`。
**占住才计数**，因此天然不超发、不重发。落库失败会把号放回池子，避免号被永久占用。

## 1 秒内自动切换原理

不依赖定时器、不依赖长连接（微信云开发跑不了 WebSocket），而是：

1. **状态按时间推导**，不落库：`草稿 → 待开抢 → 进行中 → 已结束` 全部由 `RUSH_START_TIME / RUSH_END_TIME` 与服务器时间算出
2. **校时**：进页先调 `rush/time`，用 `RTT/2` 估出本地与服务端的偏移，之后所有倒计时走服务端时间轴
3. **倒计时归零 → 抢号窗口**：以 300ms 间隔轮询轻量状态接口，拿到 `hasStock=true` 立即点亮按钮并停止轮询
4. **状态接口 O(1)**：余量 = `总量 - 已发放 - 锁定`，只读一个文档、不做聚合，撑得住高频轮询

实测：服务端判定延迟 **8ms**，客户端感知延迟 **10ms**（要求 < 1000ms）。

> 若部署到真实微信云开发，可把轮询升级为 `db.collection('bx_rush').doc(id).watch()` 实时推送，
> 客户端 `rush_detail.js` 的轮询逻辑可原样作为兜底通道保留。

## 接口清单

前台：

```
rush/time     服务端时间（校时）
rush/status   轻量状态（高频轮询：hasStock / left / paused / status）
rush/detail   活动详情（含我的预约）
rush/grab     抢号
rush/my_order 我的预约
```

后台（`admin/` 前缀，需管理员 token）：

```
rush_list / rush_detail / rush_insert / rush_edit / rush_del     活动管理
rush_publish                                                     放号（预生成号码池）
rush_pause / rush_lock / rush_reduce                             暂停放号 / 锁定库存 / 手动扣减
rush_order_list / rush_order_export                              名单与导出
rush_checkin / rush_cancel_checkin / rush_cancel_order           核销 / 撤销 / 取消并回收号码
```

## 前端页面

```
miniprogram/projects/meetlib/pages/rush/detail/rush_detail
```

用开发者工具的**编译模式**直接打开（免加首页入口）：

- 页面：`projects/meetlib/pages/rush/detail/rush_detail`
- 参数：`id=<rushId>`

演示活动 ID 见 `local-dev/data/_demo_rush_id.txt`（2 分钟后开抢，限量 20），
打开后停在页面上即可看到倒计时归零时按钮自动点亮。

## 验证脚本

```bash
# 1000 并发抢 100，断言不超卖 / 不重发 / 不崩溃
node local-dev/test/rush_stress.js <rushId> 1000

# 开抢时刻自动切换的时序验证（断言 < 1 秒）
node local-dev/test/rush_switch.js
```

## 顺手修掉的一个框架 bug

`framework/database/db_util.js` 的 `insertBatch` 原本把 `spArr` 切出的**每批数组**当成单条对象
传给 `collection.add({data: ...})`。微信云开发的 `add()` 只接受单条记录，所以该方法实际从未工作过。
现已改为逐条写入（每批 20 并发），全仓库唯一调用方是闪抢放号，改动无副作用。

---

# 十、角色分级与账号管理

## 背景：原版把这块阉割了

`service/admin/admin_mgr_service.js` 里 `insertMgr / editMgr / delMgr / statusMgr / pwdtMgr / clearLog`
六个方法原本全是 `'该功能暂不开放，如有需要请加作者微信：cclinux0730'` ——
这是成品源码常见的二次收费钩子。现已按需求补全实现。

## 四种角色

| 角色 | `ADMIN_ROLE` | 权限范围 |
| --- | --- | --- |
| 超级管理员 | 1 | 全部，含账号管理与系统设置 |
| 运营 | 2 | 活动管理、库存、名单、核销、导出；不能管账号 |
| 核销员 | 3 | 只能核销 + 查看名单 |
| 只读 | 4 | 只能查看 |

兼容老数据：没有 `ADMIN_ROLE` 字段时按 `ADMIN_TYPE` 推导（=1 视为超管，其余为只读）。

## 权限矩阵（实测 12/12 通过）

| 操作 | 超管 | 运营 | 核销员 | 只读 |
| --- | :-: | :-: | :-: | :-: |
| 查看管理员列表 | ✅ | ❌ | ❌ | ❌ |
| 新建管理员 | ✅ | ❌ | ❌ | ❌ |
| 清空操作日志 | ✅ | ❌ | ❌ | ❌ |
| 查看操作日志 | ✅ | ✅ | ❌ | ❌ |
| 查看活动列表 | ✅ | ✅ | ✅ | ✅ |
| 新建活动 | ✅ | ✅ | ❌ | ❌ |
| 放号 | ✅ | ✅ | ❌ | ❌ |
| 暂停放号 | ✅ | ✅ | ❌ | ❌ |
| 查看预约名单 | ✅ | ✅ | ✅ | ✅ |
| 核销 | ✅ | ✅ | ✅ | ❌ |
| 撤销核销 | ✅ | ✅ | ❌ | ❌ |
| 导出名单 | ✅ | ✅ | ❌ | ✅ |

## 安全保护（均已实测拦截）

- 不能删除自己的账号
- 不能停用自己的账号
- 不能删除 / 停用 / 降级**最后一个启用的超级管理员**

## 关键实现细节

权限点集中定义在 `AdminModel.PERM`，判定用 `AdminModel.can(admin, 'PERM_KEY')`；
校验入口是项目级基类 `BaseProjectAdminController.checkPerm()` / `checkSuper()`。

两处容易踩的坑已经处理：

1. **权限不足要抛 `LOGIC(1600)`，不能用 `ADMIN_ERROR(2401)`** ——
   前端 `cloud_helper` 把 2401 当作"登录失效"并 `reLaunch` 到登录页，
   用 2401 会导致权限不足的人被直接踢出登录，而不是看到提示。
2. `framework/platform/service/base_admin_service.js` 的查询字段原本**没有 `ADMIN_ROLE`**，
   这会让运营/核销员/只读在 `resolveRole` 里全部退化成只读。已补上该字段。

## 新增接口

```
admin/mgr_perms       当前登录管理员的角色与权限集合（供前端按角色渲染按钮）
admin/mgr_reset_pwd   超管重置他人密码
```

同时去掉了 `admin/mgr_*` 与 `admin/log_clear` 路由上的 `#demo` 标记 ——
该标记语义是"演示版禁止操作"，现在功能已真正实现。

## 验证

```bash
node local-dev/test/rush_rbac.js
```

内置四个角色账号（`admin` / `operator01` / `checker01` / `viewer01`），
逐条跑权限矩阵并断言安全保护。

---

# 十一、核销流水 / 订阅消息 / 风控 / 备份

## 核销流水

订单表只存"当前状态"，流水表（`bx_rush_checkin`）存"发生过什么"。
每次核销、撤销核销各落一条，含时间、核销员、设备、购买码、号码、姓名、手机号。

撤核销沿用与抢号同样的**条件更新**做原子校验，避免同一个码被两个核销员同时处理：

```js
await RushOrderModel.edit(
  { _id: orderId, RUSH_ORDER_STATUS: CHECKIN },   // 条件：当前确实是已核销
  { RUSH_ORDER_STATUS: BOOKED, ... }
);
if (updated !== 1) this.AppError('撤销失败，该记录不是已核销状态');
```

> 踩过的坑：流水里一度存的是订单的**业务 ID**（`RUSH_ORDER_ID`），
> 而撤销接口按**主键 `_id`** 定位，导致撤销永远失败。已统一存 `_id`。

## 订阅消息

模板 ID 存在框架自带的 setup 表，三个模板各一个 key：

```
setup: rush_tmpl_start / rush_tmpl_success / rush_tmpl_checkin
```

微信订阅消息是**一次性授权**：每次授权对应一条待发送记录（`bx_rush_subscribe`），
发完即把 `SUB_TIMES` 扣到 0，避免超发。

```
rush/subscribe          用户授权后落记录
admin/rush_tmpl_get     读模板配置
admin/rush_tmpl_set     存模板配置
admin/rush_remind       放号前提醒（给该活动所有订阅者群发）
admin/rush_sub_list     订阅记录
```

本地模拟层为 `cloud.openapi.subscribeMessage.send` 提供了 mock（落日志 + 返回成功），
所以整条链路（扣减次数 → 记录发送结果）在本地也能完整跑通。

## 风控

| 能力 | 实现 |
| --- | --- |
| 黑名单 | `bx_rush_black`，支持 openid / 手机号两个维度，命中直接拒绝抢号 |
| 异常封禁 | 同上，`BLACK_STATUS` 控制生效/解除 |
| 限流阈值 | 可在后台配置 `rush_throttle_ms`（0 = 关闭），默认 300ms |

**风控检查必须排在所有业务校验之前** —— 早期版本排在限购校验之后，
结果被拉黑的账号会先撞上"已达限购上限"，风控提示根本轮不到出现。

```
admin/rush_risk_get / rush_risk_set     读 / 写限流阈值
admin/rush_black_list / _insert / _del  黑名单管理
```

## Excel 导出

用框架的 `exportDataExcel`：`node-xlsx` 生成 xlsx → 上传云存储 → 返回下载链接。

```
admin/rush_order_export     导出预约名单 Excel
admin/rush_checkin_export   导出核销流水 Excel
admin/rush_export_url       取最近一次导出的下载链接
admin/rush_export_del       删除导出文件
```

导出的名单含：号码、购买码、姓名、昵称、手机号、openid、所选时段、状态、预约时间、核销时间、核销员。

## 数据备份

```
admin/rush_data_stats   各表数据量概览
admin/rush_backup       导出业务数据快照（JSON）
```

备份含活动、订单、流水、黑名单与**已占用**的号码（未占用号属于可再生成数据，导出无意义）。

## 验证脚本

```bash
node local-dev/test/full_test.js            # 【综合】接口连通 + 业务闭环 + 边界（41 项）
node local-dev/test/rush_fields.js          # 名单字段 + 时段（13 项）
node local-dev/test/rush_checkin_black.js   # 核销流水 + 风控（18 项）
node local-dev/test/rush_rbac.js            # 角色权限（12 项 + 安全保护）
node local-dev/test/rush_stress.js <id> 1000 # 1000 并发防超卖
node local-dev/test/rush_switch.js          # 开抢自动切换时序
node local-dev/test/static_check.js         # 页面静态自检（绑定/路径/路由/id）
node local-dev/test/class_check.js          # 样式类完整性
node local-dev/test/import_check.js         # wxss @import 路径
node local-dev/test/ui_polish.js --dry      # UI 合规批量修正（试运行）
```

## 测试覆盖（最近一次全量执行结果）

| 套件 | 覆盖内容 | 结果 |
| --- | --- | --- |
| `full_test.js` | 41 条路由无 500；建活动→放号→抢号→核销→撤销→导出→取消回收全链路；未开抢/暂停/锁定/扣减/黑名单/限流/越权等边界 | **41 / 41** |
| `rush_switch.js` | 开抢时刻自动切换时序 | 客户端感知 **13ms** |
| `rush_rbac.js` | 四角色权限矩阵 + 安全保护 | **12 / 12** |
| `rush_fields.js` | 名单七字段与时段 | **13 / 13** |
| `rush_checkin_black.js` | 核销流水 + 黑名单 + 节流 | **18 / 18** |
| `rush_stress.js` | 1000 并发抢 100 | 成功 100、**零超卖零重发** |
| `static_check.js` | 220 个页面文件的绑定/跳转/路由/组件 id | **0 错误** |
| `class_check.js` | 8 个页面 104 个样式类 | **无遗漏** |
| `import_check.js` | 112 个 wxss 的 101 条 import | **全部可解析** |

### 测试抓到的问题（均已修）

**手动扣减与自检口径矛盾**：`adminReduceStock` 占用号码并累加 `RUSH_TAKEN`，
但它是线下预留、本就不产生订单；而自检规则要求「占用数 = 订单数」，导致误报。
现已区分两类占用 —— 号码池的 `CODE_TAKEN_USER` 为 `__ADMIN_REDUCE__` 时计为预留，
自检只比对「因订单产生的占用」与有效订单数。

**自检口径速查**：

| 指标 | 口径 |
| --- | --- |
| `poolTotal` | 号码池文档总数 = `RUSH_TOTAL` |
| `poolTaken` | `CODE_TAKEN=1` 的总数（含预留）= `RUSH_TAKEN` |
| `orderTaken` | `CODE_TAKEN=1` 且占用者非预留标记 |
| `orderCnt` | 订单中未取消的条数 |
| 校验 | `poolTaken == RUSH_TAKEN` 且 `orderTaken == orderCnt` |


---

# 十三、UI 规范

按 `ui-ux-pro-max` 的设计系统建议（**Minimalism & Swiss Style**，
色板「Sky blue + booking orange」）统一了闪抢模块的视觉语言。

## 色板

| 用途 | 值 | 对比度（白底） |
| --- | --- | --- |
| 品牌主色 | `#16475A` | 项目既有主色，保持不变 |
| **CTA / 抢购动作** | `#EA580C` → `#F97316` 渐变 | 4.6:1 |
| 成功（核销/可抢） | `#07C160` / 文字 `#059669` | 3.9:1 / 4.5:1 |
| 危险（取消/删除） | `#DC2626` | 4.5:1 |
| 主文本 | `#1F2937` | 14.7:1 |
| 次文本 | `#4B5563` | 7.4:1 |
| 辅助文本 | `#6B7280` | 5.0:1 |
| 占位/装饰 | `#9CA3AF` | 3.0:1（不得用于正文） |
| 页面底色 | `#F3F5F7` | — |

橙色 CTA 是刻意的选择：抢购是全站唯一需要「立刻点我」的动作，
与主色形成语义区分；其余按钮一律用品牌色或中性灰。

## 修掉的合规问题

审计自己的代码后发现 **8 个文件共 35 处文本对比度不达标**：

| 原色 | 对比度 | 改为 | 新对比度 |
| --- | --- | --- | --- |
| `#888` | 3.5:1 | `#4B5563` | 7.4:1 |
| `#999` / `#aaa` | 2.8:1 / 2.3:1 | `#6B7280` | 5.0:1 |
| `#bbb` | 2.0:1 | `#9CA3AF` | 3.0:1（仅占位符） |
| `#ccc` | 1.6:1 | `#D1D5DB` | 边框色 |

同时把 **9 处触摸目标提到 88rpx（44pt）**：订阅按钮、取消按钮、
列表行动按钮、弹窗按钮、输入框、扫码热区。

> 批量修正用 `ui_polish.js`（只改 `color:` 属性，不碰边框与背景）。

## 视觉提升

`rush_detail` / `rush_index` / `my_rush` / `admin_rush_checkin` /
`admin_rush_list` / `admin_rush_setting` 六个页面的样式重写，要点：

- **倒计时**用等宽数字（`font-variant-numeric: tabular-nums`），
  秒数跳动时宽度不变，避免整行抖动
- **库存卡**加竖向分隔线，三栏信息更清晰
- **列表卡片**按下缩放 0.985、按钮按下缩放 0.97，提供触摸反馈
- **凭证卡**与 CTA 用同色系渐变，视觉上归属同一模块
- 间距统一到 **24 / 32 / 40 / 48rpx**（8rpx 节奏），圆角 24rpx 卡片 / 12rpx 控件 / 999rpx 胶囊

## 样式类完整性检查

`class_check.js` 校验 wxml 里用到的自有类前缀
（`rush-` / `ri-` / `my-` / `ci-` / `rk-` / `st-` / `ro-` / `rr-`）
是否都在对应 wxss 里定义 —— 重写样式后最容易漏类，
而漏类不会报错，只会静默丢样式。当前 8 个页面 104 个类全部有定义。


## 页面静态自检

`static_check.js` 用于在**没有开发者工具**的情况下提前发现问题，覆盖：

1. wxml 里 `bindtap` 等方法，js 中是否存在（排除注释与模板文件）
2. `data-url` 指向的页面文件是否存在
3. `callCloud*('route')` 的云函数路由是否在后端路由表里
4. js 中 `selectComponent('#id')` 的 id 是否真的写在 wxml 上
5. 组件 `route` 属性是否合法、页面是否注册进 `app.json`

它抓出过两个真实问题（都是原作者的遗留 bug）：

- `meet_join_info.wxml` 绑定 `bindtap="url"`，而该页 js 里**没有 `url` 方法** —— 点了会报错，已补上
- 名单页的「撤销核销」传的是业务 ID `RUSH_ORDER_ID` 而非主键 `_id`（本轮修）

同时它也帮助排除了两类**误报**：写在 HTML 注释里的绑定、以及 `*_tpl.wxml`
模板文件（其方法由引入它的页面提供、相对路径从使用方算起）。

## 运营看板

```
admin/rush_dashboard   今日预约/核销、订单状态分布、活动状态、库存水位、核销率
```

入口在后台「闪抢设置 → 运营看板」。返回里还带 `active` 数组
（进行中与待开抢的活动摘要），便于前端做卡片式展示。


---

# 十二、小程序前端页面

六个页面全部对接已实现的后端接口，按项目既有 admin 页面约定编写（`AdminBiz.isAdmin` 鉴权、`pageHelper` 工具集、`cmpt-comm-list` 列表组件），已注册进 `app.json`。

| 页面 | 路径 | 说明 |
| --- | --- | --- |
| **闪抢列表（用户端）** | `pages/rush/index/rush_index` | 活动卡片列表，5 秒静默刷新，状态自动变化 |
| **我的闪抢预约** | `pages/rush/my/my_rush` | 回看购买码与号码，可复制 |
| 用户抢号页 | `pages/rush/detail/rush_detail` | 倒计时 + 开抢自动切换 + 抢号 + 凭证 + **订阅提醒** |
| 活动管理 | `pages/admin/rush/list/admin_rush_list` | 列表 + 创建 + 编辑 + 放号/暂停/锁定/扣减 |
| 购买码核销 | `pages/admin/rush/checkin/admin_rush_checkin` | 输入或扫码核销 + 最近流水 |
| 预约名单 | `pages/admin/rush/order/admin_rush_order` | 七字段展示 + 搜索筛选 + 导出 Excel + 撤销核销 |
| 核销流水 | `pages/admin/rush/record/admin_rush_record` | 按类型筛选 + 导出 Excel |
| 闪抢设置 | `pages/admin/rush/setting/admin_rush_setting` | 风控阈值 + 黑名单 + 订阅模板 + 放号提醒 |

## 首页入口

`pages/default/index/default_index` 新增第 5 个宫格**「限时闪抢」**，
橙色高亮（`.item.flash` 覆盖 nth-child 循环配色），图标用 `flashbuyfill`。

**完整用户链路**：

```
首页「限时闪抢」
  → rush/index 活动列表（静默刷新，待开抢 → 进行中 自动变化）
    → rush/detail 抢号页（本地倒计时，到点自动点亮按钮）
      → 抢号成功，展示号码与购买码
        → 个人中心「我的闪抢预约与购买码」可随时回看
```

**订阅开抢提醒**：详情页在倒计时下方提供订阅按钮。
前端从 `rush/detail` 拿后端下发的模板 ID → `wx.requestSubscribeMessage` 授权 →
授权成功后调 `rush/subscribe` 落一条待发送记录；已订阅过则按钮变为「已订阅」状态。

## 余量口径（排查数据问题时注意）

| 字段 | 口径 |
| --- | --- |
| `RUSH_TOTAL` | 号码池总数（放号总量，由 `adminPublish` 累加） |
| `RUSH_TAKEN` | 已占用号码数（抢号成功 +1，取消回退 -1） |
| `RUSH_LOCK_STOCK` | 锁定不放出数 |
| 可抢余量 | `RUSH_TOTAL - RUSH_TAKEN - RUSH_LOCK_STOCK` |
三者必须与 `bx_rush_code`（号码池）和 `bx_rush_order`（订单）保持一致。
手工清理数据时**务必同时重算这三个计数**，否则会出现「余量显示与实际订单对不上」。

> 踩过的坑：一次清理只清空了订单表却没重置 `RUSH_TAKEN`，导致余量凭空少 1；
> 随后的修正脚本又把 `RUSH_TOTAL` 误算成「已占用数」而非「号码池总数」，把放号量从 20 改成 2。
> 正确做法是按号码池文档数算 `RUSH_TOTAL`、按 `CODE_TAKEN=1` 数算 `RUSH_TAKEN`。

**这两个坑已经工具化，不必再手工修**：

```
admin/rush_check_consistency   一致性自检：逐活动核对计数、号码池、订单三者
admin/rush_fix_consistency     一键修复：按号码池实际占用重新校准计数
```

自检会明确指出「应为多少、当前多少」，修复只动计数、不碰号码与订单。
入口在后台「闪抢设置 → 数据一致性」。

## 用户取消预约

用户抢错或去不了时可自行取消，入口在抢号页凭证区与「我的闪抢预约」列表。

取消走与核销相同的**条件更新**：只有订单当前仍是「已预约」才能改成「已取消」，
已核销的会被拒绝。取消后：

1. 号码回收（`CODE_TAKEN` 置回 0、清空占用者），可被他人重新抢到
2. `RUSH_TAKEN` 回退 1，`RUSH_TAKEN_BACK` 累加 1

```
rush/cancel   用户取消自己的预约（前台）
```

> 又踩了一次同一个坑：`getMyOrder` 最初返回的是 `RUSH_ORDER_ID`（业务ID），
> 而取消接口按主键 `_id` 定位，导致永远找不到订单。
> 与核销流水那次是同一类问题 —— **凡是被后续操作用的 ID，一律用主键 `_id`**。



后台入口建议从「个人中心 → 管理后台」进入后自行跳转，
或在 `admin_home` 里添加快捷入口（当前未加）。


**权限策略**：前端页面只做登录校验（`AdminBiz.isAdmin`），**不在页面上重复实现角色判断** ——
所有写操作由后端 `checkPerm` 按角色拦截并返回「当前角色无权执行此操作」。
这样避免前后端权限逻辑各写一份而产生不一致。

**进入方式**：用开发者工具的**编译模式**直接打开，无需加首页入口。
例如核销页 —— 页面 `projects/meetlib/pages/admin/rush/checkin/admin_rush_checkin`，无参数；
抢号页 —— 页面 `.../rush/detail/rush_detail`，参数 `id=<rushId>`。

**Excel 导出闭环**：页面点导出 → 后端 `node-xlsx` 生成并上传 → `admin/rush_export_url` 取链接 →
`wx.downloadFile` + `wx.openDocument` 直接打开表格；打开失败时自动退化为复制下载链接。

> 本地环境配套：`local-dev/server.js` 新增了 `GET /file/<name>` 路由用于分发导出文件。
> 云存储的 fileID 尾段与落盘名不一定完全一致，该路由做了后缀兜底匹配。




