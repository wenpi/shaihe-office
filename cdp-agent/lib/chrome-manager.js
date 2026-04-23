// traffic-engine/cdp-agent/lib/chrome-manager.js
// 两层 fallback 机制：
//   1. 标准 CDP（--remote-debugging-port 启动的 Chrome）→ puppeteer 直连
//   2. 内置 CDP Proxy（自动发现 Chrome，启动内嵌 HTTP 代理）→ proxy 模式
const puppeteer = require('puppeteer-core')
const http = require('http')
const net = require('net')
const fs = require('fs')
const path = require('path')
const os = require('os')

const CDP_PORTS = [9222, 9223, 9224, 9225]
const BUILTIN_PROXY_PORT = 3456

// ─── 内置 CDP Proxy 核心逻辑 ────────────────────────────────────────────────

let _ws = null
let _cmdId = 0
const _pending = new Map()
const _sessions = new Map()
let _chromePort = null
let _chromeWsPath = null
let _connectingPromise = null
let _proxyServer = null

function _checkPort(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, '127.0.0.1')
    const timer = setTimeout(() => { socket.destroy(); resolve(false) }, 2000)
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true) })
    socket.once('error', () => { clearTimeout(timer); resolve(false) })
  })
}

async function _discoverChromePort() {
  const possiblePaths = []
  const platform = os.platform()
  const home = os.homedir()

  if (platform === 'darwin') {
    possiblePaths.push(
      path.join(home, 'Library/Application Support/Google/Chrome/DevToolsActivePort'),
      path.join(home, 'Library/Application Support/Google/Chrome Canary/DevToolsActivePort'),
      path.join(home, 'Library/Application Support/Chromium/DevToolsActivePort'),
    )
  } else if (platform === 'linux') {
    possiblePaths.push(
      path.join(home, '.config/google-chrome/DevToolsActivePort'),
      path.join(home, '.config/chromium/DevToolsActivePort'),
    )
  } else if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || ''
    possiblePaths.push(
      path.join(localAppData, 'Google/Chrome/User Data/DevToolsActivePort'),
      path.join(localAppData, 'Chromium/User Data/DevToolsActivePort'),
    )
  }

  for (const p of possiblePaths) {
    try {
      const content = fs.readFileSync(p, 'utf-8').trim()
      const lines = content.split('\n')
      const port = parseInt(lines[0])
      if (port > 0 && port < 65536) {
        const ok = await _checkPort(port)
        if (ok) {
          const wsPath = lines[1] || null
          return { port, wsPath }
        }
      }
    } catch { }
  }

  for (const port of [9222, 9229, 9333]) {
    if (await _checkPort(port)) return { port, wsPath: null }
  }
  return null
}

async function _fetchWsUrl(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          resolve(json.webSocketDebuggerUrl?.replace('localhost', '127.0.0.1') || null)
        } catch { resolve(null) }
      })
    })
    req.on('error', () => resolve(null))
    req.setTimeout(2000, () => { req.destroy(); resolve(null) })
  })
}

async function _connectWs() {
  if (_ws && _ws.readyState === 1) return
  if (_connectingPromise) return _connectingPromise

  if (!_chromePort) {
    const discovered = await _discoverChromePort()
    if (!discovered) throw new Error('Chrome not found')
    _chromePort = discovered.port
    const liveWsUrl = await _fetchWsUrl(discovered.port)
    if (liveWsUrl) {
      _chromeWsPath = liveWsUrl.replace(/^ws:\/\/127\.0\.0\.1:\d+/, '')
    } else {
      _chromeWsPath = discovered.wsPath
    }
  }

  const wsUrl = _chromeWsPath
    ? `ws://127.0.0.1:${_chromePort}${_chromeWsPath}`
    : `ws://127.0.0.1:${_chromePort}/devtools/browser`

  let WS
  try { WS = require('ws') } catch { WS = globalThis.WebSocket }

  return _connectingPromise = new Promise((resolve, reject) => {
    _ws = new WS(wsUrl)
    const onOpen = () => {
      _connectingPromise = null
      console.log(`[chrome] 内置 CDP Proxy 已连接 Chrome (端口 ${_chromePort})`)
      resolve()
    }
    const onError = (e) => {
      _connectingPromise = null
      _ws = null; _chromePort = null; _chromeWsPath = null
      reject(new Error(e.message || '连接失败'))
    }
    const onClose = () => {
      _ws = null; _chromePort = null; _chromeWsPath = null
      _sessions.clear()
    }
    const onMessage = (evt) => {
      const data = typeof evt === 'string' ? evt : (evt.data || evt)
      const msg = JSON.parse(typeof data === 'string' ? data : data.toString())
      if (msg.method === 'Target.attachedToTarget') {
        _sessions.set(msg.params.targetInfo.targetId, msg.params.sessionId)
      }
      if (msg.id && _pending.has(msg.id)) {
        const { resolve, timer } = _pending.get(msg.id)
        clearTimeout(timer); _pending.delete(msg.id); resolve(msg)
      }
    }
    if (_ws.on) {
      _ws.on('open', onOpen); _ws.on('error', onError)
      _ws.on('close', onClose); _ws.on('message', onMessage)
    } else {
      _ws.addEventListener('open', onOpen); _ws.addEventListener('error', onError)
      _ws.addEventListener('close', onClose); _ws.addEventListener('message', onMessage)
    }
  })
}

function _sendCDP(method, params = {}, sessionId = null) {
  return new Promise((resolve, reject) => {
    if (!_ws || _ws.readyState !== 1) return reject(new Error('WebSocket 未连接'))
    const id = ++_cmdId
    const msg = { id, method, params }
    if (sessionId) msg.sessionId = sessionId
    const timer = setTimeout(() => { _pending.delete(id); reject(new Error('CDP 超时: ' + method)) }, 30000)
    _pending.set(id, { resolve, timer })
    _ws.send(JSON.stringify(msg))
  })
}

async function _ensureSession(targetId) {
  if (_sessions.has(targetId)) return _sessions.get(targetId)
  const resp = await _sendCDP('Target.attachToTarget', { targetId, flatten: true })
  if (resp.result?.sessionId) {
    _sessions.set(targetId, resp.result.sessionId)
    return resp.result.sessionId
  }
  throw new Error('attach 失败')
}

async function _waitForLoad(sessionId, timeoutMs = 15000) {
  await _sendCDP('Page.enable', {}, sessionId)
  return new Promise((resolve) => {
    let done = false
    const finish = (r) => { if (!done) { done = true; clearTimeout(t); clearInterval(iv); resolve(r) } }
    const t = setTimeout(() => finish('timeout'), timeoutMs)
    const iv = setInterval(async () => {
      try {
        const r = await _sendCDP('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, sessionId)
        if (r.result?.result?.value === 'complete') finish('complete')
      } catch { }
    }, 500)
  })
}

async function _readBody(req) {
  let body = ''
  for await (const chunk of req) body += chunk
  return body
}

async function _startBuiltinProxy() {
  // 检查端口是否已被占用
  const portFree = await new Promise((resolve) => {
    const s = net.createServer()
    s.once('error', () => resolve(false))
    s.once('listening', () => { s.close(); resolve(true) })
    s.listen(BUILTIN_PROXY_PORT, '127.0.0.1')
  })

  if (!portFree) {
    // 已有 proxy 在运行，直接复用
    console.log(`[chrome] 端口 ${BUILTIN_PROXY_PORT} 已有 CDP Proxy，复用`)
    return true
  }

  await _connectWs()

  _proxyServer = http.createServer(async (req, res) => {
    const parsed = new URL(req.url, `http://localhost:${BUILTIN_PROXY_PORT}`)
    const pathname = parsed.pathname
    const q = Object.fromEntries(parsed.searchParams)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')

    try {
      if (pathname === '/health') {
        const connected = _ws && _ws.readyState === 1
        res.end(JSON.stringify({ status: 'ok', connected, sessions: _sessions.size, chromePort: _chromePort }))
        return
      }

      await _connectWs()

      if (pathname === '/targets') {
        const resp = await _sendCDP('Target.getTargets')
        res.end(JSON.stringify(resp.result.targetInfos.filter(t => t.type === 'page')))
      } else if (pathname === '/new') {
        const targetUrl = q.url || 'about:blank'
        const resp = await _sendCDP('Target.createTarget', { url: targetUrl, background: true })
        const targetId = resp.result.targetId
        if (targetUrl !== 'about:blank') {
          try { const sid = await _ensureSession(targetId); await _waitForLoad(sid) } catch { }
        }
        res.end(JSON.stringify({ targetId }))
      } else if (pathname === '/close') {
        await _sendCDP('Target.closeTarget', { targetId: q.target })
        _sessions.delete(q.target)
        res.end(JSON.stringify({ ok: true }))
      } else if (pathname === '/navigate') {
        const sid = await _ensureSession(q.target)
        await _sendCDP('Page.navigate', { url: q.url }, sid)
        await _waitForLoad(sid)
        res.end(JSON.stringify({ ok: true }))
      } else if (pathname === '/back') {
        const sid = await _ensureSession(q.target)
        await _sendCDP('Runtime.evaluate', { expression: 'history.back()' }, sid)
        await _waitForLoad(sid)
        res.end(JSON.stringify({ ok: true }))
      } else if (pathname === '/eval') {
        const sid = await _ensureSession(q.target)
        const body = await _readBody(req)
        const resp = await _sendCDP('Runtime.evaluate', { expression: body || 'document.title', returnByValue: true, awaitPromise: true }, sid)
        if (resp.result?.result?.value !== undefined) {
          res.end(JSON.stringify({ value: resp.result.result.value }))
        } else if (resp.result?.exceptionDetails) {
          res.statusCode = 400; res.end(JSON.stringify({ error: resp.result.exceptionDetails.text }))
        } else {
          res.end(JSON.stringify(resp.result))
        }
      } else if (pathname === '/click') {
        const sid = await _ensureSession(q.target)
        const selector = await _readBody(req)
        const js = `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return { error: 'not found' }; el.scrollIntoView({ block: 'center' }); el.click(); return { clicked: true } })()`
        const resp = await _sendCDP('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true }, sid)
        res.end(JSON.stringify(resp.result?.result?.value || resp.result))
      } else if (pathname === '/scroll') {
        const sid = await _ensureSession(q.target)
        const y = parseInt(q.y || '3000')
        const dir = q.direction || 'down'
        const js = dir === 'bottom' ? 'window.scrollTo(0, document.body.scrollHeight)' :
          dir === 'top' ? 'window.scrollTo(0, 0)' :
            dir === 'up' ? `window.scrollBy(0, -${Math.abs(y)})` : `window.scrollBy(0, ${Math.abs(y)})`
        await _sendCDP('Runtime.evaluate', { expression: js, returnByValue: true }, sid)
        await new Promise(r => setTimeout(r, 800))
        res.end(JSON.stringify({ ok: true }))
      } else if (pathname === '/info') {
        const sid = await _ensureSession(q.target)
        const resp = await _sendCDP('Runtime.evaluate', {
          expression: 'JSON.stringify({title: document.title, url: location.href, ready: document.readyState})',
          returnByValue: true,
        }, sid)
        res.end(resp.result?.result?.value || '{}')
      } else if (pathname === '/screenshot') {
        const sid = await _ensureSession(q.target)
        const resp = await _sendCDP('Page.captureScreenshot', { format: 'png' }, sid)
        if (q.file) {
          fs.writeFileSync(q.file, Buffer.from(resp.result.data, 'base64'))
          res.end(JSON.stringify({ saved: q.file }))
        } else {
          res.setHeader('Content-Type', 'image/png')
          res.end(Buffer.from(resp.result.data, 'base64'))
        }
      } else {
        res.statusCode = 404; res.end(JSON.stringify({ error: '未知端点' }))
      }
    } catch (e) {
      res.statusCode = 500; res.end(JSON.stringify({ error: e.message }))
    }
  })

  await new Promise((resolve) => _proxyServer.listen(BUILTIN_PROXY_PORT, '127.0.0.1', resolve))
  console.log(`[chrome] 内置 CDP Proxy 已启动 (http://localhost:${BUILTIN_PROXY_PORT})`)
  return true
}

// ─── 两层 Fallback ───────────────────────────────────────────────────────────

async function tryStandardCDP() {
  for (const port of CDP_PORTS) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })
      if (res.ok) {
        console.log(`[chrome] standard CDP on port ${port}`)
        const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` })
        return { mode: 'puppeteer', browser, port }
      }
    } catch { }
  }
  return null
}

async function tryBuiltinProxy() {
  try {
    await _startBuiltinProxy()
    console.log('[chrome] 已连接 (builtin proxy mode)')
    return { mode: 'proxy', proxyUrl: `http://127.0.0.1:${BUILTIN_PROXY_PORT}` }
  } catch (e) {
    console.log('[chrome] 内置 CDP Proxy 启动失败:', e.message)
    return null
  }
}

async function connectChrome() {
  const std = await tryStandardCDP()
  if (std) return std

  const proxy = await tryBuiltinProxy()
  if (proxy) return proxy

  throw new Error('浏览器未找到。请确保 Chrome 已开启远程调试（chrome://inspect → Remote debugging）')
}

module.exports = { connectChrome }
