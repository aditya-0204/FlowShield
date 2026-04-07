# FlowShield Frontend

FlowShield is a React + Vite dashboard for demonstrating an asynchronous steganographic onion-routing pipeline. This frontend lets a sender queue plaintext, visualizes each step of the route, polls the bridge service for live traffic updates, and exposes a dedicated receiver view for synchronized message reveal.

## What This Frontend Does

- Sends plaintext messages to the local bridge API.
- Visualizes the route from `node_client` to `node_receiver`.
- Displays message events and chaff heartbeat traffic from `traffic_log.jsonl`.
- Shows onion-layer progress for a 3-layer AES-256-GCM flow.
- Includes a receiver mode for monitoring decrypted outputs.

## Project Structure

```text
Frontend/Frontend/
|-- src/
|   |-- App.jsx               # Sender + receiver dashboard UI
|   |-- main.jsx              # React entry point
|   |-- App.css
|   `-- index.css
|-- bridge.js                 # Express bridge API on port 5050
|-- receiver-server.js        # Receiver service for remote PNG delivery
|-- receiver-dashboard.html   # Minimal HTML page for receiver server
|-- package.json
`-- README.md
```

This frontend also reads and writes files in the shared `Storage_system` folder:

- `Storage_system/node_client`
- `Storage_system/node_relay_1`
- `Storage_system/node_relay_2`
- `Storage_system/node_receiver`
- `Storage_system/traffic_log.jsonl`

## Prerequisites

- Node.js 18+ recommended
- npm
- The FlowShield backend executable available at `Backend/flowshield.exe` for full receiver processing

## Available Scripts

- `npm run dev` starts the Vite frontend
- `npm run build` builds the production bundle
- `npm run preview` previews the production build
- `npm run lint` runs ESLint
- `npm run bridge` starts the local bridge API on port `5050`
- `npm run receiver` starts the receiver server on port `6060` by default

## Local Development

Run these commands from `Frontend/Frontend` in separate terminals:

```bash
npm install
npm run bridge
npm run dev
```

Then open the Vite app in your browser. The UI talks to:

- `http://localhost:5050/api/message`
- `http://localhost:5050/api/traffic`
- `http://localhost:5050/api/receiver/latest`
- `http://localhost:5050/api/session`

## Receiver Mode

To simulate or host the receiver side, run:

```bash
npm run receiver
```

The receiver service:

- accepts relay-2 PNG files over HTTP
- saves them into `Storage_system/remote_receiver_inbox`
- invokes `Backend/flowshield.exe`
- exposes status endpoints such as `/api/health` and `/api/latest`

If you want the bridge to forward relay-2 images to a remote receiver, set:

```bash
FLOWSHIELD_RECEIVER_URL=http://<receiver-host>:6060/api/receive-stego
```

## Flow Overview

1. The sender enters plaintext in the React UI.
2. `bridge.js` writes a `payload_<timestamp>.txt` file into `Storage_system/node_client`.
3. The backend watcher picks up the payload and wraps it in 3 onion-encrypted layers.
4. The encrypted payload is hidden inside relay PNGs in `node_relay_1` and `node_relay_2`.
5. The receiver extracts and decrypts the payload into `node_receiver`.
6. The frontend polls the bridge every 1.5 seconds to animate the pipeline and update the receiver view.

## Screeshots 

### Dashboard Overview

![FlowShield dashboard overview](Frontend/Frontend/image.png)

### Additional Screenshots

Add the remaining two screenshots to the repository and reference them here, for example:

```md
![FlowShield pipeline view](docs/screenshots/pipeline-view.png)
![FlowShield traffic log view](docs/screenshots/traffic-log-view.png)
```
