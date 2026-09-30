@echo off
chcp 65001 >nul
title WeLibAppt 本地云函数服务
cd /d "%~dp0.."
echo.
echo   WeLibAppt 本地云开发模拟服务器
echo   ------------------------------------------------
echo   云函数源码 : %CD%\cloudfunctions\mcloud
echo   数据目录   : %CD%\local-dev\data
echo   调用地址   : http://127.0.0.1:3081/mcloud
echo   ------------------------------------------------
echo   关闭本窗口即停止服务
echo.
node local-dev\server.js
echo.
echo   [!] 服务已退出
pause
