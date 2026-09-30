module.exports = {
	//### 环境相关 
	CLOUD_ID: 'cloud1-3go08kosfd9d453c', //云服务id ,本地测试环境 

	//### 本地调试模式（无需微信云开发环境即可整站运行）
	// 用法：先启动 node local-dev/server.js，再把下面开关置为 true
	// 关闭后恢复为原生云开发调用，与线上部署完全一致
	LOCAL_DEV: true,
	LOCAL_DEV_URL: 'http://127.0.0.1:3081/mcloud',
	//### 本地调试模式结束

	// #### 版本信息 
	VER: 'build 2023.01.14',
	COMPANY: '联系作者',

	// #### 系统参数 
	IS_SUB: false, //分包模式 
	IS_DEMO: false, //是否演示版  

	MOBILE_CHECK: false, //手机号码是否真实性校验


	//#################     
	IMG_UPLOAD_SIZE: 20, //图片上传大小M兆    

	// #### 缓存相关
	CACHE_IS_LIST: true, //列表是否缓存
	CACHE_LIST_TIME: 60 * 30, //列表缓存时间秒    

}