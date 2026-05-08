#!/bin/bash
# CDP Agent Chrome 启动脚本（防风控版本）
# 用法: ./start-chrome.sh

# 关闭现有 Chrome
osascript -e 'quit app "Google Chrome"' 2>/dev/null
sleep 2

# 用户数据目录（保留登录状态、浏览历史、插件）
USER_DATA_DIR="$HOME/Library/Application Support/Google/Chrome"

# 启动 Chrome（远程调试模式 + 反检测参数）
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$USER_DATA_DIR" \
  --disable-blink-features=AutomationControlled \
  --exclude-switches=enable-automation \
  --disable-infobars \
  > /dev/null 2>&1 &

echo "✓ Chrome 已启动（远程调试端口 9222）"
echo "✓ 使用真实用户数据目录（保留登录状态）"
echo "✓ 已添加反检测参数"
echo ""
echo "请在 Chrome 中确认小红书已登录，然后启动 CDP Agent："
echo "  cd /Users/wenpi/seomachine/traffic-engine/cdp-agent"
echo "  echo 'fa3452368015c5efc25c97402e8a0d35' | node cdp-agent.js"

