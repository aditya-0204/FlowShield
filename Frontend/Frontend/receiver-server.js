import cors from 'cors'
import express from 'express'
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = Number(process.env.FLOWSHIELD_RECEIVER_PORT || 6060)
const storageRoot = path.resolve(__dirname, '..', '..', 'Storage_system')
const receiverInboxDir = path.join(storageRoot, 'remote_receiver_inbox')
const receiverOutputDir = path.join(storageRoot, 'node_receiver')
const trafficLogPath = path.join(storageRoot, 'traffic_log.jsonl')
const backendExecutable = path.resolve(__dirname, '..', '..', 'Backend', process.platform === 'win32' ? 'flowshield.exe' : 'flowshield')

ensureStorage()

app.use(cors())
app.use(express.raw({ type: 'application/octet-stream', limit: '25mb' }))

app.get('/', (_request, response) => {
  response.sendFile(path.join(__dirname, 'receiver-dashboard.html'))
})

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'FlowShield receiver',
    port: PORT,
    backendExecutable,
  })
})

app.get('/api/latest', (_request, response) => {
  response.json({
    ok: true,
    latestPlaintext: readLatestPlaintext(),
    latestTraffic: readLatestTrafficEvents(),
  })
})

app.post('/api/receive-stego', async (request, response) => {
  try {
    const inputBuffer = request.body
    if (!Buffer.isBuffer(inputBuffer) || inputBuffer.length === 0) {
      response.status(400).json({ error: 'Binary PNG payload is required.' })
      return
    }

    const incomingName = sanitizeFileName(request.header('x-file-name')) || `relay2_${Date.now()}.png`
    const savedPath = path.join(receiverInboxDir, incomingName)
    fs.writeFileSync(savedPath, inputBuffer)

    const prefix = incomingName.includes('chaff') ? 'chaff' : 'morphed'
    const receiverOutput = await runReceiverProcess(savedPath, prefix)

    response.status(201).json({
      ok: true,
      savedAs: savedPath,
      receiverOutput,
    })
  } catch (error) {
    response.status(500).json({ error: error.message })
  }
})

app.listen(PORT, () => {
  console.log(`[FlowShield receiver] Listening on http://0.0.0.0:${PORT}`)
  console.log(`[FlowShield receiver] Backend executable expected at ${backendExecutable}`)
})

function ensureStorage() {
  fs.mkdirSync(receiverInboxDir, { recursive: true })
  fs.mkdirSync(receiverOutputDir, { recursive: true })
  if (!fs.existsSync(trafficLogPath)) {
    fs.writeFileSync(trafficLogPath, '', 'utf8')
  }
}

function sanitizeFileName(fileName) {
  return (fileName || '').replace(/[^a-zA-Z0-9._-]/g, '_')
}

function runReceiverProcess(savedPath, prefix) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(backendExecutable)) {
      reject(new Error(`Backend executable not found at ${backendExecutable}. Compile the backend on the receiver machine first.`))
      return
    }

    const child = spawn(backendExecutable, ['receive', savedPath, prefix], {
      cwd: path.dirname(backendExecutable),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => reject(error))
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Receiver backend exited with code ${code}`))
        return
      }

      const latest = readLatestPlaintext()
      resolve(latest?.file || '')
    })
  })
}

function readLatestPlaintext() {
  const files = fs
    .readdirSync(receiverOutputDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.txt'))
    .map((entry) => {
      const fullPath = path.join(receiverOutputDir, entry.name)
      return {
        file: fullPath,
        name: entry.name,
        mtimeMs: fs.statSync(fullPath).mtimeMs,
      }
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs)

  if (files.length === 0) {
    return null
  }

  return {
    file: files[0].file,
    name: files[0].name,
    plaintext: fs.readFileSync(files[0].file, 'utf8'),
  }
}

function readLatestTrafficEvents() {
  const content = fs.readFileSync(trafficLogPath, 'utf8').trim()
  if (!content) {
    return []
  }

  return content
    .split(/\r?\n/)
    .slice(-20)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}
