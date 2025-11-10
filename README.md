# Parkour Tag (Render + Socket.IO + React Three Fiber)

A complete first-person multiplayer Parkour Tag prototype with:
- Momentum-based FP movement (sprint, jump, slide, wall run, wall jump, mantle).
- Camera effects (FOV shift by speed, roll tilt when wall running).
- Server-authoritative physics and tag rules.
- A compact vertical **"Parkour Yard"** map.
- Render `render.yaml` for one static client and one Node server.

## Local development

```bash
npm install
npm install --workspace client
npm install --workspace server
npm run dev
```
- Client: http://localhost:5173
- Server: http://localhost:3000

You can override the server URL for the client in dev:
```bash
export VITE_SERVER_URL=http://localhost:3000
```

### Optional: HDRI Environment

You can replace the gradient skybox with a high‑dynamic‑range image for image‑based lighting (IBL).

1. Place an HDR file (e.g. `studio.hdr`) into `client/public/` or host it at a URL.
2. Set the env var before building:
	```bash
	export VITE_HDRI=/studio.hdr          # if in public/
	# or an absolute URL:
	export VITE_HDRI=https://example.com/hdr/studio.hdr
	```
3. Rebuild the client: `npm run build --workspace=client`.

At runtime, if `VITE_HDRI` is defined the app loads it via `EnvironmentHDRI` (PMREM filtered) and assigns it to `scene.environment` + `scene.background` for better lighting and reflections.

If the HDR fails to load, it falls back to the existing procedural skybox without crashing.
```

## Controls

- **Mouse**: look
- **WASD**: move
- **Space**: jump (and wall jump)
- **Shift**: sprint (build momentum)
- **Ctrl**: slide (while fast on ground)
- **Esc**: release mouse

## Tag Rules

- One player is **IT** at a time. When IT touches someone (proximity), the other becomes IT after a short cooldown.
- Rounds are timed. Survivors score over time; IT scores on successful tags.
- Host starts the round from the lobby.

> This is a prototype aimed at clarity. For production, add reconciliation, lag compensation, anti-cheat validation, and map loading from files.
