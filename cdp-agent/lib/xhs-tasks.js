// traffic-engine/cdp-agent/lib/xhs-tasks.js
// XHS (小红书) task implementations for CDP Agent
const { humanDelay, humanScroll, humanMouseMove, humanType, browsePageLikeHuman } = require('./human-behavior')

async function xhsLoginWait(page) {
  // 检测小红书登录状态，已登录则提取账号信息，未登录则等待用户自行登录
  // 不主动打开新页面，不干扰用户操作
  console.log('[xhs] 检测小红书登录状态...')

  // 先访问个人主页看是否已登录
  await page.goto('https://www.xiaohongshu.com/user/profile/me', { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {})

  // 检查是否跳转到了登录页
  const isLoginPage = () => page.url().includes('/login') || page.url().includes('/passport')

  if (!await isLoginPage()) {
    // 已登录，直接提取账号信息
    console.log('[xhs] 已登录，提取账号信息')
    return await accountDetect(page)
  }

  // 未登录，关闭这个 tab，让用户自己去登录
  console.log('[xhs] 未登录，等待用户自行登录小红书（每30秒检测一次，最多等5分钟）')
  await page.goto('about:blank').catch(() => {})

  // 轮询等待：每30秒用一个新 tab 静默检测，检测完立即关掉
  const browser = page.browser()
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 30000))
    let checkPage
    try {
      checkPage = await browser.newPage()
      await checkPage.goto('https://www.xiaohongshu.com/user/profile/me', { waitUntil: 'networkidle2', timeout: 10000 })
      const url = checkPage.url()
      if (!url.includes('/login') && !url.includes('/passport')) {
        console.log('[xhs] 检测到已登录，提取账号信息')
        const result = await accountDetect(checkPage)
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

async function accountDetect(page) {
  await page.goto('https://www.xiaohongshu.com/user/profile/me', { waitUntil: 'networkidle2', timeout: 30000 })
  await browsePageLikeHuman(page, { minStay: 2000, maxStay: 4000 })
  const data = await page.evaluate(() => {
    const text = (sel) => document.querySelector(sel)?.textContent?.trim() || ''
    const attr = (sel, a) => document.querySelector(sel)?.getAttribute(a) || ''
    return {
      nickname: text('.user-name') || text('[class*="username"]') || text('[class*="nickname"]'),
      platform_uid: text('.user-xiaohongshu-info') || text('[class*="redId"]') || text('[class*="xhs-id"]'),
      avatar_url: attr('.avatar img', 'src') || attr('[class*="avatar"] img', 'src'),
      bio: text('.user-desc') || text('[class*="description"]') || text('[class*="bio"]'),
      followers: text('[class*="follower"] .count') || text('[class*="fans"] .count'),
      likes: text('[class*="like"] .count') || text('[class*="liked"] .count'),
      verified: !!document.querySelector('[class*="verified"]') || !!document.querySelector('[class*="official"]'),
    }
  })
  return { detected: true, ...data }
}

async function publishNote(page, params) {
  const { title = '', content = '' } = params
  await page.goto('https://creator.xiaohongshu.com/publish/publish', { waitUntil: 'networkidle2', timeout: 30000 })
  await humanDelay(2000, 4000)
  await page.waitForSelector('[class*="title"] input, [placeholder*="标题"], textarea[placeholder*="标题"]', { timeout: 10000 }).catch(() => {})
  const titleSel = '[class*="title"] input, [placeholder*="标题"]'
  const titleEl = await page.$(titleSel)
  if (titleEl) {
    await titleEl.click({ clickCount: 3 })
    await humanDelay(300, 800)
    await humanType(titleEl, title)
  }
  await humanDelay(500, 1500)
  const contentSel = '[class*="content"] textarea, [placeholder*="正文"], [class*="editor"] [contenteditable]'
  const contentEl = await page.$(contentSel)
  if (contentEl) {
    await contentEl.click()
    await humanDelay(300, 800)
    await humanType(contentEl, content)
  }
  await humanDelay(1000, 3000)
  const publishBtn = await page.$('[class*="publish"] button, button[class*="submit"]')
  if (publishBtn) await publishBtn.click()
  await humanDelay(2000, 4000)
  return { published: true, title }
}

async function likeNote(page, params) {
  const { note_url } = params
  await page.goto(note_url, { waitUntil: 'networkidle2', timeout: 30000 })
  // 先像真人一样浏览内容
  await browsePageLikeHuman(page, { minStay: 3000, maxStay: 8000 })
  await page.waitForSelector('[class*="like"], [class*="heart"]', { timeout: 10000 }).catch(() => {})
  await humanMouseMove(page)
  const likeBtn = await page.$('[class*="like-btn"], [class*="like"] button, [aria-label*="like"], [aria-label*="喜欢"]')
  if (likeBtn) await likeBtn.click()
  await humanDelay(1000, 2000)
  return { liked: true, url: note_url }
}

async function replyComment(page, params) {
  const { note_url, reply_text = '' } = params
  await page.goto(note_url, { waitUntil: 'networkidle2', timeout: 30000 })
  // 先浏览帖子内容，像真人一样阅读
  await browsePageLikeHuman(page, { minStay: 5000, maxStay: 12000 })
  // 滚动到评论区
  await humanScroll(page, { scrolls: 2, pauseMin: 1000, pauseMax: 2000 })
  await page.waitForSelector('[class*="comment"] input, [placeholder*="评论"], [placeholder*="说点什么"]', { timeout: 10000 }).catch(() => {})
  await humanDelay(1000, 2000)
  const inputSel = '[class*="comment-input"], [placeholder*="评论"], [placeholder*="说点什么"]'
  const inputEl = await page.$(inputSel)
  if (inputEl) {
    await inputEl.click()
    await humanDelay(500, 1500)
    await humanType(inputEl, reply_text)
  }
  await humanDelay(800, 2000)
  const submitBtn = await page.$('[class*="comment"] button[class*="submit"], [class*="send"]')
  if (submitBtn) await submitBtn.click()
  await humanDelay(1500, 3000)
  return { replied: true, text: reply_text }
}

async function followUser(page, params) {
  const { user_url } = params
  await page.goto(user_url, { waitUntil: 'networkidle2', timeout: 30000 })
  // 浏览用户主页
  await browsePageLikeHuman(page, { minStay: 3000, maxStay: 6000 })
  await page.waitForSelector('[class*="follow"], button[class*="关注"]', { timeout: 10000 }).catch(() => {})
  await humanMouseMove(page)
  const followBtn = await page.$('[class*="follow-btn"], button[class*="follow"], [aria-label*="关注"]')
  if (followBtn) await followBtn.click()
  await humanDelay(1000, 2000)
  return { followed: true, url: user_url }
}

module.exports = { xhsLoginWait, accountDetect, publishNote, likeNote, replyComment, followUser }
