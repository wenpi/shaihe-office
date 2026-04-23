// traffic-engine/cdp-agent/lib/dy-tasks.js
const { humanDelay, humanType, browsePageLikeHuman } = require('./human-behavior')
const { createTab } = require('./tab-adapter')

const DY_HOME = 'https://creator.douyin.com/creator-micro/home'
const DY_UPLOAD = 'https://creator.douyin.com/creator-micro/content/upload'

async function dyLoginWait(conn) {
  console.log('[dy] 检测抖音登录状态...')
  const tab = createTab(conn)
  await tab.goto(DY_HOME)

  const url = await tab.url()
  const isLogin = url.includes('/login') || url.includes('/passport')

  if (!isLogin) {
    console.log('[dy] 已登录，提取账号信息')
    const result = await _detectAccount(tab)
    await tab.close()
    return result
  }

  console.log('[dy] 未登录，等待用户自行登录（每30秒检测一次，最多等5分钟）')
  await tab.close()

  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 30000))
    const checkTab = createTab(conn)
    try {
      await checkTab.goto(DY_HOME)
      const checkUrl = await checkTab.url()
      if (!checkUrl.includes('/login') && !checkUrl.includes('/passport')) {
        console.log('[dy] 检测到已登录，提取账号信息')
        const result = await _detectAccount(checkTab)
        await checkTab.close()
        return result
      }
      await checkTab.close()
    } catch {
      await checkTab.close()
    }
  }

  return { detected: false, error: 'login_timeout' }
}

async function dyAccountDetect(conn) {
  const tab = createTab(conn)
  await tab.goto(DY_HOME)
  await tab.wait(2000)
  const result = await _detectAccount(tab)
  await tab.close()
  return result
}

async function _detectAccount(tab) {
  const data = await tab.eval(`(() => {
    const text = (sel) => document.querySelector(sel)?.textContent?.trim() || ''
    const attr = (sel, a) => document.querySelector(sel)?.getAttribute(a) || ''
    return {
      nickname: text('[class*="nickname"]') || text('[class*="name"]') || text('.user-name'),
      platform_uid: text('[class*="uid"]') || text('[class*="douyin-id"]') || text('[class*="account-id"]'),
      avatar_url: attr('[class*="avatar"] img', 'src') || attr('.avatar img', 'src'),
      followers: text('[class*="follower"] [class*="count"]') || text('[class*="fans"] [class*="count"]'),
      likes: text('[class*="like"] [class*="count"]') || text('[class*="liked"] [class*="count"]'),
    }
  })()`)
  return { detected: true, platform: 'dy', ...data }
}

async function dyPublishNote(conn, params) {
  const { title = '', content = '' } = params
  const tab = createTab(conn)
  await tab.goto(DY_UPLOAD)
  await tab.wait(3000)

  const titleSel = '[placeholder*="标题"], input[class*="title"]'
  await tab.click(titleSel).catch(() => {})
  await tab.wait(500)
  await tab.eval(`(() => {
    const el = document.querySelector('${titleSel}')
    if (el) { el.value = ''; el.dispatchEvent(new Event('input', {bubbles:true})) }
  })()`)
  await tab.eval(`document.querySelector('${titleSel}')?.focus()`)
  // 逐字输入 title
  for (const char of title) {
    await tab.eval(`document.execCommand('insertText', false, ${JSON.stringify(char)})`)
    await tab.wait(50)
  }

  await tab.wait(800)
  const contentSel = 'textarea[placeholder*="内容"], [class*="content"] textarea, [class*="editor"] textarea'
  await tab.click(contentSel).catch(() => {})
  await tab.wait(500)
  for (const char of content) {
    await tab.eval(`document.execCommand('insertText', false, ${JSON.stringify(char)})`)
    await tab.wait(30)
  }

  await tab.wait(1500)
  await tab.click('button[class*="publish"], button[class*="submit"], [class*="publish-btn"]').catch(() => {})
  await tab.wait(3000)
  await tab.close()
  return { published: true, title, platform: 'dy' }
}

async function dyScanComments(conn, params) {
  const keyword = params.keyword || params.keywords || '抖音'
  const maxNotes = params.maxNotes || 5
  const maxComments = params.maxComments || 20
  console.log(`[dy] 评论扫描: "${keyword}", max_notes=${maxNotes}, max_comments=${maxComments}`)

  // 找已有抖音标签页或新开
  const tab = createTab(conn)
  const found = await tab.findTab('douyin.com')
  if (!found) {
    await tab.goto(`https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=video`)
  } else {
    await tab.eval(`window.location.href = 'https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=video'`)
  }
  await tab.wait(5000)

  // 检查风控
  const riskCheck = await tab.eval(`(() => {
    return document.body.textContent.includes('验证') ||
           document.body.textContent.includes('滑动') ||
           document.querySelector('[class*="captcha"], [class*="verify"]') !== null
  })()`)
  if (riskCheck) {
    console.log('[dy] ⚠️  检测到风控验证，停止扫描')
    await tab.close()
    return { keyword, notes: 0, comments: [], error: 'risk_control' }
  }

  // 提取搜索结果卡片（含视频ID）
  const cardsJson = await tab.eval(`(() => {
    const cards = document.querySelectorAll('.search-result-card, [class*="search-card"], [class*="video-card"]')
    const r = []
    cards.forEach((card, i) => {
      if (i >= ${maxNotes}) return
      const a = card.querySelector('a[href*="video"]')
      const vidId = a?.href?.match(/video\\/([\\d]+)/)?.[1] || ''
      const desc = card.querySelector('.VDYK8Xd7, [class*="desc"], [class*="title"]')
      const author = card.querySelector('.MZNczJmS, [class*="author"], [class*="nickname"]')
      if (!vidId) return
      r.push({
        videoId: vidId,
        videoUrl: 'https://www.douyin.com/video/' + vidId,
        title: desc?.textContent?.trim()?.slice(0, 100) || '',
        author: author?.textContent?.trim() || ''
      })
    })
    return JSON.stringify(r)
  })()`)

  const cards = JSON.parse(cardsJson || '[]')
  console.log(`[dy] 找到 ${cards.length} 个视频`)

  const allComments = []

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]
    console.log(`[dy] 扫描视频 ${i + 1}/${cards.length}: ${card.title}`)

    await tab.wait(8000 + Math.random() * 8000)

    // 打开视频详情页
    await tab.eval(`window.location.href = '${card.videoUrl}'`)
    await tab.wait(5000)

    // 检查风控
    const risk2 = await tab.eval(`(() => {
      return document.body.textContent.includes('验证') ||
             document.querySelector('[class*="captcha"]') !== null
    })()`)
    if (risk2) {
      console.log('[dy]   → ⚠️  风控，停止')
      break
    }

    // 滚动到评论区
    for (let s = 0; s < 3; s++) {
      await tab.eval(`window.scrollBy({top: ${300 + Math.random() * 300}, behavior: 'smooth'})`)
      await tab.wait(1500)
    }
    await tab.wait(2000)

    // 提取评论
    const commentsJson = await tab.eval(`(() => {
      const items = document.querySelectorAll('[data-e2e="comment-item"]')
      const r = []
      items.forEach((item, i) => {
        if (i >= ${maxComments}) return
        const userLink = item.querySelector('a[href*="user"]')
        const userId = userLink?.href?.match(/user\\/([^?]+)/)?.[1] || ''
        const userName = userLink?.textContent?.trim()?.replace('作者', '').trim() || ''
        const spans = [...item.querySelectorAll('span')]
        const contentSpan = spans.find(s =>
          s.textContent.trim().length > 2 &&
          s !== spans[0] &&
          !s.textContent.includes('前·') &&
          !s.textContent.includes('回复') &&
          !s.textContent.includes('分享') &&
          !s.textContent.includes('展开')
        )
        const likeSpan = spans.find(s => /^\\d+$/.test(s.textContent.trim()))
        if (!userName) return
        r.push({
          author: userName,
          authorUrl: userLink?.href || '',
          text: contentSpan?.textContent?.trim()?.slice(0, 500) || '',
          likes: parseInt(likeSpan?.textContent) || 0
        })
      })
      return JSON.stringify(r)
    })()`)

    const comments = JSON.parse(commentsJson || '[]')
    comments.forEach(c => {
      allComments.push({
        platform: 'douyin',
        post_url: card.videoUrl,
        post_title: card.title,
        comment_author: c.author,
        comment_author_url: c.authorUrl,
        comment_text: c.text,
      })
    })
    console.log(`[dy]   → ${comments.length} 条评论`)

    // 返回搜索页
    await tab.eval(`window.history.back()`)
    await tab.wait(4000)
  }

  await tab.close()
  console.log(`[dy] 扫描完成: ${cards.length} 视频, ${allComments.length} 评论`)
  return { keyword, notes: cards.length, comments: allComments }
}

module.exports = { dyLoginWait, dyAccountDetect, dyPublishNote, dyScanComments }
