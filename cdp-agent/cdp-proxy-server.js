#!/usr/bin/env node
// CDP Proxy Server - 本地 HTTP 服务器，用于 Claude Code 命令调用
const http = require('http')
const url = require('url')
const puppeteer = require('puppeteer')

const PORT = process.env.CDP_PROXY_PORT || 3456
let browser = null
let targets = new Map() // targetId -> page

async function connectChrome() {
  try {
    // 尝试连接已有的 Chrome 实例
    browser = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9222',
      defaultViewport: null
    })
    console.log('[chrome] 已连接到现有 Chrome 实例')
  } catch (err) {
    // 启动新的 Chrome 实例
    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })
    console.log('[chrome] 已启动新的 Chrome 实例')
  }
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true)
  const pathname = parsedUrl.pathname
  const query = parsedUrl.query

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }

  try {
    // GET /health
    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ connected: browser !== null, targets: targets.size }))
      return
    }

    // GET /new?url=xxx
    if (pathname === '/new') {
      const targetUrl = query.url
      if (!targetUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing url parameter' }))
        return
      }

      const page = await browser.newPage()
      await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 })
      const targetId = page.target()._targetId
      targets.set(targetId, page)

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ targetId }))
      return
    }

    // POST /eval?target=xxx
    if (pathname === '/eval' && req.method === 'POST') {
      const targetId = query.target
      if (!targetId) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing target parameter' }))
        return
      }

      const page = targets.get(targetId)
      if (!page) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Target not found' }))
        return
      }

      let body = ''
      req.on('data', chunk => { body += chunk.toString() })
      req.on('end', async () => {
        try {
          const result = await page.evaluate(body)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ result }))
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        }
      })
      return
    }

    // GET /back?target=xxx
    if (pathname === '/back') {
      const targetId = query.target
      const page = targets.get(targetId)
      if (!page) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Target not found' }))
        return
      }

      await page.goBack({ waitUntil: 'networkidle2' })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true }))
      return
    }

    // GET /close?target=xxx
    if (pathname === '/close') {
      const targetId = query.target
      const page = targets.get(targetId)
      if (!page) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Target not found' }))
        return
      }

      await page.close()
      targets.delete(targetId)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true }))
      return
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  } catch (err) {
    console.error('[error]', err)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err.message }))
  }
})

async function main() {
  await connectChrome()
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`\n  CDP Proxy Server v1.0.0`)
    console.log(`  Listening on http://localhost:${PORT}`)
    console.log(`  Ready for commands\n`)
  })
}

process.on('SIGINT', async () => {
  console.log('\n[shutdown] Closing...')
  for (const page of targets.values()) {
    await page.close().catch(() => {})
  }
  if (browser) await browser.close().catch(() => {})
  process.exit(0)
})

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
