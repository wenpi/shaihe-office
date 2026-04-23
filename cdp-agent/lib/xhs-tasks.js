// traffic-engine/cdp-agent/lib/xhs-tasks.js
// conn = { mode: 'puppeteer', browser } 或 { mode: 'proxy', proxyUrl }
const { humanMouseMove, humanType } = require('./human-behavior')

// 从已有 tab 找小红书页面
const { injectStealthScripts, humanDelay, humanScroll, browsePageLikeHuman, humanClick, setRealisticFingerprint, detectAntiBot } = require('./stealth-utils')

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
  if (!Array.isArray(targets)) return null // CDP Proxy 返回错误对象
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

// 评论扫描：搜索关键词 → 进入笔记 → 提取评论 → 返回全部结果
async function xhsScanComments(conn, params) {
  console.log('[xhs] xhsScanComments called with params:', JSON.stringify(params))
  const { keyword, max_notes = 5, max_comments = 20 } = params
  if (!keyword) {
    console.log('[xhs] ERROR: keyword required')
    return { error: 'keyword required' }
  }
  console.log(`[xhs] 评论扫描: "${keyword}", max_notes=${max_notes}, max_comments=${max_comments}`)

  let tab = await findXhsTab(conn)
  console.log('[xhs] findXhsTab result:', tab ? `mode=${tab.mode}` : 'null')

  // 如果没有小红书标签页，返回错误提示用户手动打开
  if (!tab) {
    console.log('[xhs] ⚠️  未找到小红书标签页')
    return {
      keyword,
      notes: 0,
      comments: [],
      error: 'no_xhs_tab',
      message: '请先在 Chrome 中手动打开小红书并登录，然后再执行扫描任务'
    }
  }

  console.log('[xhs] 开始执行扫描...')
  if (tab.mode === 'proxy') {
    return xhsScanCommentsProxy(tab, keyword, max_notes, max_comments)
  }
  return xhsScanCommentsPuppeteer(tab.page, keyword, max_notes, max_comments)
}

async function xhsScanCommentsPuppeteer(page, keyword, maxNotes, maxComments) {
  // 注入反检测脚本
  await injectStealthScripts(page)
  await setRealisticFingerprint(page)

  const currentUrl = page.url()
  const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&source=web_search_result_notes`
  await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 20000 })
  await humanDelay(3000, 5000)

  // 检测是否被风控
  const isBlocked = await detectAntiBot(page)
  if (isBlocked) {
    console.log('[xhs] ⚠️  检测到风控，停止扫描')
    return { keyword, notes: 0, comments: [], error: 'anti_bot_detected' }
  }

  // 提取笔记列表
  const notes = await page.evaluate((max) => {
    const items = document.querySelectorAll('section.note-item')
    const results = []
    items.forEach((item, i) => {
      if (i >= max) return
      const a = item.querySelector('a[href*=explore]')
      const noteId = a?.href?.match(/explore\/([a-f0-9]+)/)?.[1] || ''
      const title = item.querySelector('a.title span')?.textContent?.trim() || ''
      if (noteId) results.push({ noteId, title, url: 'https://www.xiaohongshu.com/explore/' + noteId })
    })
    return results
  }, maxNotes)

  console.log(`[xhs] 找到 ${notes.length} 个笔记`)
  const allComments = []

  // 逐个进入笔记提取评论
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i]
    console.log(`[xhs] 扫描笔记 ${i + 1}/${notes.length}: ${note.title}`)

    // 笔记间隔 8-15 秒，更长的随机间隔
    await humanDelay(8000, 15000)

    // 模拟真人点击进入（而非直接 goto）
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {})
    await humanDelay(2000, 4000)

    // 在搜索页找到对应笔记并点击
    const clicked = await page.evaluate((noteId) => {
      const link = document.querySelector(`a[href*="${noteId}"]`)
      if (link) {
        link.click()
        return true
      }
      return false
    }, note.noteId)

    if (!clicked) {
      console.log(`[xhs]   → 无法点击，跳过`)
      continue
    }

    // 等待页面加载
    await humanDelay(3000, 5000)

    // 模拟真人浏览：随机移动鼠标、停留、滚动
    await browsePageLikeHuman(page, { minStay: 5000, maxStay: 10000 })

    // 缓慢滚动到评论区（3-5 次小幅滚动）
    await humanScroll(page, { scrolls: 3 + Math.floor(Math.random() * 3), pauseMin: 1500, pauseMax: 3000 })

    // 等待评论加载
    await humanDelay(2000, 3000)

    // 检测是否被风控
    const isBlocked = await detectAntiBot(page)
    if (isBlocked) {
      console.log(`[xhs]   → ⚠️  检测到风控，停止扫描`)
      break
    }

    const comments = await page.evaluate((max) => {
      const items = document.querySelectorAll('[class*="comment-item"], [class*="commentItem"], .comment-item, .note-comment-item')
      const results = []
      items.forEach((item, i) => {
        if (i >= max) return
        const author = item.querySelector('[class*="author"], [class*="name"], .author-name, .user-name')?.textContent?.trim() || ''
        const text = item.querySelector('[class*="content"], [class*="text"], .comment-content, .note-text')?.textContent?.trim() || ''
        const authorLink = item.querySelector('a[href*="/user/profile"]')?.href || ''
        if (text) results.push({ author, text, authorUrl: authorLink })
      })
      return results
    }, maxComments)

    comments.forEach(c => {
      allComments.push({
        platform: 'xiaohongshu',
        post_url: note.url,
        post_title: note.title,
        comment_author: c.author,
        comment_author_url: c.authorUrl,
        comment_text: c.text,
      })
    })
    console.log(`[xhs]   → ${comments.length} 条评论`)
  }

  // 导航回原页面
  await page.goto(currentUrl, { waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {})
  console.log(`[xhs] 扫描完成: ${notes.length} 笔记, ${allComments.length} 评论`)
  return { keyword, notes: notes.length, comments: allComments }
}

async function xhsScanCommentsProxy(tab, keyword, maxNotes, maxComments) {
  const base = tab.proxyUrl
  const tid = tab.targetId

  // 不用 navigate，用 eval 在页面内跳转（模拟用户行为）
  // Step 1: 在已有小红书标签页中，用 JS 跳转到搜索页
  const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&source=web_search_result_notes`
  const navJs = `window.location.href = '${searchUrl}'`
  await fetch(`${base}/eval?target=${tid}`, { method: 'POST', body: navJs })
  await new Promise(r => setTimeout(r, 5000 + Math.random() * 2000))

  // 检查是否出现二维码验证
  const qrCheckJs = `(() => {
    return document.body.textContent.includes('扫码') ||
           document.body.textContent.includes('二维码') ||
           document.querySelector('[class*="qrcode"], [class*="verify"]') !== null
  })()`
  const qrR = await (await fetch(`${base}/eval?target=${tid}`, { method: 'POST', body: qrCheckJs })).json()
  if (qrR.result || qrR.value) {
    console.log('[xhs] ⚠️  检测到二维码验证，停止扫描')
    return { keyword, notes: 0, comments: [], error: 'qrcode_verification' }
  }

  // Step 2: 提取笔记列表（包含带 xsec_token 的链接）
  const notesJs = `(() => {
    const items = document.querySelectorAll('section.note-item');
    const r = [];
    items.forEach((item, i) => {
      if (i >= ${maxNotes}) return;
      const xsecLink = item.querySelector('a[href*="xsec_token"]');
      const exploreLink = item.querySelector('a[href*=explore]');
      const nid = exploreLink?.href?.match(/explore\\/([a-f0-9]+)/)?.[1] || '';
      const t = item.querySelector('a.title span')?.textContent?.trim() || '';
      const href = xsecLink?.href || exploreLink?.href || '';
      if (nid) r.push({noteId:nid, title:t, url:'https://www.xiaohongshu.com/explore/'+nid, xsecHref:href});
    });
    return JSON.stringify(r);
  })()`
  const notesR = await (await fetch(`${base}/eval?target=${tid}`, { method: 'POST', body: notesJs })).json()
  const notes = JSON.parse(notesR.result || notesR.value || '[]')
  console.log(`[xhs] 找到 ${notes.length} 个笔记`)

  const allComments = []
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i]
    console.log(`[xhs] 扫描笔记 ${i + 1}/${notes.length}: ${note.title}`)

    // 随机间隔 10-20 秒
    await new Promise(r => setTimeout(r, 10000 + Math.random() * 10000))

    // 用 JS 点击带 xsec_token 的链接（关键：必须用 xsec_token 链接才能正常打开）
    const clickJs = `(() => {
      const notes = document.querySelectorAll('section.note-item');
      for (const note of notes) {
        const link = note.querySelector('a[href*="xsec_token"]');
        if (link && link.href.includes('${note.noteId}')) {
          link.click();
          return 'clicked';
        }
      }
      return 'not_found';
    })()`
    const clickR = await (await fetch(`${base}/eval?target=${tid}`, { method: 'POST', body: clickJs })).json()
    if ((clickR.result || clickR.value) !== 'clicked') {
      console.log(`[xhs]   → 无法点击，跳过`)
      continue
    }

    // 等待页面加载
    await new Promise(r => setTimeout(r, 4000 + Math.random() * 3000))

    // 检查是否被风控
    const qr2 = await (await fetch(`${base}/eval?target=${tid}`, { method: 'POST', body: qrCheckJs })).json()
    if (qr2.result || qr2.value) {
      console.log(`[xhs]   → ⚠️  检测到风控，停止扫描`)
      break
    }

    // 模拟滚动到评论区（用 JS 平滑滚动）
    for (let s = 0; s < 3 + Math.floor(Math.random() * 3); s++) {
      const scrollJs = `window.scrollBy({top: ${200 + Math.random() * 300}, behavior: 'smooth'})`
      await fetch(`${base}/eval?target=${tid}`, { method: 'POST', body: scrollJs })
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500))
    }

    // 等待评论加载
    await new Promise(r => setTimeout(r, 3000))

    // 提取评论（使用正确的 DOM 结构）
    const commentsJs = `(() => {
      const items = document.querySelectorAll('.comment-item');
      const r = [];
      items.forEach((item, i) => {
        if (i >= ${maxComments}) return;
        const inner = item.querySelector('.comment-inner-container') || item;
        const nameEl = inner.querySelector('.author-wrapper .name, [class*="author"] .name, a[href*="user/profile"]');
        const contentEl = inner.querySelector('.content, .note-text, [class*="content"]');
        const a = nameEl?.textContent?.trim() || '';
        const t = contentEl?.textContent?.trim() || inner.textContent?.replace(a, '')?.trim()?.slice(0, 200) || '';
        const u = inner.querySelector('a[href*="user/profile"]')?.href || '';
        if (t && !t.includes('THE END')) r.push({author:a, text:t, authorUrl:u});
      });
      return JSON.stringify(r);
    })()`
    const cR = await (await fetch(`${base}/eval?target=${tid}`, { method: 'POST', body: commentsJs })).json()
    const comments = JSON.parse(cR.result || cR.value || '[]')

    comments.forEach(c => {
      allComments.push({
        platform: 'xiaohongshu', post_url: note.url, post_title: note.title,
        comment_author: c.author, comment_author_url: c.authorUrl, comment_text: c.text,
      })
    })
    console.log(`[xhs]   → ${comments.length} 条评论`)

    // 回到搜索页（用 JS 后退）
    const backJs = `window.history.back()`
    await fetch(`${base}/eval?target=${tid}`, { method: 'POST', body: backJs })
    await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000))
  }

  console.log(`[xhs] 扫描完成: ${notes.length} 笔记, ${allComments.length} 评论`)
  return { keyword, notes: notes.length, comments: allComments }
}

module.exports = { xhsLoginWait, accountDetect, publishNote, likeNote, replyComment, followUser, xhsScanComments }
