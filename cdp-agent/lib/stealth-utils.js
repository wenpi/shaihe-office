/**
 * 反爬虫检测工具集
 * 用于绕过小红书等平台的风控系统
 */

// 注入反检测脚本到页面
async function injectStealthScripts(page) {
  await page.evaluateOnNewDocument(() => {
    // 1. 覆盖 webdriver 标识
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
    })

    // 2. 覆盖 Chrome 自动化标识
    window.navigator.chrome = {
      runtime: {},
    }

    // 3. 覆盖 permissions
    const originalQuery = window.navigator.permissions.query
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    )

    // 4. 覆盖 plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    })

    // 5. 覆盖 languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['zh-CN', 'zh', 'en'],
    })

    // 6. 添加真实的 User-Agent 特征
    Object.defineProperty(navigator, 'platform', {
      get: () => 'MacIntel',
    })

    // 7. 覆盖 automation 相关属性
    delete navigator.__proto__.webdriver
  })
}

// 随机延迟（模拟人类操作速度）
function humanDelay(min, max) {
  return new Promise(resolve => setTimeout(resolve, min + Math.random() * (max - min)))
}

// 模拟人类滚动
async function humanScroll(page, { scrolls = 3, pauseMin = 1000, pauseMax = 2000 } = {}) {
  for (let i = 0; i < scrolls; i++) {
    // 随机滚动距离（200-500px）
    const scrollY = 200 + Math.random() * 300
    await page.evaluate((y) => {
      window.scrollBy({
        top: y,
        behavior: 'smooth' // 平滑滚动更像真人
      })
    }, scrollY)
    await humanDelay(pauseMin, pauseMax)
  }
}

// 模拟人类浏览行为
async function browsePageLikeHuman(page, { minStay = 3000, maxStay = 6000 } = {}) {
  // 1. 随机移动鼠标（贝塞尔曲线轨迹）
  const moves = 2 + Math.floor(Math.random() * 3)
  for (let i = 0; i < moves; i++) {
    const x = 100 + Math.random() * 800
    const y = 100 + Math.random() * 600
    await page.mouse.move(x, y, { steps: 10 + Math.floor(Math.random() * 20) })
    await humanDelay(500, 1500)
  }

  // 2. 随机停留
  await humanDelay(minStay, maxStay)

  // 3. 偶尔移动一下鼠标（模拟阅读时的小动作）
  if (Math.random() > 0.5) {
    const x = 300 + Math.random() * 400
    const y = 200 + Math.random() * 400
    await page.mouse.move(x, y, { steps: 5 })
  }
}

// 模拟真人点击（带随机偏移）
async function humanClick(page, selector) {
  const element = await page.$(selector)
  if (!element) return false

  const box = await element.boundingBox()
  if (!box) return false

  // 点击位置随机偏移（不总是点中心）
  const x = box.x + box.width * (0.3 + Math.random() * 0.4)
  const y = box.y + box.height * (0.3 + Math.random() * 0.4)

  // 先移动鼠标到目标位置
  await page.mouse.move(x, y, { steps: 10 + Math.floor(Math.random() * 10) })
  await humanDelay(100, 300)

  // 点击
  await page.mouse.click(x, y)
  return true
}

// 设置真实的浏览器指纹
async function setRealisticFingerprint(page) {
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  )

  await page.setViewport({
    width: 1920,
    height: 1080,
    deviceScaleFactor: 2,
  })

  // 设置真实的 headers
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
  })
}

// 检测是否被风控
async function detectAntiBot(page) {
  const indicators = await page.evaluate(() => {
    const checks = {
      hasCaptcha: !!document.querySelector('[class*="captcha"], [class*="verify"]'),
      hasBlockMessage: document.body.textContent.includes('访问过于频繁') ||
                       document.body.textContent.includes('请稍后再试') ||
                       document.body.textContent.includes('验证'),
      hasRedirect: window.location.href.includes('verify') || window.location.href.includes('captcha'),
    }
    return checks
  })

  return indicators.hasCaptcha || indicators.hasBlockMessage || indicators.hasRedirect
}

module.exports = {
  injectStealthScripts,
  humanDelay,
  humanScroll,
  browsePageLikeHuman,
  humanClick,
  setRealisticFingerprint,
  detectAntiBot,
}
