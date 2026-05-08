@echo off
REM CDP Agent Chrome 启动脚本 (Windows)
REM 用法: start-chrome.bat

echo 关闭现有 Chrome...
taskkill /F /IM chrome.exe 2>nul
timeout /t 2 /nobreak >nul

REM 用户数据目录（保留登录状态）
set USER_DATA_DIR=%LOCALAPPDATA%\Google\Chrome\User Data

echo 启动 Chrome（远程调试模式）...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir="%USER_DATA_DIR%" ^
  --disable-blink-features=AutomationControlled

echo.
echo Chrome 已启动（远程调试端口 9222）
echo 请手动登录小红书，然后启动 CDP Agent
pause
