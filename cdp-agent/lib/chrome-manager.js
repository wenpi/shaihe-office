// traffic-engine/cdp-agent/lib/chrome-manager.js
// 连接已有 Chrome，绝不启动/重启/接管 Chrome
// 支持两种模式：
//   1. 标准 CDP（--remote-debugging-port 启动的 Chrome）→ puppeteer 直连
//   2. CDP Proxy REST API（web-access 的 cdp-proxy）→ HTTP 接口
const puppeteer = require('puppeteer-core')

const CDP_PORTS = [9222, 9223, 9224, 9225]
const PROXY_PORTS = [3456, 3457]

// 尝试标准 CDP 连接（/json/version 可用）
async function tryStandardCDP() {
  for (const port of CDP_PORTS) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })
      if (res.ok) {
        console.log(`[chrome] standard CDP on port ${port}`)
        const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` })
        return { mode: 'puppeteer', browser, port }
      }
    } catch {}
  }
  return null
}

// 尝试 CDP Proxy 连接（/health 可用）
async function tryCDPProxy() {
  for (const port of PROXY_PORTS) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })
      if (res.ok) {
        console.log(`[chrome] CDP Proxy on port ${port}`)
        return { mode: 'proxy', proxyUrl: `http://127.0.0.1:${port}`, port }
      }
    } catch {}
  }
  return null
}

async function connectChrome() {
  // 优先标准 CDP
  const std = await tryStandardCDP()
  if (std) return std

  // fallback CDP Proxy
  const proxy = await tryCDPProxy()
  if (proxy) return proxy

  throw new Error('Chrome not found. 请确保 Chrome 已开启远程调试（chrome://inspect → Remote debugging）')
}

module.exports = { connectChrome }
