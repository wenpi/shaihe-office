// traffic-engine/cdp-agent/lib/human-behavior.js
// 模拟真人浏览行为，降低风控触发概率

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomFloat(min, max) {
  return Math.random() * (max - min) + min
}

/** 随机等待，模拟人类阅读/思考时间 */
async function humanDelay(minMs = 1000, maxMs = 3000) {
  const ms = randomInt(minMs, maxMs)
  await new Promise(r => setTimeout(r, ms))
}

/** 模拟真人滚动页面（随机速度、随机停顿） */
async function humanScroll(page, opts = {}) {
  const { scrolls = randomInt(2, 5), pauseMin = 800, pauseMax = 2500 } = opts
  for (let i = 0; i < scrolls; i++) {
    const distance = randomInt(200, 500)
    await page.evaluate((d) => {
      window.scrollBy({ top: d, behavior: 'smooth' })
    }, distance)
    await humanDelay(pauseMin, pauseMax)
  }
}

/** 模拟真人鼠标移动（随机轨迹） */
async function humanMouseMove(page) {
  const vp = await page.viewport()
  if (!vp) return
  const steps = randomInt(3, 6)
  for (let i = 0; i < steps; i++) {
    const x = randomInt(100, vp.width - 100)
    const y = randomInt(100, vp.height - 100)
    await page.mouse.move(x, y, { steps: randomInt(5, 15) })
    await humanDelay(200, 600)
  }
}

/** 模拟真人打字（随机速度，偶尔停顿） */
async function humanType(element, text) {
  for (const char of text) {
    await element.type(char, { delay: randomInt(50, 200) })
    // 5% 概率长停顿，模拟思考
    if (Math.random() < 0.05) {
      await humanDelay(500, 1500)
    }
  }
}

/** 页面浏览模拟：滚动+鼠标移动+停留 */
async function browsePageLikeHuman(page, opts = {}) {
  const { minStay = 3000, maxStay = 8000 } = opts
  await humanDelay(500, 1500)
  await humanMouseMove(page)
  await humanScroll(page)
  await humanDelay(minStay, maxStay)
}

module.exports = {
  randomInt,
  humanDelay,
  humanScroll,
  humanMouseMove,
  humanType,
  browsePageLikeHuman,
}
