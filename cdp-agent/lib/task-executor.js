// traffic-engine/cdp-agent/lib/task-executor.js
// 平台任务用已有tab，通用CDP任务才开新tab
const { humanDelay, browsePageLikeHuman } = require('./human-behavior')

// 平台任务类型集合
const PLATFORM_TASKS = new Set([
  'xhs_login_wait', 'account_detect', 'publish_note', 'reply_comment', 'like_note', 'follow_user',
  'dy_login_wait', 'dy_account_detect', 'dy_publish_note',
  'wxvideo_login_wait', 'wxvideo_account_detect', 'wxvideo_publish',
  'ks_login_wait', 'ks_account_detect', 'ks_publish_note',
])

async function executeTask(browser, task, onProgress) {
  const { task_type, target_url, timeout_ms = 60000 } = task

  // 平台任务：传 browser 给 handler，由 handler 自己找已有 tab 操作
  if (PLATFORM_TASKS.has(task_type)) {
    return executePlatformTask(browser, task)
  }

  // 通用 CDP 任务：开新 tab
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
      case 'cdp_eval':
        const results = []
        for (const script of (task.scripts || [])) {
          onProgress?.({ step: 'eval', script: script.slice(0, 100) })
          results.push(await page.evaluate(script))
          await humanDelay(500, 1500)
        }
        result = results.length === 1 ? { result: results[0] } : { results }; break
      case 'cdp_screenshot':
        const opts = { encoding: 'base64', type: 'png' }
        if (task.selector) {
          const el = await page.$(task.selector)
          result = { screenshot: el ? await el.screenshot(opts) : await page.screenshot(opts) }
        } else {
          result = { screenshot: await page.screenshot({ ...opts, fullPage: true }) }
        }; break
      case 'cdp_extract':
        const extracted = {}
        for (const [key, sel] of Object.entries(task.selectors || {})) {
          extracted[key] = await page.$$eval(sel, els => els.map(e => e.textContent?.trim()))
        }
        result = extracted; break
      default:
        return { success: false, data: { error: `unknown: ${task_type}` } }
    }
    return { success: true, data: result }
  } catch (err) {
    return { success: false, data: { error: err.message } }
  } finally { await page.close().catch(() => {}) }
}

async function executePlatformTask(browser, task) {
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
    // 传 browser 给 handler，让它自己找已有 tab 操作，不开新 tab
    const result = await handler(browser, task.params || task)
    return { success: true, data: result }
  } catch (err) {
    return { success: false, data: { error: err.message } }
  }
}

module.exports = { executeTask }
