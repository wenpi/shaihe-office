// traffic-engine/cdp-agent/lib/feishu-auth.js
const http = require('http')
const fs = require('fs')
const path = require('path')
const { URL } = require('url')

const APP_ID = 'cli_a93a5d6ab53b9bb4'
const AUTH_DIR = path.join(require('os').homedir(), '.cdp-agent')
const TOKEN_FILE = path.join(AUTH_DIR, 'auth.json')

function ensureDir() { if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true }) }

function loadCachedToken() {
  ensureDir()
  if (!fs.existsSync(TOKEN_FILE)) return null
  try {
    const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'))
    if (data.expires_at && Date.now() < data.expires_at) return data
    if (data.refresh_token) return { refresh_token: data.refresh_token }
    return null
  } catch { return null }
}

function saveToken(tokenData) {
  ensureDir()
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2), { mode: 0o600 })
}

async function exchangeCode(code, redirectUri) {
  const res = await fetch('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'authorization_code', client_id: APP_ID, code, redirect_uri: redirectUri }),
  })
  return res.json()
}

async function refreshToken(refreshTk) {
  const res = await fetch('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', client_id: APP_ID, refresh_token: refreshTk }),
  })
  return res.json()
}

async function getFeishuAuth() {
  const cached = loadCachedToken()
  if (cached?.access_token) { console.log('[auth] using cached token'); return cached }
  if (cached?.refresh_token) {
    console.log('[auth] refreshing token...')
    const result = await refreshToken(cached.refresh_token)
    if (result.data?.access_token) {
      const td = { access_token: result.data.access_token, refresh_token: result.data.refresh_token, expires_at: Date.now() + (result.data.expires_in - 300) * 1000 }
      saveToken(td); return td
    }
  }
  console.log('[auth] starting Feishu OAuth login...')
  return new Promise((resolve, reject) => {
    const server = http.createServer()
    const OAUTH_PORT = 19800
    server.listen(OAUTH_PORT, '127.0.0.1', async () => {
      const port = OAUTH_PORT
      const redirectUri = `http://127.0.0.1:${port}/callback`
      const authUrl = `https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=${APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`
      console.log(`[auth] open browser: ${authUrl}`)
      const open = (await import('open')).default; await open(authUrl)
      server.on('request', async (req, res) => {
        const url = new URL(req.url, `http://127.0.0.1:${port}`)
        if (url.pathname !== '/callback') { res.end('waiting...'); return }
        const code = url.searchParams.get('code')
        if (!code) { res.end('no code'); return }
        const result = await exchangeCode(code, redirectUri)
        if (!result.data?.access_token) { res.end('failed'); server.close(); reject(new Error('OAuth failed')); return }
        const td = { access_token: result.data.access_token, refresh_token: result.data.refresh_token, expires_at: Date.now() + (result.data.expires_in - 300) * 1000 }
        saveToken(td)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<h2>登录成功！可以关闭此页面。</h2>')
        server.close(); resolve(td)
      })
      setTimeout(() => { server.close(); reject(new Error('OAuth timeout')) }, 60000)
    })
  })
}
module.exports = { getFeishuAuth }
