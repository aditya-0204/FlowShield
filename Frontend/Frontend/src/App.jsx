import { startTransition, useDeferredValue, useEffect, useState } from 'react'

const API_BASE = 'http://localhost:5050/api'

const stageStyles = {
  message: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100',
  chaff: 'border-amber-500/40 bg-amber-500/10 text-amber-100',
  morphed: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100',
  error: 'border-rose-500/40 bg-rose-500/10 text-rose-100',
}

const pipelineStages = [
  { key: 'sender', label: 'Sender', description: 'User enters plaintext in the terminal UI.' },
  { key: 'bridge', label: 'Bridge', description: 'bridge.js writes the payload into node_client.' },
  { key: 'crypto', label: '3 Onion Layers', description: 'AES-256-GCM wraps the message into 3 layers.' },
  { key: 'relay1', label: 'Relay 1', description: 'First morphed PNG carries the hidden onion.' },
  { key: 'relay2', label: 'Relay 2', description: 'Second morphed PNG forwards the hidden payload.' },
  { key: 'receiver', label: 'Receiver', description: 'Receiver extracts, peels, and recovers plaintext.' },
]

function getEntryText(entry) {
  return `${entry.stage ?? ''} ${entry.detail ?? ''} ${entry.file ?? ''}`.toLowerCase()
}

function buildStepState(entries, queuedMessage) {
  const state = {
    sender: { active: Boolean(queuedMessage), detail: queuedMessage ? `Plaintext queued: "${queuedMessage}"` : 'Waiting for a user payload.' },
    bridge: { active: false, detail: 'No payload file has been staged yet.' },
    crypto: { active: false, detail: 'Encryption has not started yet.' },
    relay1: { active: false, detail: 'No relay-1 PNG has been written yet.' },
    relay2: { active: false, detail: 'No relay-2 PNG has been written yet.' },
    receiver: { active: false, detail: 'Receiver has not recovered plaintext yet.' },
  }

  entries.forEach((entry) => {
    const text = getEntryText(entry)

    if (text.includes('payload_') || text.includes('frontend payload file')) {
      state.bridge = {
        active: true,
        detail: payloadFileName(entry) ? `Payload staged as ${payloadFileName(entry)}` : entry.detail,
      }
    }

    if (entry.stage === 'Crypto' || entry.stage?.startsWith('Layer ')) {
      state.crypto = {
        active: true,
        detail: entry.detail,
      }
    }

    if (text.includes('relay1') || text.includes('relay 1') || text.includes('node_relay_1')) {
      state.relay1 = {
        active: true,
        detail: outputFileName(entry) ? `Hidden onion stored in ${outputFileName(entry)}` : entry.detail,
      }
    }

    if (text.includes('relay2') || text.includes('relay 2') || text.includes('node_relay_2')) {
      state.relay2 = {
        active: true,
        detail: outputFileName(entry) ? `Forwarded onion stored in ${outputFileName(entry)}` : entry.detail,
      }
    }

    if (entry.stage === 'Receiver') {
      state.receiver = {
        active: true,
        detail: outputFileName(entry) ? `Recovered output: ${outputFileName(entry)}` : entry.detail,
      }
    }
  })

  return state
}

function extractFileName(filePath) {
  if (!filePath) {
    return ''
  }

  return filePath.split(/[\\/]/).pop() || ''
}

function payloadFileName(entry) {
  const fromFile = extractFileName(entry.file)
  if (fromFile) {
    return fromFile
  }

  const match = entry.detail?.match(/payload_[\w.-]+\.txt/i)
  return match ? match[0] : ''
}

function outputFileName(entry) {
  return extractFileName(entry.file)
}

function App() {
  const [message, setMessage] = useState('Hi Aditya')
  const [lastQueuedMessage, setLastQueuedMessage] = useState(() => window.localStorage.getItem('flowshield-last-message') || '')
  const [logs, setLogs] = useState([])
  const [status, setStatus] = useState('Bridge idle. Waiting for a payload or the next heartbeat.')
  const [isSending, setIsSending] = useState(false)
  const deferredLogs = useDeferredValue(logs)

  useEffect(() => {
    let active = true

    const loadTraffic = async () => {
      try {
        const response = await fetch(`${API_BASE}/traffic`)
        if (!response.ok) {
          throw new Error(`Traffic log request failed: ${response.status}`)
        }

        const data = await response.json()
        if (!active) {
          return
        }

        startTransition(() => {
          setLogs(Array.isArray(data.events) ? data.events : [])
        })
      } catch (error) {
        if (active) {
          setStatus(error.message)
        }
      }
    }

    loadTraffic()
    const intervalId = window.setInterval(loadTraffic, 1500)

    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    const trimmed = message.trim()
    if (!trimmed) {
      setStatus('Enter a payload before dispatching it through FlowShield.')
      return
    }

    setIsSending(true)
    setStatus('Dispatching payload to the bridge and staging it in node_client...')

    try {
      const response = await fetch(`${API_BASE}/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: trimmed }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Bridge rejected the payload.')
      }

      setStatus(`Queued ${data.fileName}. The backend watcher will pick it up on the next 1.5s heartbeat.`)
      setLastQueuedMessage(trimmed)
      window.localStorage.setItem('flowshield-last-message', trimmed)
      setMessage('')
    } catch (error) {
      setStatus(error.message)
    } finally {
      setIsSending(false)
    }
  }

  const messageCount = deferredLogs.filter((entry) => entry.type === 'message').length
  const chaffCount = deferredLogs.filter((entry) => entry.type === 'chaff').length
  const recentMessageEvents = deferredLogs
    .filter((entry) => entry.type === 'message' || entry.type === 'morphed')
    .slice(-16)
  const stepState = buildStepState(recentMessageEvents, lastQueuedMessage)
  const receiverEntry = [...recentMessageEvents].reverse().find((entry) => entry.stage === 'Receiver' && entry.file?.endsWith('.txt'))

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_40%),linear-gradient(180deg,#08111f_0%,#02060d_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/70 shadow-[0_0_80px_rgba(8,145,178,0.18)] backdrop-blur">
          <div className="border-b border-white/10 px-6 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-cyan-300/70">FlowShield Terminal</p>
                <h1 className="mt-2 font-mono text-3xl font-semibold text-white sm:text-4xl">Asynchronous Steganographic Onion Router</h1>
              </div>
              <div className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 font-mono text-xs text-emerald-200">
                HEARTBEAT 1.5s / TFC ACTIVE
              </div>
            </div>
          </div>

          <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
              <p className="font-mono text-xs uppercase tracking-[0.3em] text-slate-400">Payload Injection</p>
              <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
                <label className="block">
                  <span className="mb-2 block font-mono text-sm text-slate-300">Message</span>
                  <textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    rows={5}
                    placeholder="Write the payload that should be wrapped in 3 AES-256-GCM onion layers..."
                    className="w-full rounded-2xl border border-cyan-500/20 bg-slate-950/90 px-4 py-3 font-mono text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                  />
                </label>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    disabled={isSending}
                    className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-5 py-2.5 font-mono text-sm text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSending ? 'Dispatching...' : 'Dispatch To node_client'}
                  </button>
                  <div className="font-mono text-xs text-slate-400">
                    Frontend -&gt; bridge.js -&gt; Storage_system/node_client -&gt; C++ watcher
                  </div>
                </div>
              </form>
            </section>

            <section className="grid gap-4">
              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
                <p className="font-mono text-xs uppercase tracking-[0.3em] text-slate-400">Network State</p>
                <p className="mt-4 font-mono text-sm leading-7 text-slate-200">{status}</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
                  <p className="font-mono text-xs uppercase tracking-[0.3em] text-slate-400">Real Payload Events</p>
                  <p className="mt-4 font-mono text-4xl text-cyan-200">{messageCount}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
                  <p className="font-mono text-xs uppercase tracking-[0.3em] text-slate-400">Chaff Heartbeats</p>
                  <p className="mt-4 font-mono text-4xl text-amber-200">{chaffCount}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
                <p className="font-mono text-xs uppercase tracking-[0.3em] text-slate-400">Onion Route</p>
                <div className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-4">
                  <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3 font-mono">node_client<br />AES-256-GCM x3</div>
                  <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3 font-mono">node_relay_1<br />morphed_relay1.png</div>
                  <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3 font-mono">node_relay_2<br />morphed_relay2.png</div>
                  <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3 font-mono">node_receiver<br />plaintext recovery</div>
                </div>
              </div>
            </section>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-950/75 p-6 shadow-[0_0_60px_rgba(15,23,42,0.45)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.35em] text-slate-400">Message Visualization</p>
              <h2 className="mt-2 font-mono text-2xl text-white">Sender to receiver pipeline</h2>
            </div>
            <div className="font-mono text-xs text-slate-500">
              {lastQueuedMessage ? `Tracking latest plaintext: "${lastQueuedMessage}"` : 'Send a message to watch each step light up.'}
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-6">
            {pipelineStages.map((step, index) => {
              const stepInfo = stepState[step.key]
              const active = Boolean(stepInfo?.active)

              return (
                <div
                  key={step.key}
                  className={`relative rounded-2xl border p-4 transition ${
                    active
                      ? 'border-cyan-400/50 bg-cyan-400/10 shadow-[0_0_30px_rgba(34,211,238,0.12)]'
                      : 'border-white/10 bg-slate-900/50'
                  }`}
                >
                  {index < pipelineStages.length - 1 ? (
                    <div className="absolute -right-3 top-1/2 hidden h-px w-6 -translate-y-1/2 bg-gradient-to-r from-cyan-400/60 to-transparent lg:block" />
                  ) : null}
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-mono text-[11px] uppercase tracking-[0.28em] ${active ? 'text-cyan-200' : 'text-slate-500'}`}>
                      Step {index + 1}
                    </span>
                    <span className={`h-2.5 w-2.5 rounded-full ${active ? 'bg-cyan-300 shadow-[0_0_14px_rgba(103,232,249,0.75)]' : 'bg-slate-700'}`} />
                  </div>
                  <h3 className="mt-3 font-mono text-lg text-white">{step.label}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{step.description}</p>
                  <p className={`mt-3 font-mono text-xs leading-5 ${active ? 'text-cyan-100' : 'text-slate-500'}`}>
                    {stepInfo?.detail}
                  </p>
                </div>
              )
            })}
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
              <p className="font-mono text-xs uppercase tracking-[0.3em] text-slate-400">Payload Transformation</p>
              <div className="mt-4 grid gap-3">
                <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
                  <p className="font-mono text-xs uppercase tracking-[0.24em] text-slate-500">Sender Plaintext</p>
                  <p className="mt-2 break-all font-mono text-sm text-cyan-100">{lastQueuedMessage || 'Awaiting sender input...'}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
                  <p className="font-mono text-xs uppercase tracking-[0.24em] text-slate-500">Onion Transit</p>
                  <p className="mt-2 font-mono text-sm text-emerald-100">
                    {stepState.crypto.active
                      ? 'Plaintext sealed -> AES-GCM layer 1 -> layer 2 -> layer 3 -> hidden in PNG pixels'
                      : 'No active encrypted onion yet.'}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
                  <p className="font-mono text-xs uppercase tracking-[0.24em] text-slate-500">Receiver Plaintext</p>
                  <p className="mt-2 break-all font-mono text-sm text-amber-100">
                    {receiverEntry ? receiverEntry.detail : 'Receiver output will appear here after extraction and decryption.'}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
              <p className="font-mono text-xs uppercase tracking-[0.3em] text-slate-400">Latest Message Steps</p>
              <div className="mt-4 grid gap-3">
                {recentMessageEvents.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/10 bg-slate-950/50 p-4 font-mono text-sm text-slate-500">
                    No real-message events yet. Dispatch a message to animate the route.
                  </div>
                ) : (
                  recentMessageEvents.map((entry, index) => (
                    <div key={`${entry.timestamp}-${entry.stage}-${index}`} className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-mono text-xs uppercase tracking-[0.24em] text-slate-400">{entry.stage}</p>
                        <p className="font-mono text-[11px] text-slate-500">{entry.timestamp}</p>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-200">{entry.detail}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-950/75 p-6 shadow-[0_0_60px_rgba(15,23,42,0.45)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.35em] text-slate-400">Live Traffic Log</p>
              <h2 className="mt-2 font-mono text-2xl text-white">Onion sealing, relay forwarding, and constant-rate chaff</h2>
            </div>
            <div className="font-mono text-xs text-slate-500">Polling bridge every 1500ms</div>
          </div>

          <div className="mt-6 grid max-h-[34rem] gap-3 overflow-y-auto pr-1">
            {deferredLogs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/40 px-4 py-6 font-mono text-sm text-slate-500">
                No events yet. Start the bridge and the backend engine, then dispatch a payload.
              </div>
            ) : (
              deferredLogs
                .slice()
                .reverse()
                .map((entry, index) => (
                  <article
                    key={`${entry.timestamp}-${entry.stage}-${index}`}
                    className={`rounded-2xl border px-4 py-4 font-mono text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${stageStyles[entry.type] || 'border-white/10 bg-slate-900/50 text-slate-100'}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-xs uppercase tracking-[0.28em] text-white/60">{entry.stage}</div>
                      <div className="text-xs text-white/50">{entry.timestamp}</div>
                    </div>
                    <p className="mt-3 leading-6">{entry.detail}</p>
                    {entry.file ? (
                      <p className="mt-3 text-xs text-white/45">{entry.file}</p>
                    ) : null}
                  </article>
                ))
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

export default App
