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

module.exports = { dyLoginWait, dyAccountDetect, dyPublishNote }
