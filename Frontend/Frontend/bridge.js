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
const relay2Dir = path.join(storageRoot, 'node_relay_2')
const receiverDir = path.join(storageRoot, 'node_receiver')
const trafficLogPath = path.join(storageRoot, 'traffic_log.jsonl')
const receiverEndpoint = process.env.FLOWSHIELD_RECEIVER_URL || ''
const forwardedRelayFiles = new Set()
const STEP_REVEAL_DELAY_MS = 1400
const LAYER_REVEAL_DELAY_MS = 1100
const RECEIVER_REVEAL_DELAY_MS = STEP_REVEAL_DELAY_MS * 5 + LAYER_REVEAL_DELAY_MS * 3
let activeSession = null

ensureStorage()
startRelayForwarder()

app.use(cors())
app.use(express.json({ limit: '8kb' }))

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'FlowShield bridge',
    port: PORT,
    receiverEndpoint: receiverEndpoint || null,
  })
})

app.post('/api/message', (request, response) => {
  const input = typeof request.body?.message === 'string' ? request.body.message.trim() : ''

  if (!input) {
    response.status(400).json({ error: 'A non-empty message string is required.' })
    return
  }

  const fileName = `payload_${Date.now()}.txt`
  const targetPath = path.join(nodeClientDir, fileName)
  const queuedAt = Date.now()

  fs.writeFileSync(targetPath, input, 'utf8')
  activeSession = {
    message: input,
    fileName,
    queuedAt,
    revealAt: queuedAt + RECEIVER_REVEAL_DELAY_MS,
  }

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

app.get('/api/receiver/latest', (_request, response) => {
  response.json({
    ok: true,
    latest: readLatestReceiverOutput(),
    latestMessage: readLatestReceiverOutput({ preferMessage: true }),
    latestChaff: readLatestReceiverOutput({ preferChaff: true }),
  })
})

app.get('/api/session', (_request, response) => {
  const now = Date.now()
  response.json({
    ok: true,
    session: activeSession
      ? {
          ...activeSession,
          now,
          revealReady: now >= activeSession.revealAt,
        }
      : null,
  })
})

app.listen(PORT, () => {
  console.log(`[FlowShield bridge] Listening on http://localhost:${PORT}`)
  console.log(`[FlowShield bridge] Writing payload files to ${nodeClientDir}`)
  if (receiverEndpoint) {
    console.log(`[FlowShield bridge] Forwarding relay-2 PNGs to ${receiverEndpoint}`)
  } else {
    console.log('[FlowShield bridge] No remote receiver URL configured. Using local-only simulation.')
  }
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

function readLatestReceiverOutput(options = {}) {
  const { preferMessage = false, preferChaff = false } = options

  if (!fs.existsSync(receiverDir)) {
    return null
  }

  const files = fs
    .readdirSync(receiverDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.txt'))
    .filter((entry) => {
      if (preferMessage) {
        return !entry.name.startsWith('chaff_')
      }

      if (preferChaff) {
        return entry.name.startsWith('chaff_')
      }

      return true
    })
    .map((entry) => {
      const fullPath = path.join(receiverDir, entry.name)
      return {
        name: entry.name,
        path: fullPath,
        mtimeMs: fs.statSync(fullPath).mtimeMs,
      }
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs)

  if (files.length === 0) {
    return null
  }

  return {
    fileName: files[0].name,
    filePath: files[0].path,
    mtimeMs: files[0].mtimeMs,
    plaintext: fs.readFileSync(files[0].path, 'utf8'),
  }
}

function startRelayForwarder() {
  if (!receiverEndpoint) {
    return
  }

  scanAndForwardRelayFiles()
  setInterval(scanAndForwardRelayFiles, 1500)
}

function scanAndForwardRelayFiles() {
  if (!fs.existsSync(relay2Dir)) {
    return
  }

  const files = fs
    .readdirSync(relay2Dir)
    .filter((fileName) => fileName.endsWith('.png'))
    .sort((left, right) => {
      const leftTime = fs.statSync(path.join(relay2Dir, left)).mtimeMs
      const rightTime = fs.statSync(path.join(relay2Dir, right)).mtimeMs
      return leftTime - rightTime
    })

  for (const fileName of files) {
    if (forwardedRelayFiles.has(fileName)) {
      continue
    }

    const fullPath = path.join(relay2Dir, fileName)
    forwardRelayImage(fullPath, fileName).catch((error) => {
      console.error(`[FlowShield bridge] Failed to forward ${fileName}: ${error.message}`)
    })
  }
}

async function forwardRelayImage(fullPath, fileName) {
  const fileBuffer = fs.readFileSync(fullPath)
  const response = await fetch(receiverEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'x-file-name': fileName,
    },
    body: fileBuffer,
  })

  if (!response.ok) {
    throw new Error(`Receiver returned ${response.status}`)
  }

  forwardedRelayFiles.add(fileName)
  const result = await response.json()
  console.log(`[FlowShield bridge] Forwarded ${fileName} -> ${result.savedAs}`)
}
