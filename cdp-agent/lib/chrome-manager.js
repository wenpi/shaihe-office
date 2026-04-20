// traffic-engine/cdp-agent/lib/chrome-manager.js
const { execSync, spawn } = require('child_process')
const path = require('path')
const os = require('os')
const puppeteer = require('puppeteer-core')

const PROFILE_DIR = path.join(os.homedir(), '.cdp-agent', 'chrome-profile-v2')
const PORTS = [9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229]

function getChromePath() {
  if (process.platform === 'darwin') {
    const p = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    try { execSync(`test -f "${p}"`); return p } catch {}
  }
  if (process.platform === 'win32') {
    for (const p of ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`]) {
      try { require('fs').accessSync(p); return p } catch {}
    }
  }
  try { return execSync('which google-chrome || which chromium-browser || which chromium').toString().trim() } catch {}
  return null
}

async function findExistingChrome() {
  for (const port of PORTS) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })
      if (res.ok) { console.log(`[chrome] found on port ${port}`); return port }
    } catch {}
  }
  return null
}

async function launchChrome() {
  const chromePath = getChromePath()
  if (!chromePath) throw new Error('Chrome not found')
  console.log(`[chrome] launching on port 9222 (stealth mode)`)
  const args = [
    `--remote-debugging-port=9222`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    // 反检测参数
    '--disable-blink-features=AutomationControlled',
    '--disable-features=AutomationControlled',
    '--disable-infobars',
    '--disable-dev-shm-usage',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--start-maximized',
  ]
  const child = spawn(chromePath, args, { detached: true, stdio: 'ignore' })
  child.unref()
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500))
    try { const res = await fetch('http://127.0.0.1:9222/json/version', { signal: AbortSignal.timeout(1000) }); if (res.ok) return 9222 } catch {}
  }
  throw new Error('Chrome failed to start')
}

async function connectChrome() {
  let port = await findExistingChrome()
  if (!port) {
    console.error('[chrome] 未检测到 Chrome，请先手动打开 Chrome：')
    console.error('  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222')
    throw new Error('Chrome not running with --remote-debugging-port')
  }
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` })
  console.log(`[chrome] connected on port ${port}`)
  // 对所有新页面注入反检测脚本
  browser.on('targetcreated', async (target) => {
    if (target.type() === 'page') {
      try {
        const page = await target.page()
        if (page) await injectStealth(page)
      } catch {}
    }
  })
  // 对已有页面也注入
  const pages = await browser.pages()
  for (const page of pages) {
    try { await injectStealth(page) } catch {}
  }
  return browser
}

async function injectStealth(page) {
  await page.evaluateOnNewDocument(() => {
    // 隐藏 webdriver 标记
    Object.defineProperty(navigator, 'webdriver', { get: () => false })
    // 隐藏 CDP 检测
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol
    // 伪造 plugins（正常浏览器有插件）
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5]
    })
    // 伪造 languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['zh-CN', 'zh', 'en-US', 'en']
    })
    // 隐藏 chrome.runtime（无头模式特征）
    window.chrome = { runtime: {} }
    // 伪造 permissions query
    const origQuery = window.navigator.permissions.query
    window.navigator.permissions.query = (params) =>
      params.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : origQuery(params)
  })
}

module.exports = { connectChrome }
