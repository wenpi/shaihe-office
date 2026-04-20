// traffic-engine/cdp-agent/lib/task-executor.js
const { humanDelay, browsePageLikeHuman } = require('./human-behavior')

async function executeTask(browser, task, onProgress) {
  const { task_type, target_url, timeout_ms = 60000 } = task
  const page = await browser.newPage()
  try {
    if (target_url) {
      onProgress?.({ step: 'navigating', url: target_url })
      await page.goto(target_url, { waitUntil: 'networkidle2', timeout: timeout_ms })
      // 每次导航后模拟真人浏览
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
      case 'xhs_login_wait':
      case 'account_detect':
      case 'publish_note':
      case 'reply_comment':
      case 'like_note':
      case 'follow_user': {
        const xhs = require('./xhs-tasks')
        const handler = { xhs_login_wait: xhs.xhsLoginWait, account_detect: xhs.accountDetect, publish_note: xhs.publishNote, reply_comment: xhs.replyComment, like_note: xhs.likeNote, follow_user: xhs.followUser }[task_type]
        result = await handler(page, task.params || task)
        const shot = await page.screenshot({ encoding: 'base64', type: 'png' })
        result._screenshot = shot
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
module.exports = { executeTask }
