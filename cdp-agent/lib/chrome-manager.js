// traffic-engine/cdp-agent/lib/chrome-manager.js
// 只连接已有 Chrome，绝不启动/重启/接管 Chrome
const puppeteer = require('puppeteer-core')

const PORTS = [9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229]

async function findExistingChrome() {
  for (const port of PORTS) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })
      if (res.ok) { console.log(`[chrome] found on port ${port}`); return port }
    } catch {}
  }
  return null
}

async function connectChrome() {
  const port = await findExistingChrome()
  if (!port) {
    throw new Error('Chrome not found. 请确保 Chrome 已以 --remote-debugging-port=9222 方式启动')
  }
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` })
  console.log(`[chrome] connected on port ${port}`)
  return browser
}

module.exports = { connectChrome }
