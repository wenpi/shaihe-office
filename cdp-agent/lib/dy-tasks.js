// traffic-engine/cdp-agent/lib/dy-tasks.js
// 抖音 (Douyin) task implementations for CDP Agent
const { humanDelay, humanType, browsePageLikeHuman } = require('./human-behavior')

async function dyLoginWait(page) {
  console.log('[dy] 检测抖音登录状态...')
  await page.goto('https://creator.douyin.com/creator-micro/home', { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {})

  const isLoginPage = () => {
    const url = page.url()
    return url.includes('/login') || url.includes('/passport')
  }

  if (!isLoginPage()) {
    console.log('[dy] 已登录，提取账号信息')
    return await dyAccountDetect(page)
  }

  console.log('[dy] 未登录，等待用户自行登录（每30秒检测一次，最多等5分钟）')
  await page.goto('about:blank').catch(() => {})

  const browser = page.browser()
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 30000))
    let checkPage
    try {
      checkPage = await browser.newPage()
      await checkPage.goto('https://creator.douyin.com/creator-micro/home', { waitUntil: 'networkidle2', timeout: 10000 })
      const url = checkPage.url()
      if (!url.includes('/login') && !url.includes('/passport')) {
        console.log('[dy] 检测到已登录，提取账号信息')
        const result = await dyAccountDetect(checkPage)
        await checkPage.close().catch(() => {})
        return result
      }
      await checkPage.close().catch(() => {})
    } catch {
      if (checkPage) await checkPage.close().catch(() => {})
    }
  }

  return { detected: false, error: 'login_timeout' }
}

async function dyAccountDetect(page) {
  await page.goto('https://creator.douyin.com/creator-micro/home', { waitUntil: 'networkidle2', timeout: 30000 })
  await browsePageLikeHuman(page, { minStay: 2000, maxStay: 4000 })
  const data = await page.evaluate(() => {
    const text = (sel) => document.querySelector(sel)?.textContent?.trim() || ''
    const attr = (sel, a) => document.querySelector(sel)?.getAttribute(a) || ''
    return {
      nickname: text('[class*="nickname"]') || text('[class*="name"]') || text('.user-name'),
      platform_uid: text('[class*="uid"]') || text('[class*="douyin-id"]') || text('[class*="account-id"]'),
      avatar_url: attr('[class*="avatar"] img', 'src') || attr('.avatar img', 'src'),
      followers: text('[class*="follower"] [class*="count"]') || text('[class*="fans"] [class*="count"]'),
      likes: text('[class*="like"] [class*="count"]') || text('[class*="liked"] [class*="count"]'),
    }
  })
  return { detected: true, platform: 'dy', ...data }
}

async function dyPublishNote(page, params) {
  const { title = '', content = '' } = params
  await page.goto('https://creator.douyin.com/creator-micro/content/upload', { waitUntil: 'networkidle2', timeout: 30000 })
  await humanDelay(2000, 4000)

  await page.waitForSelector('[placeholder*="标题"], input[class*="title"]', { timeout: 10000 }).catch(() => {})
  const titleEl = await page.$('[placeholder*="标题"], input[class*="title"]')
  if (titleEl) {
    await titleEl.click({ clickCount: 3 })
    await humanDelay(300, 800)
    await humanType(titleEl, title)
  }

  await humanDelay(500, 1500)
  const contentEl = await page.$('textarea[placeholder*="内容"], [class*="content"] textarea, [class*="editor"] textarea')
  if (contentEl) {
    await contentEl.click()
    await humanDelay(300, 800)
    await humanType(contentEl, content)
  }

  await humanDelay(1000, 3000)
  const publishBtn = await page.$('button[class*="publish"], button[class*="submit"], [class*="publish-btn"]')
  if (publishBtn) await publishBtn.click()
  await humanDelay(2000, 4000)
  return { published: true, title, platform: 'dy' }
}

module.exports = { dyLoginWait, dyAccountDetect, dyPublishNote }
