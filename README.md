<p align="center">
  <img src="web/public/icon-512.png" alt="Linkord" width="120" />
</p>

<h1 align="center">Linkord</h1>

<p align="center">
  Chat em tempo real, canais e chamadas de voz/tela.
</p>

## O que é

Linkord é uma plataforma de comunicação em tempo real com chamadas de voz, vídeo, texto e compartilhamento de tela.

- Chat por canal
- Anexos (upload em chunks, até 2GB)
- Embeds automáticos de YouTube/Twitch/mídia direta e Open Graph
- Canal de voz com câmera e tela compartilhada (LiveKit)
- Painel de moderação
- Aba de mídias
- Notificação no Discord quando alguém entra na chamada ou compartilha tela (Webhook)

## Stack

- **Frontend**: React + TypeScript + Vite, Tailwind
- **Backend**: Node.js + TypeScript (ESM), sem framework HTTP — `http` puro + Socket.IO
- **Banco**: PostgreSQL via Drizzle ORM
- **Vídeo/áudio**: LiveKit Cloud (WebRTC)

## Rodando localmente

Requer Node.js 22+ e um Postgres acessível (`DATABASE_URL`).

```bash
npm install
cp .env.example .env   # preencha DATABASE_URL, LIVEKIT_*, etc.
npm run db:migrate
npm run dev             # server (watch) + web (Vite) juntos
```

O frontend sobe em `http://localhost:5173` (proxy pro backend em `:3000`).

### Scripts principais

| Script | O que faz |
|---|---|
| `npm run dev` | Backend (`tsx --watch`) + frontend (Vite) em paralelo |
| `npm run build` | Compila o backend (`tsc`) e builda o frontend (`vite build`) |
| `npm start` | Roda o backend já compilado (`server/dist/index.js`) |
| `npm test` | Testes do backend (`node --test`) e do frontend (`vitest`) |
| `npm run db:generate` | Gera uma migration nova a partir de `server/src/db/schema.ts` |
| `npm run db:migrate` | Aplica as migrations pendentes |

## Variáveis de ambiente

Veja [`.env.example`](.env.example) — cobre servidor, banco, contas/sessão, LiveKit, upload e a integração opcional com Discord.

## Deploy

A imagem é construída pelo [`Dockerfile`](Dockerfile) (multi-stage: builda o frontend, compila o backend TypeScript, e monta um runtime enxuto sem devDependencies nem código-fonte). Produção roda via [Dokploy](https://dokploy.com) a partir desse `Dockerfile` — sem proxy reverso nem systemd no repositório, o Dokploy já cuida de domínio, HTTPS e do proxy na frente.

Pra rodar localmente com Docker:

```bash
cp .env.example .env
docker compose up -d
```

## Nota sobre áudios

Os áudios de notificação usados atualmente no projeto são de autoria do Discord e estão presentes apenas para fins de teste durante o desenvolvimento — serão substituídos em breve.

## Licença

[MIT](LICENSE)
