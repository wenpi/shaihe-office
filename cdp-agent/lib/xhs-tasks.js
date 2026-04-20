// traffic-engine/cdp-agent/lib/xhs-tasks.js
// conn = { mode: 'puppeteer', browser } 或 { mode: 'proxy', proxyUrl }
const { humanDelay, humanScroll, humanMouseMove, humanType, browsePageLikeHuman } = require('./human-behavior')

// 从已有 tab 找小红书页面
async function findXhsTab(conn) {
  if (conn.mode === 'puppeteer') {
    const pages = await conn.browser.pages()
    for (const p of pages) {
      if (p.url().includes('xiaohongshu.com')) return { mode: 'puppeteer', page: p }
    }
    return null
  }
  // proxy 模式
  const res = await fetch(`${conn.proxyUrl}/targets`)
  const targets = await res.json()
  const t = targets.find(t => t.url?.includes('xiaohongshu.com'))
  if (t) return { mode: 'proxy', targetId: t.targetId, proxyUrl: conn.proxyUrl }
  return null
}

async function xhsLoginWait(conn) {
  console.log('[xhs] 从已有标签页检测小红书登录状态...')

  let tab = await findXhsTab(conn)
  if (tab) {
    console.log('[xhs] 找到小红书标签页，提取账号信息')
    return await accountDetect(conn)
  }

  console.log('[xhs] 未找到小红书标签页，等待用户打开并登录（每60秒检测一次）')
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 60000))
    tab = await findXhsTab(conn)
    if (tab) {
      console.log('[xhs] 检测到小红书标签页，提取账号信息')
      return await accountDetect(conn)
    }
  }
  return { detected: false, error: 'no_xhs_tab_found' }
}

async function accountDetect(conn) {
  const tab = await findXhsTab(conn)
  if (!tab) return { detected: false, error: 'no_xhs_tab' }

  if (tab.mode === 'proxy') {
    return accountDetectProxy(tab)
  }
  return accountDetectPuppeteer(tab.page)
}

async function accountDetectPuppeteer(page) {
  const currentUrl = page.url()
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
  await page.goto(currentUrl, { waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {})
  return { detected: true, ...data }
}

async function accountDetectProxy(tab) {
  const base = tab.proxyUrl
  const tid = tab.targetId
  // 记住当前 URL
  const info = await (await fetch(`${base}/info?target=${tid}`)).json()
  const currentUrl = info.url
  // 导航到个人主页
  await fetch(`${base}/navigate?target=${tid}&url=${encodeURIComponent('https://www.xiaohongshu.com/user/profile/me')}`)
  await new Promise(r => setTimeout(r, 3000))
  // 提取信息
  const js = `(() => {
    const text = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
    const attr = (sel, a) => document.querySelector(sel)?.getAttribute(a) || '';
    return JSON.stringify({
      nickname: text('.user-name') || text('[class*="username"]') || text('[class*="nickname"]'),
      platform_uid: text('.user-xiaohongshu-info') || text('[class*="redId"]') || text('[class*="xhs-id"]'),
      avatar_url: attr('.avatar img', 'src') || attr('[class*="avatar"] img', 'src'),
      bio: text('.user-desc') || text('[class*="description"]') || text('[class*="bio"]'),
      followers: text('[class*="follower"] .count') || text('[class*="fans"] .count'),
      likes: text('[class*="like"] .count') || text('[class*="liked"] .count'),
      verified: !!document.querySelector('[class*="verified"]') || !!document.querySelector('[class*="official"]'),
    });
  })()`
  const r = await fetch(`${base}/eval?target=${tid}`, { method: 'POST', body: js })
  const raw = await r.json()
  const data = typeof raw.result === 'string' ? JSON.parse(raw.result) : raw.result || raw
  // 导航回去
  await fetch(`${base}/navigate?target=${tid}&url=${encodeURIComponent(currentUrl)}`).catch(() => {})
  return { detected: true, ...data }
}

async function publishNote(conn, params) {
  const tab = await findXhsTab(conn)
  if (!tab) return { error: 'no_xhs_tab' }
  if (tab.mode === 'proxy') return { error: 'publish not supported in proxy mode' }
  const page = tab.page
  const { title = '', content = '' } = params
  await page.goto('https://creator.xiaohongshu.com/publish/publish', { waitUntil: 'networkidle2', timeout: 30000 })
  await humanDelay(2000, 4000)
  const titleEl = await page.$('[class*="title"] input, [placeholder*="标题"]')
  if (titleEl) { await titleEl.click({ clickCount: 3 }); await humanType(titleEl, title) }
  await humanDelay(500, 1500)
  const contentEl = await page.$('[class*="content"] textarea, [placeholder*="正文"], [class*="editor"] [contenteditable]')
  if (contentEl) { await contentEl.click(); await humanType(contentEl, content) }
  await humanDelay(1000, 3000)
  const btn = await page.$('[class*="publish"] button, button[class*="submit"]')
  if (btn) await btn.click()
  await humanDelay(2000, 4000)
  return { published: true, title }
}

async function likeNote(conn, params) {
  const tab = await findXhsTab(conn)
  if (!tab) return { error: 'no_xhs_tab' }
  if (tab.mode === 'proxy') return { error: 'like not supported in proxy mode' }
  const page = tab.page
  await page.goto(params.note_url, { waitUntil: 'networkidle2', timeout: 30000 })
  await browsePageLikeHuman(page, { minStay: 3000, maxStay: 8000 })
  const btn = await page.$('[class*="like-btn"], [class*="like"] button')
  if (btn) await btn.click()
  await humanDelay(1000, 2000)
  return { liked: true, url: params.note_url }
}

async function replyComment(conn, params) {
  const tab = await findXhsTab(conn)
  if (!tab) return { error: 'no_xhs_tab' }
  if (tab.mode === 'proxy') return { error: 'reply not supported in proxy mode' }
  const page = tab.page
  await page.goto(params.note_url, { waitUntil: 'networkidle2', timeout: 30000 })
  await browsePageLikeHuman(page, { minStay: 5000, maxStay: 12000 })
  await humanScroll(page, { scrolls: 2, pauseMin: 1000, pauseMax: 2000 })
  const input = await page.$('[class*="comment-input"], [placeholder*="评论"]')
  if (input) { await input.click(); await humanType(input, params.reply_text || '') }
  await humanDelay(800, 2000)
  const btn = await page.$('[class*="comment"] button[class*="submit"], [class*="send"]')
  if (btn) await btn.click()
  await humanDelay(1500, 3000)
  return { replied: true, text: params.reply_text }
}

async function followUser(conn, params) {
  const tab = await findXhsTab(conn)
  if (!tab) return { error: 'no_xhs_tab' }
  if (tab.mode === 'proxy') return { error: 'follow not supported in proxy mode' }
  const page = tab.page
  await page.goto(params.user_url, { waitUntil: 'networkidle2', timeout: 30000 })
  await browsePageLikeHuman(page, { minStay: 3000, maxStay: 6000 })
  const btn = await page.$('[class*="follow-btn"], button[class*="follow"]')
  if (btn) await btn.click()
  await humanDelay(1000, 2000)
  return { followed: true, url: params.user_url }
}

module.exports = { xhsLoginWait, accountDetect, publishNote, likeNote, replyComment, followUser }
