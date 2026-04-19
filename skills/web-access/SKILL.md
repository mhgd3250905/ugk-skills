---
name: web-access
description: Use this skill for web browsing, logged-in websites, social platforms, dynamic pages, screenshots, downloads, and any task that needs a real browser session.
allowed-tools: Bash
---

# web-access

Use this skill as the single external entry point whenever a task needs web access. Do not present `WebSearch`, `WebFetch`, `curl`, Jina, raw CDP, host IPC, or Docker sidecar as choices for the agent to pick manually.

## Routing Model

Use staged routing:

- `S1`: static public access through `WebSearch`, `WebFetch`, or `curl`
- `S2`: Jina reader
- `S3`: real browser automation through this project's browser bridge

Move from a lower stage to a higher stage only after a current-round failure is confirmed. Current-round failures include fetch errors, empty or irrelevant results, login walls, anti-bot blocking, missing dynamic content, incomplete screenshots, or content that requires cookies.

Historical route cache may influence the starting stage. It must not override current evidence. If the chosen stage fails in this round, upgrade.

## Browser Architecture

Primary path for Docker and Linux:

```text
agent / skill
  -> requestHostBrowser()
  -> WEB_ACCESS_BROWSER_PROVIDER=direct_cdp
  -> LocalCdpBrowser
  -> http://172.31.250.10:9223
  -> Docker Chrome sidecar
```

Legacy fallback for Windows host development only:

```text
agent / skill
  -> requestHostBrowser()
  -> .data/browser-ipc
  -> host-browser-bridge-daemon.mjs
  -> Windows Chrome CDP
```

The function name `requestHostBrowser()` is legacy. In Docker sidecar mode it does not mean "use Windows host IPC"; it dispatches directly to the sidecar CDP backend before IPC is attempted.

## Startup

Always start with:

```bash
node /app/runtime/skills-user/web-access/scripts/check-deps.mjs
```

If you are debugging from the Windows project directory instead of the `/app` container, use:

```bash
node runtime/skills-user/web-access/scripts/check-deps.mjs
```

Expected healthy output in Docker sidecar mode:

```text
host-browser: ok (http://172.31.250.10:9223)
proxy: ready (127.0.0.1:3456)
```

The `host-browser` label is kept for compatibility with older scripts. In sidecar mode it means "browser backend is reachable", not "Windows host IPC is active".

Use these project-level sidecar commands from the repository root:

```bash
npm run docker:chrome:check
npm run docker:chrome:status
npm run docker:chrome:open
npm run docker:chrome:restart
```

Use `docker:chrome:restart` only when Chrome itself needs a kick. It keeps the persistent profile but clears stale Chrome locks and crash-restore prompt state.

## Legacy Host IPC Fallback

Only use the Windows host IPC bridge when sidecar mode is not configured or when explicitly debugging the legacy Windows path.

The legacy launcher is:

```bash
powershell -ExecutionPolicy Bypass -File .\scripts\start-web-access-browser.ps1
```

Do not tell a Docker sidecar user to start this launcher just because Chrome is unavailable. If `WEB_ACCESS_BROWSER_PROVIDER=direct_cdp` is set, first check the sidecar services and CDP endpoint.

## Sidecar Login And Profile

Sidecar facts:

- GUI login entrypoint: `https://127.0.0.1:3901/`
- CDP endpoint inside compose: `http://172.31.250.10:9223`
- Persistent profile on the host: `.data/chrome-sidecar`
- Chrome profile inside the sidecar container: `${WEB_ACCESS_BROWSER_PROFILE_DIR:-/config/chrome-profile-sidecar}`
- Browser-reachable app base URL: `WEB_ACCESS_BROWSER_PUBLIC_BASE_URL=http://ugk-pi:3000`

Manual login and automation must use the same profile path. Do not split manual login and auto-start across different profile directories.

Chrome must stay on `DISPLAY=:0` with `--ozone-platform=x11`. Do not switch it back to Wayland unless Chrome top-layer UI clicks are revalidated.

## Local Artifact URLs

Container workspace paths such as `/app/runtime/...`, `/app/public/...`, and `file:///app/...` are valid internal artifact inputs for this skill.

The browser bridge resolves supported local artifacts to an HTTP URL before Chrome opens them:

```text
/app/runtime/report.html
  -> http://ugk-pi:3000/v1/local-file?path=%2Fapp%2Fruntime%2Freport.html
```

Keep these two URL bases separate:

- `PUBLIC_BASE_URL`: user-visible links, such as `http://127.0.0.1:3000` locally or a public domain in production
- `WEB_ACCESS_BROWSER_PUBLIC_BASE_URL`: browser-automation links inside the compose network, normally `http://ugk-pi:3000`

Do not make sidecar Chrome open `http://127.0.0.1:3000/...`. Inside the browser container that points at the browser container itself, not the `ugk-pi` app.

Do not make sidecar Chrome open `file:///app/...`. The sidecar is a different container and does not own the app container's filesystem view.

Only in the final user-facing answer should you avoid raw container paths. For user delivery, return the `PUBLIC_BASE_URL`-reachable link or use `send_file`.

## Local Proxy API

When `check-deps.mjs` passes, a compatibility proxy is available at `http://127.0.0.1:3456` inside the app container.

Common endpoints:

```bash
curl -s http://127.0.0.1:3456/health
curl -s http://127.0.0.1:3456/targets
curl -s "http://127.0.0.1:3456/new?url=https%3A%2F%2Fexample.com"
curl -s "http://127.0.0.1:3456/session/target?metaAgentScope=${AGENT_SCOPE}"
curl -s -X POST "http://127.0.0.1:3456/session/target?target=ID&metaAgentScope=${AGENT_SCOPE}"
curl -s -X DELETE "http://127.0.0.1:3456/session/target?metaAgentScope=${AGENT_SCOPE}"
curl -s -X POST "http://127.0.0.1:3456/session/close-all?metaAgentScope=${AGENT_SCOPE}"
curl -s "http://127.0.0.1:3456/info?target=ID"
curl -s -X POST "http://127.0.0.1:3456/eval?target=ID" -d 'document.title'
curl -s "http://127.0.0.1:3456/navigate?target=ID&url=https%3A%2F%2Fexample.com"
curl -s -X POST "http://127.0.0.1:3456/click?target=ID" -d 'button.submit'
curl -s "http://127.0.0.1:3456/scroll?target=ID&direction=bottom"
curl -s "http://127.0.0.1:3456/screenshot?target=ID&file=/tmp/page.png"
curl -s "http://127.0.0.1:3456/close?target=ID"
```

When passing a nested URL into `/new` or `/navigate`, URL-encode it first. Otherwise query params inside the target URL can be mistaken for proxy params.

## Working Style

Define the current agent scope once when browser work may span multiple commands:

```bash
AGENT_SCOPE="${CLAUDE_AGENT_ID:-${CLAUDE_HOOK_AGENT_ID:-${agent_id:-}}}"
```

Use that scope on proxy requests with `metaAgentScope=${AGENT_SCOPE}` so the proxy can reuse the current agent-owned target instead of competing for a shared page.

For a concrete URL, prefer the automatic runner:

```bash
node /app/runtime/skills-user/web-access/scripts/staged-route-cli.mjs run-url --url "https://example.com" --task-kind "open_page"
```

Only use `recommend` or `report` for manual route debugging.

Prefer `eval` for extraction. Open your own target with `/new`. Close targets you created unless you intentionally keep an agent-owned page alive for follow-up work.
