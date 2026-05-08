// traffic-engine/cdp-agent/lib/image-generator.js
const fs = require('fs')
const path = require('path')
const https = require('https')

const DASHSCOPE_KEY = 'sk-080e5440ca9a4d77b363099f1a4ff6f9'

function httpsRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: () => JSON.parse(data), text: () => data, buffer: () => Buffer.from(data) })
        } catch (e) {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: () => ({}), text: () => data, buffer: () => Buffer.from(data) })
        }
      })
    })
    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

async function generateImage(prompt) {
  try {
    console.log('[image-gen] 使用通义万相生成图片...')

    const res = await httpsRequest('https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DASHSCOPE_KEY}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable'
      },
      body: JSON.stringify({
        model: 'wanx2.1-t2i-turbo',
        input: { prompt },
        parameters: { size: '768*1024' }
      })
    })

    if (!res.ok) {
      console.error('[image-gen] 请求失败:', await res.text())
      return null
    }

    const data = await res.json()
    const taskId = data.output?.task_id

    if (!taskId) {
      console.error('[image-gen] 未获取到任务ID')
      return null
    }

    // 轮询任务状态
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000))

      const statusRes = await httpsRequest(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
        headers: { 'Authorization': `Bearer ${DASHSCOPE_KEY}` }
      })

      const status = await statusRes.json()

      if (status.output?.task_status === 'SUCCEEDED' && status.output?.results?.[0]?.url) {
        const imageUrl = status.output.results[0].url
        console.log('[image-gen] 生成成功:', imageUrl)

        // 下载图片
        const imgRes = await httpsRequest(imageUrl)
        const buffer = await imgRes.buffer()

        const tmpPath = path.join('/tmp', `xhs_${Date.now()}.png`)
        fs.writeFileSync(tmpPath, buffer)

        return tmpPath
      }

      if (status.output?.task_status === 'FAILED') {
        console.error('[image-gen] 生成失败:', status.output?.message)
        return null
      }
    }

    console.error('[image-gen] 超时')
    return null
  } catch (err) {
    console.error('[image-gen] 错误:', err.message)
    return null
  }
}

module.exports = { generateImage }
