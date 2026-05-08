# CDP Agent Stealth 模式使用指南

## 三层 Fallback 机制

CDP Agent 会按以下顺序尝试连接浏览器：

1. **标准 CDP**：连接用户手动启动的 Chrome（`--remote-debugging-port=9222`）
2. **CDP Proxy**：连接 Claude Code 的 CDP Proxy（端口 3456）
3. **Puppeteer + Stealth**：自动启动隐藏自动化特征的 Chrome

## Stealth 模式特性

### 反检测措施
- ✅ 移除 `navigator.webdriver` 标志
- ✅ 禁用 `AutomationControlled` 特征
- ✅ 伪造 Chrome 插件列表
- ✅ 修复 WebGL、Canvas 指纹
- ✅ 隐藏 Headless Chrome 特征
- ✅ 模拟真实用户行为

### 启动参数
```javascript
--disable-blink-features=AutomationControlled
--disable-dev-shm-usage
--no-sandbox
--disable-setuid-sandbox
--disable-web-security
--disable-features=IsolateOrigins,site-per-process
--window-size=1280,800
```

## 使用流程

### 1. 启动 CDP Agent
```bash
cd /Users/wenpi/seomachine/traffic-engine/cdp-agent
echo "fa3452368015c5efc25c97402e8a0d35" | CDP_SERVER_URL=wss://user.aiseo114.com/api/cdp-agent node cdp-agent.js
```

### 2. 手动登录小红书
- CDP Agent 会自动打开 Chrome 浏览器
- 在浏览器中访问 https://www.xiaohongshu.com
- 手动登录你的账号
- 登录成功后，CDP Agent 会自动检测并执行任务

### 3. 发送采集任务
在飞书发送：
```
/worker hack 扫描 小红书营销顾问
```

或通过服务器 API：
```python
import dispatcher
task = dispatcher.create_task(
    'growth_hacker',
    'xhs_scan_comments',
    {'keyword': '小红书营销顾问', 'maxNotes': 5, 'maxComments': 20},
    'manual'
)
dispatcher.approve_task(task['id'])
```

## 风控测试

### 测试方法
1. 启动 Stealth 模式
2. 手动登录小红书
3. 执行采集任务（搜索、点击、提取评论）
4. 观察是否触发风控：
   - 验证码
   - 账号限制
   - IP 封禁
   - 行为异常提示

### 风控指标
- ✅ 无验证码：风控通过
- ⚠️  偶尔验证码：可接受
- ❌ 频繁验证码/账号限制：需要优化

## 跨平台支持

### macOS
```bash
executablePath: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

### Windows
```bash
executablePath: C:\Program Files\Google\Chrome\Application\chrome.exe
```

### Linux
```bash
executablePath: /usr/bin/google-chrome
```

## 注意事项

1. **用户数据目录**：Stealth 模式使用临时目录，每次启动都需要重新登录
2. **Cookie 持久化**：未来可以实现 Cookie 导入/导出功能
3. **并发限制**：建议单机只运行一个 CDP Agent 实例
4. **风控策略**：
   - 控制采集频率（每个帖子间隔 2-3 秒）
   - 限制每日采集量
   - 模拟真实用户行为（随机滚动、停留）

## 故障排查

### Chrome 启动失败
```
[chrome] Puppeteer + Stealth 启动失败: ...
```
**解决方案**：检查 Chrome 是否已安装，路径是否正确

### 连接服务器失败
```
[ws] connection error: ...
```
**解决方案**：检查网络连接，确认服务器地址正确

### 任务执行失败
```
[task] 完成失败: ...
```
**解决方案**：查看详细日志，检查小红书是否已登录
