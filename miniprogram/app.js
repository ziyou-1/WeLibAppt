const setting = require('./setting/setting.js');

App({
	onLaunch: function (options) {

		if (setting.LOCAL_DEV) {
			// 本地调试模式：所有云调用已切换到 local-dev/server.js，无需初始化微信云环境
			console.log('[LOCAL_DEV] 云调用已切换到本地服务: ' + setting.LOCAL_DEV_URL);
		} else if (!wx.cloud) {
			console.error('请使用 2.2.3 或以上的基础库以使用云能力')
		} else {
			wx.cloud.init({
				// env 参数说明：
				//   env 参数决定接下来小程序发起的云开发调用（wx.cloud.xxx）会默认请求到哪个云环境的资源
				//   此处请填入环境 ID, 环境 ID 可打开云控制台查看
				//   如不填则使用默认环境（第一个创建的环境）
				// env: 'my-env-id',
				env: setting.CLOUD_ID,
				traceUser: true,
			})
		}

		this.globalData = {};

		// 用于自定义导航栏
		wx.getSystemInfo({
			success: e => {
					this.globalData.statusBarHeight = e.statusBarHeight;
				let capsule = wx.getMenuButtonBoundingClientRect();
				if (capsule) { 
					this.globalData.customBarHeight = capsule.bottom + capsule.top - e.statusBarHeight;
					this.globalData.capsule = capsule;
				} else {
					this.globalData.customBarHeight = e.statusBarHeight + 50;
				
				} 
			}
		});
	}, 
	 
})