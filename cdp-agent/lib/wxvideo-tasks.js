// traffic-engine/cdp-agent/lib/wxvideo-tasks.js
const { createTab } = require('./tab-adapter')

const WX_HOME = 'https://channels.weixin.qq.com/platform'
const WX_UPLOAD = 'https://channels.weixin.qq.com/platform/post/create'

async function wxvideoLoginWait(conn) {
  console.log('[wxvideo] 检测视频号登录状态...')
  const tab = createTab(conn)
  await tab.goto(WX_HOME)

  const url = await tab.url()
  const isLogin = url.includes('/login') || url.includes('/passport') || url.includes('weixin.qq.com/cgi-bin')

  if (!isLogin) {
    console.log('[wxvideo] 已登录，提取账号信息')
    const result = await _detectAccount(tab)
    await tab.close()
    return result
  }

  console.log('[wxvideo] 未登录，等待用户自行登录（每30秒检测一次，最多等5分钟）')
  await tab.close()

  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 30000))
    const checkTab = createTab(conn)
    try {
      await checkTab.goto(WX_HOME)
      const checkUrl = await checkTab.url()
      if (!checkUrl.includes('/login') && !checkUrl.includes('/passport') && !checkUrl.includes('weixin.qq.com/cgi-bin')) {
        console.log('[wxvideo] 检测到已登录，提取账号信息')
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

async function wxvideoAccountDetect(conn) {
  const tab = createTab(conn)
  await tab.goto(WX_HOME)
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
      nickname: text('[class*="nickname"]') || text('[class*="name"]') || text('.account-name'),
      platform_uid: text('[class*="account-id"]') || text('[class*="uid"]') || text('[class*="wxid"]'),
      avatar_url: attr('[class*="avatar"] img', 'src') || attr('.avatar img', 'src'),
      followers: text('[class*="follower"] [class*="count"]') || text('[class*="fans"] [class*="count"]'),
      likes: text('[class*="like"] [class*="count"]') || text('[class*="liked"] [class*="count"]'),
    }
  })()`)
  return { detected: true, platform: 'wxvideo', ...data }
}

async function wxvideoPublish(conn, params) {
  const { title = '', content = '' } = params
  const tab = createTab(conn)
  await tab.goto(WX_UPLOAD)
  await tab.wait(3000)

  const titleSel = '[placeholder*="标题"], input[class*="title"]'
  await tab.click(titleSel).catch(() => {})
  await tab.wait(500)
  for (const char of title) {
    await tab.eval(`document.execCommand('insertText', false, ${JSON.stringify(char)})`)
    await tab.wait(50)
  }

  await tab.wait(800)
  const contentSel = '[contenteditable="true"][class*="content"], [contenteditable="true"][class*="editor"], [contenteditable="true"][placeholder*="内容"]'
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
  return { published: true, title, platform: 'wxvideo' }
}

module.exports = { wxvideoLoginWait, wxvideoAccountDetect, wxvideoPublish }
