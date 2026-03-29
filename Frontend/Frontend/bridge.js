import cors from 'cors'
import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = 5050
const storageRoot = path.resolve(__dirname, '..', '..', 'Storage_system')
const nodeClientDir = path.join(storageRoot, 'node_client')
const trafficLogPath = path.join(storageRoot, 'traffic_log.jsonl')

ensureStorage()

app.use(cors())
app.use(express.json({ limit: '8kb' }))

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, service: 'FlowShield bridge', port: PORT })
})

app.post('/api/message', (request, response) => {
  const input = typeof request.body?.message === 'string' ? request.body.message.trim() : ''

  if (!input) {
    response.status(400).json({ error: 'A non-empty message string is required.' })
    return
  }

  const fileName = `payload_${Date.now()}.txt`
  const targetPath = path.join(nodeClientDir, fileName)

  fs.writeFileSync(targetPath, input, 'utf8')

  response.status(201).json({
    ok: true,
    fileName,
    savedTo: targetPath,
  })
})

app.get('/api/traffic', (_request, response) => {
  const events = readTrafficEvents()
  response.json({
    ok: true,
    events,
  })
})

app.listen(PORT, () => {
  console.log(`[FlowShield bridge] Listening on http://localhost:${PORT}`)
  console.log(`[FlowShield bridge] Writing payload files to ${nodeClientDir}`)
})

function ensureStorage() {
  fs.mkdirSync(nodeClientDir, { recursive: true })
  fs.mkdirSync(path.join(storageRoot, 'node_relay_1'), { recursive: true })
  fs.mkdirSync(path.join(storageRoot, 'node_relay_2'), { recursive: true })
  fs.mkdirSync(path.join(storageRoot, 'node_receiver'), { recursive: true })

  if (!fs.existsSync(trafficLogPath)) {
    fs.writeFileSync(trafficLogPath, '', 'utf8')
  }
}

function readTrafficEvents() {
  if (!fs.existsSync(trafficLogPath)) {
    return []
  }

  const content = fs.readFileSync(trafficLogPath, 'utf8').trim()
  if (!content) {
    return []
  }

  return content
    .split(/\r?\n/)
    .slice(-80)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}
