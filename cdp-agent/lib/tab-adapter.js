// traffic-engine/cdp-agent/lib/tab-adapter.js
// 统一 Tab 操作接口，屏蔽 puppeteer 和 proxy 两种底层模式
// 各平台任务只需调用 tab.goto / tab.url / tab.eval / tab.click / tab.close 等方法

class TabAdapter {
  constructor(conn, targetId = null) {
    this.conn = conn
    this.targetId = targetId  // proxy 模式下的 tab ID
    this._page = null         // puppeteer 模式下的 page 对象
  }

  // 打开新 tab 并导航到 URL
  async goto(url, opts = {}) {
    if (this.conn.mode === 'puppeteer') {
      if (!this._page) {
        this._page = await this.conn.browser.newPage()
      }
      await this._page.goto(url, { waitUntil: 'networkidle2', timeout: 30000, ...opts }).catch(() => {})
    } else {
      const timeout = opts.timeout || 30000
      const r = await fetch(`${this.conn.proxyUrl}/new?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(timeout) })
      const d = await r.json()
      this.targetId = d.targetId
    }
    return this
  }

  // 获取当前 URL
  async url() {
    if (this.conn.mode === 'puppeteer') {
      return this._page?.url() || ''
    }
    const r = await fetch(`${this.conn.proxyUrl}/info?target=${this.targetId}`)
    const d = await r.json()
    return typeof d === 'string' ? JSON.parse(d).url : d.url || ''
  }

  // 执行 JS，返回值
  async eval(script) {
    if (this.conn.mode === 'puppeteer') {
      return this._page.evaluate(script)
    }
    const r = await fetch(`${this.conn.proxyUrl}/eval?target=${this.targetId}`, { method: 'POST', body: script })
    const d = await r.json()
    return d.value !== undefined ? d.value : d
  }

  // 点击元素（CSS 选择器）
  async click(selector) {
    if (this.conn.mode === 'puppeteer') {
      await this._page.click(selector).catch(() => {})
    } else {
      await fetch(`${this.conn.proxyUrl}/click?target=${this.targetId}`, { method: 'POST', body: selector })
    }
  }

  // 滚动页面
  async scroll(y = 3000, direction = 'down') {
    if (this.conn.mode === 'puppeteer') {
      await this._page.evaluate((y) => window.scrollBy(0, y), y)
      await new Promise(r => setTimeout(r, 800))
    } else {
      await fetch(`${this.conn.proxyUrl}/scroll?target=${this.targetId}&y=${y}&direction=${direction}`)
    }
  }

  // 后退
  async back() {
    if (this.conn.mode === 'puppeteer') {
      await this._page.goBack({ waitUntil: 'networkidle2' }).catch(() => {})
    } else {
      await fetch(`${this.conn.proxyUrl}/back?target=${this.targetId}`)
    }
  }

  // 等待毫秒
  async wait(ms) {
    await new Promise(r => setTimeout(r, ms))
  }

  // 关闭 tab
  async close() {
    if (this.conn.mode === 'puppeteer') {
      await this._page?.close().catch(() => {})
    } else if (this.targetId) {
      await fetch(`${this.conn.proxyUrl}/close?target=${this.targetId}`).catch(() => {})
    }
  }

  // 获取所有已打开的 tab 列表（proxy 模式专用，puppeteer 返回空）
  async targets() {
    if (this.conn.mode === 'puppeteer') {
      return this.conn.browser.pages().then(pages => pages.map(p => ({ url: p.url() })))
    }
    const r = await fetch(`${this.conn.proxyUrl}/targets`)
    const d = await r.json()
    return Array.isArray(d) ? d : []
  }

  // 找到包含指定 URL 关键词的已有 tab，切换到它（不新开）
  async findTab(urlKeyword) {
    if (this.conn.mode === 'puppeteer') {
      const pages = await this.conn.browser.pages()
      const p = pages.find(p => p.url().includes(urlKeyword))
      if (p) { this._page = p; return true }
      return false
    }
    const targets = await this.targets()
    const t = targets.find(t => t.url?.includes(urlKeyword))
    if (t) { this.targetId = t.targetId; return true }
    return false
  }
}

// 工厂函数：创建一个空 TabAdapter（还没有打开任何 tab）
function createTab(conn) {
  return new TabAdapter(conn)
}

module.exports = { TabAdapter, createTab }
