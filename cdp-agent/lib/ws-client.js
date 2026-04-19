// traffic-engine/cdp-agent/lib/ws-client.js
const WebSocket = require('ws')
const EventEmitter = require('events')

class WsClient extends EventEmitter {
  constructor(serverUrl, accessToken) {
    super()
    this.serverUrl = serverUrl
    this.accessToken = accessToken
    this.ws = null
    this.reconnectDelay = 1000
    this.maxReconnectDelay = 30000
    this.connected = false
    this.userId = null
  }
  connect() {
    console.log(`[ws] connecting to ${this.serverUrl}...`)
    this.ws = new WebSocket(this.serverUrl)
    this.ws.on('open', () => {
      this.reconnectDelay = 1000
      this._send({ type: 'auth', id: 'auth_0', payload: { token: this.accessToken } })
    })
    this.ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw.toString()) } catch { return }
      if (msg.type === 'auth_ok') { this.connected = true; this.userId = msg.payload?.user_id; console.log(`[ws] authenticated as ${msg.payload?.user_name}`); this.emit('authenticated', msg.payload); return }
      if (msg.type === 'auth_fail') { console.error(`[ws] auth failed: ${msg.payload?.reason}`); this.emit('auth_failed', msg.payload); this.ws.close(); return }
      if (msg.type === 'ping') { this._send({ type: 'pong', id: msg.id, payload: {} }); return }
      if (msg.type === 'task') { this.emit('task', msg.payload); return }
    })
    this.ws.on('close', () => {
      this.connected = false
      console.log(`[ws] disconnected, reconnecting in ${this.reconnectDelay / 1000}s...`)
      setTimeout(() => this.connect(), this.reconnectDelay)
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)
    })
    this.ws.on('error', (err) => console.error(`[ws] error: ${err.message}`))
  }
  _send(msg) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg)) }
  sendStatus(s, cs) { this._send({ type: 'status', id: '', payload: { status: s, chrome_status: cs } }) }
  sendTaskResult(tid, ok, data, ms) { this._send({ type: 'task_result', id: `r_${Date.now()}`, payload: { task_id: tid, success: ok, data, duration_ms: ms } }) }
  sendTaskProgress(tid, p) { this._send({ type: 'task_progress', id: `p_${Date.now()}`, payload: { task_id: tid, ...p } }) }
}
module.exports = { WsClient }
