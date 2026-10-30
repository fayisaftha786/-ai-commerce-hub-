# Private backend starter

This repository includes a small Node.js HTTP server as a foundation for future provider integrations. It is separate from the static GitHub Pages frontend.

## Run locally

Requires Node.js 24 or a compatible modern release.

```sh
npm start
```

In development the server listens on `127.0.0.1:3000`. Open:

- `http://127.0.0.1:3000/health`
- `http://127.0.0.1:3000/api/social/providers`

## Hosting configuration

The server reads the port from the host-provided `PORT` environment variable (default: `3000`). When `NODE_ENV=production`, it binds to `0.0.0.0` so a container or platform router can reach it. Set `HOST` explicitly to override the bind address. For local-only development, leave `NODE_ENV` unset or set `HOST=127.0.0.1`.

Example production environment:

```text
NODE_ENV=production
PORT=<port supplied by the hosting platform>
```

Do not commit secrets or place them in the GitHub Pages bundle. Configure provider credentials only as private environment variables on a separately hosted backend, after the provider has approved the app and the intended API use.

## Current API boundary

- `GET /health` confirms that this small HTTP process is responding.
- `GET /api/social/providers` reports whether the expected server-side configuration variables are present. It never returns their values.
- Other routes return JSON 404; non-GET methods return 405.
- OAuth authorization, callback validation, token exchange, encrypted token storage, account linking, publishing, disconnect/revocation and CORS are **not implemented**.
- The static GitHub Pages app does not call this backend yet. A later integration must use an explicit HTTPS origin and a strict CORS allow-list or same-origin reverse proxy.

The health route intentionally returns `oauthImplemented: false`. A running server or configured environment variables must never be presented as a connected social account.
