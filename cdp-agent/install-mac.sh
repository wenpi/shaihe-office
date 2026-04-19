#!/bin/bash
# CDP Agent 一键安装脚本 (macOS)
# 用法: curl -sL https://your-domain/install.sh | bash

set -e

CDN_BASE="https://raw.githubusercontent.com/wenpi/shaihe-office/main/cdp-agent"
INSTALL_DIR="$HOME/.cdp-agent"
PLIST_PATH="$HOME/Library/LaunchAgents/com.cdp-agent.plist"
SERVER_URL="wss://user.aiseo114.com/api/cdp-agent"
REGISTER_URL="https://user.aiseo114.com/api/cdp-agents"

echo ""
echo "  CDP Agent 安装程序"
echo "  ===================="
echo ""

# 1. 检查 Node.js
if ! command -v node &>/dev/null; then
  echo "[!] 未检测到 Node.js，正在安装..."
  if command -v brew &>/dev/null; then
    brew install node
  else
    echo "[!] 请先安装 Node.js: https://nodejs.org/"
    exit 1
  fi
fi
echo "[✓] Node.js $(node -v)"

# 2. 创建安装目录
mkdir -p "$INSTALL_DIR/lib"
echo "[✓] 安装目录: $INSTALL_DIR"

# 3. 下载文件
echo "[↓] 下载 CDP Agent 文件..."
curl -sL "$CDN_BASE/cdp-agent.js" -o "$INSTALL_DIR/cdp-agent.js"
curl -sL "$CDN_BASE/lib/chrome-manager.js" -o "$INSTALL_DIR/lib/chrome-manager.js"
curl -sL "$CDN_BASE/lib/ws-client.js" -o "$INSTALL_DIR/lib/ws-client.js"
curl -sL "$CDN_BASE/lib/task-executor.js" -o "$INSTALL_DIR/lib/task-executor.js"
curl -sL "$CDN_BASE/lib/xhs-tasks.js" -o "$INSTALL_DIR/lib/xhs-tasks.js"
curl -sL "$CDN_BASE/lib/human-behavior.js" -o "$INSTALL_DIR/lib/human-behavior.js"
curl -sL "$CDN_BASE/lib/feishu-auth.js" -o "$INSTALL_DIR/lib/feishu-auth.js"
echo "[✓] 文件下载完成"

# 4. 安装依赖
echo "[↓] 安装依赖..."
cd "$INSTALL_DIR"
cat > package.json << 'PKGJSON'
{
  "name": "cdp-agent",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "puppeteer-core": "^24.0.0",
    "ws": "^8.18.0"
  }
}
PKGJSON
npm install --production --silent 2>/dev/null
echo "[✓] 依赖安装完成"

# 5. 自动注册获取 Token
if [ -f "$INSTALL_DIR/config.json" ]; then
  echo "[✓] 已有 Token 配置"
else
  # 用 macOS 用户名作为 user_id
  USER_ID=$(whoami)
  USER_NAME=$(id -F 2>/dev/null || echo "$USER_ID")
  echo "[↑] 注册 Agent: $USER_NAME ($USER_ID)..."

  RESP=$(curl -s -X PUT "$REGISTER_URL" \
    -H "Content-Type: application/json" \
    -d "{\"user_id\":\"$USER_ID\",\"user_name\":\"$USER_NAME\"}")

  TOKEN=$(echo "$RESP" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

  if [ -z "$TOKEN" ]; then
    echo "[!] 注册失败: $RESP"
    exit 1
  fi

  echo "{\"token\":\"$TOKEN\"}" > "$INSTALL_DIR/config.json"
  chmod 600 "$INSTALL_DIR/config.json"
  echo "[✓] Token 已获取并保存"
fi

# 6. 创建 Chrome 启动脚本（debugging 模式）
CHROME_PLIST="$HOME/Library/LaunchAgents/com.cdp-chrome.plist"
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CHROME_DATA="$INSTALL_DIR/chrome-profile"

cat > "$CHROME_PLIST" << CPLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.cdp-chrome</string>
  <key>ProgramArguments</key>
  <array>
    <string>$CHROME_PATH</string>
    <string>--remote-debugging-port=9222</string>
    <string>--user-data-dir=$CHROME_DATA</string>
    <string>--no-first-run</string>
    <string>--no-default-browser-check</string>
    <string>--disable-blink-features=AutomationControlled</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>
CPLIST

launchctl unload "$CHROME_PLIST" 2>/dev/null || true
launchctl load "$CHROME_PLIST"
echo "[✓] Chrome 已配置为 debugging 模式自启动"

# 等 Chrome 就绪
for i in $(seq 1 15); do
  if curl -s http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
    echo "[✓] Chrome debugging 端口就绪"
    break
  fi
  sleep 1
done

# 7. 创建 CDP Agent launchd 服务（开机自启 + 崩溃重启）
cat > "$PLIST_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.cdp-agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(which node)</string>
    <string>$INSTALL_DIR/cdp-agent.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$INSTALL_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CDP_SERVER_URL</key>
    <string>$SERVER_URL</string>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$INSTALL_DIR/agent.log</string>
  <key>StandardErrorPath</key>
  <string>$INSTALL_DIR/agent.log</string>
</dict>
</plist>
PLIST

# 8. 加载 Agent 服务
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"
echo "[✓] 服务已注册（开机自启 + 崩溃自动重启）"

echo ""
echo "  ✅ CDP Agent 安装完成！"
echo ""
echo "  安装目录: $INSTALL_DIR"
echo "  日志文件: $INSTALL_DIR/agent.log"
echo "  服务状态: launchctl list | grep cdp-agent"
echo ""
echo "  常用命令:"
echo "    查看日志: tail -f ~/.cdp-agent/agent.log"
echo "    停止服务: launchctl unload ~/Library/LaunchAgents/com.cdp-agent.plist"
echo "    启动服务: launchctl load ~/Library/LaunchAgents/com.cdp-agent.plist"
echo "    卸载:     launchctl unload ~/Library/LaunchAgents/com.cdp-chrome.plist"
echo "              launchctl unload ~/Library/LaunchAgents/com.cdp-agent.plist"
echo "              rm -rf ~/.cdp-agent ~/Library/LaunchAgents/com.cdp-*.plist"
echo ""
