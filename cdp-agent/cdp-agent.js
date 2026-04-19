#!/usr/bin/env node
// traffic-engine/cdp-agent/cdp-agent.js
const { WsClient } = require('./lib/ws-client')
const { connectChrome } = require('./lib/chrome-manager')
const { executeTask } = require('./lib/task-executor')
const os = require('os')
const fs = require('fs')
const path = require('path')
const readline = require('readline')

const SERVER_URL = process.env.CDP_SERVER_URL || 'wss://user.aiseo114.com/api/cdp-agent'
const VERSION = '1.0.0'
const CONFIG_DIR = path.join(os.homedir(), '.cdp-agent')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

function loadToken() {
  if (process.env.CDP_TOKEN) return process.env.CDP_TOKEN
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).token } catch { return null }
}

function saveToken(token) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ token }, null, 2), { mode: 0o600 })
}

async function askToken() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question('请输入 Token: ', (answer) => { rl.close(); resolve(answer.trim()) })
  })
}

async function main() {
  console.log(`\n  CDP Agent v${VERSION}`)
  console.log(`  OS: ${os.platform()} ${os.arch()}`)
  console.log(`  Server: ${SERVER_URL}\n`)

  // Step 1: Get token
  let token = loadToken()
  if (!token) {
    console.log('首次使用，请输入服务器分配的 Token')
    token = await askToken()
    if (!token) { console.error('Token 不能为空'); process.exit(1) }
    saveToken(token)
    console.log('[auth] Token 已保存\n')
  } else {
    console.log('[auth] 使用已保存的 Token')
  }

  // Step 2: Connect Chrome
  console.log('[chrome] 连接 Chrome...')
  let browser
  try { browser = await connectChrome(); console.log('[chrome] 已连接') }
  catch (err) { console.error(`[chrome] 连接失败: ${err.message}`); process.exit(1) }

  // Step 3: Connect WebSocket
  console.log('[ws] 连接服务器...')
  const ws = new WsClient(SERVER_URL, token)

  ws.on('authenticated', () => {
    console.log('\n  === CDP Agent 就绪，等待任务 ===\n')
    ws.sendStatus('online', 'connected')
  })
  ws.on('auth_failed', (p) => {
    console.error(`认证失败: ${p?.reason}`)
    if (p?.reason === 'invalid') {
      try { fs.unlinkSync(CONFIG_FILE) } catch {}
      console.log('Token 无效，已清除。请重新运行并输入正确的 Token')
    }
    process.exit(1)
  })
  ws.on('task', async (taskPayload) => {
    const { task_id, task_type, target_url } = taskPayload
    console.log(`[task] 收到: ${task_type} → ${target_url || '(no url)'}`)
    ws.sendStatus('busy', 'connected')
    const start = Date.now()
    const { success, data } = await executeTask(browser, taskPayload, (p) => ws.sendTaskProgress(task_id, p))
    ws.sendTaskResult(task_id, success, data, Date.now() - start)
    ws.sendStatus('online', 'connected')
    console.log(`[task] ${success ? '完成' : '失败'} (${Date.now() - start}ms)`)
  })
  ws.connect()

  process.on('SIGINT', () => {
    console.log('\n[agent] shutting down...')
    ws.sendStatus('offline', 'disconnected')
    browser?.close().catch(() => {})
    setTimeout(() => process.exit(0), 500)
  })
}
main().catch(err => { console.error('Fatal:', err); process.exit(1) })
