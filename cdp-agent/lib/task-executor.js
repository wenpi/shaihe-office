// traffic-engine/cdp-agent/lib/task-executor.js
// conn = { mode: 'puppeteer', browser } 或 { mode: 'proxy', proxyUrl }
const { humanDelay, browsePageLikeHuman } = require('./human-behavior')

const PLATFORM_TASKS = new Set([
  'xhs_login_wait', 'account_detect', 'publish_note', 'reply_comment', 'like_note', 'follow_user',
  'dy_login_wait', 'dy_account_detect', 'dy_publish_note',
  'wxvideo_login_wait', 'wxvideo_account_detect', 'wxvideo_publish',
  'ks_login_wait', 'ks_account_detect', 'ks_publish_note',
])

async function executeTask(conn, task, onProgress) {
  const { task_type } = task

  if (PLATFORM_TASKS.has(task_type)) {
    return executePlatformTask(conn, task)
  }

  // 通用 CDP 任务
  if (conn.mode === 'proxy') {
    return executeProxyCdpTask(conn, task, onProgress)
  }
  return executePuppeteerCdpTask(conn.browser, task, onProgress)
}

async function executePuppeteerCdpTask(browser, task, onProgress) {
  const { task_type, target_url, timeout_ms = 60000 } = task
  const page = await browser.newPage()
  try {
    if (target_url) {
      onProgress?.({ step: 'navigating', url: target_url })
      await page.goto(target_url, { waitUntil: 'networkidle2', timeout: timeout_ms })
      await browsePageLikeHuman(page, { minStay: 2000, maxStay: 5000 })
    }
    let result
    switch (task_type) {
      case 'cdp_navigate':
        result = { title: await page.title(), url: page.url() }; break
      case 'cdp_screenshot': {
        const opts = { encoding: 'base64', type: 'png' }
        result = { screenshot: await page.screenshot({ ...opts, fullPage: true }) }
        break
      }
      case 'cdp_eval': {
        const results = []
        for (const script of (task.scripts || [])) {
          results.push(await page.evaluate(script))
          await humanDelay(500, 1500)
        }
        result = results.length === 1 ? { result: results[0] } : { results }
        break
      }
      default:
        return { success: false, data: { error: `unknown: ${task_type}` } }
    }
    return { success: true, data: result }
  } catch (err) {
    return { success: false, data: { error: err.message } }
  } finally { await page.close().catch(() => {}) }
}

async function executeProxyCdpTask(conn, task, onProgress) {
  const { task_type, target_url } = task
  const base = conn.proxyUrl
  try {
    let result
    switch (task_type) {
      case 'cdp_navigate': {
        const r = await fetch(`${base}/new?url=${encodeURIComponent(target_url)}`)
        const d = await r.json()
        const info = await (await fetch(`${base}/info?target=${d.targetId}`)).json()
        result = { title: info.title, url: info.url, targetId: d.targetId }
        break
      }
      case 'cdp_screenshot': {
        const targets = await (await fetch(`${base}/targets`)).json()
        const t = targets.find(t => t.url === target_url) || targets[0]
        if (!t) return { success: false, data: { error: 'no target' } }
        const r = await fetch(`${base}/screenshot?target=${t.targetId}`)
        result = await r.json()
        break
      }
      case 'cdp_eval': {
        const targets = await (await fetch(`${base}/targets`)).json()
        const t = targets[0]
        if (!t) return { success: false, data: { error: 'no target' } }
        const results = []
        for (const script of (task.scripts || [])) {
          const r = await fetch(`${base}/eval?target=${t.targetId}`, { method: 'POST', body: script })
          results.push(await r.json())
        }
        result = results.length === 1 ? { result: results[0] } : { results }
        break
      }
      default:
        return { success: false, data: { error: `unknown: ${task_type}` } }
    }
    return { success: true, data: result }
  } catch (err) {
    return { success: false, data: { error: err.message } }
  }
}

async function executePlatformTask(conn, task) {
  const { task_type } = task
  try {
    let handler, mod
    if (task_type.startsWith('dy_')) {
      mod = require('./dy-tasks')
      handler = { dy_login_wait: mod.dyLoginWait, dy_account_detect: mod.dyAccountDetect, dy_publish_note: mod.dyPublishNote }[task_type]
    } else if (task_type.startsWith('wxvideo_')) {
      mod = require('./wxvideo-tasks')
      handler = { wxvideo_login_wait: mod.wxvideoLoginWait, wxvideo_account_detect: mod.wxvideoAccountDetect, wxvideo_publish: mod.wxvideoPublish }[task_type]
    } else if (task_type.startsWith('ks_')) {
      mod = require('./ks-tasks')
      handler = { ks_login_wait: mod.ksLoginWait, ks_account_detect: mod.ksAccountDetect, ks_publish_note: mod.ksPublishNote }[task_type]
    } else {
      mod = require('./xhs-tasks')
      handler = { xhs_login_wait: mod.xhsLoginWait, account_detect: mod.accountDetect, publish_note: mod.publishNote, reply_comment: mod.replyComment, like_note: mod.likeNote, follow_user: mod.followUser }[task_type]
    }
    if (!handler) return { success: false, data: { error: `no handler: ${task_type}` } }
    const result = await handler(conn, task.params || task)
    return { success: true, data: result }
  } catch (err) {
    return { success: false, data: { error: err.message } }
  }
}

module.exports = { executeTask }
