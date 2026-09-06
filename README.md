<p align="center">
  <img src="web/public/icon-512.png" alt="Linkord" width="120" />
</p>

<h1 align="center">Linkord</h1>

<p align="center">
  Real-time chat, channels, and voice/screen calls.
</p>

<p align="center">
  <a href="https://github.com/coelhomarcus/Linkord/actions/workflows/test.yml?query=branch%3Amain">
    <img src="https://github.com/coelhomarcus/Linkord/actions/workflows/test.yml/badge.svg?branch=main" alt="CI" />
  </a>
</p>

## What it is

Self-hostable, Discord-style real-time communication platform with voice, video, text, and screen sharing. The app and its data live on your own infrastructure; media goes through a LiveKit server (LiveKit Cloud or a compatible self-hosted instance).

- Categories and multiple text/voice channels, drag-and-drop reordering (admin)
- Chat: chunked uploads (up to 2GB), automatic YouTube/Twitch/media embeds and Open Graph, reactions, replies, edit/delete messages
- Voice channels with camera and screen sharing (LiveKit)
- User directory (online/offline) and moderation panel (delete account)
- Media tab with every attachment/embed across all channels
- Per-browser preferences (call/user volume, notification volume, upload quality)
- Discord webhook notification when someone joins a call or shares their screen

## Stack

React + TypeScript + Vite + Tailwind · Node.js + Fastify + Socket.IO · PostgreSQL (Drizzle ORM) · LiveKit (WebRTC)

## Running locally

Requires Node.js 22+ and a reachable Postgres (`DATABASE_URL`).

```bash
npm ci
npm ci --prefix web
cp .env.example .env   # fill in DATABASE_URL, registration codes, LIVEKIT_*, etc.
npm run db:migrate
npm run dev             # server (watch) + web (Vite) together
```

Frontend runs on `http://localhost:5173` (proxies to the backend on `:3000`).

| Script | Does |
|---|---|
| `npm run dev` | Backend + frontend in parallel |
| `npm run build` | Compiles backend and builds frontend |
| `npm start` | Runs the compiled backend |
| `npm test` | Backend + frontend tests |
| `npm run db:generate` | Generates a migration from `server/src/db/schema.ts` |
| `npm run db:migrate` | Applies pending migrations |

## Tests

```bash
npm test              # backend + frontend
npm run test:server   # backend only
npm run test:web      # frontend only
```

Runs automatically on every push/PR to `main`/`develop` ([`.github/workflows/test.yml`](.github/workflows/test.yml)).

## Environment variables

See [`.env.example`](.env.example).

## Deploy

Image built via [`Dockerfile`](Dockerfile) (multi-stage: builds frontend, compiles backend, lean runtime). Production runs on [Dokploy](https://dokploy.com); set `TRUST_PROXY=1` there (keep `0` when directly exposed).

```bash
cp .env.example .env
docker compose up -d --build
```

Attachments persist in `./uploads`, database in the `postgres-data` volume. On Linux, ensure UID 1000 can write to an existing `./uploads` folder before starting.

## License

[MIT](LICENSE)
