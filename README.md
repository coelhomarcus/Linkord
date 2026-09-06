<p align="center">
  <img src="web/public/icon-512.png" alt="Linkord" width="120" />
</p>

<h1 align="center">Linkord</h1>

<p align="center">
  Chat em tempo real, canais e chamadas de voz/tela.
</p>

<p align="center">
  <a href="https://github.com/coelhomarcus/Linkord/actions/workflows/test.yml?query=branch%3Amain">
    <img src="https://github.com/coelhomarcus/Linkord/actions/workflows/test.yml/badge.svg?branch=main" alt="CI" />
  </a>
</p>

## O que é

Linkord é uma plataforma de comunicação em tempo real com chamadas de voz, vídeo, texto e compartilhamento de tela — auto-hospedável, estilo Discord. O app e seus dados ficam na sua infraestrutura; a mídia usa um servidor LiveKit, que pode ser o LiveKit Cloud ou uma instalação própria compatível.

- Categorias e múltiplos canais de texto e voz, com reordenação por drag-and-drop (admin)
- Chat: anexos (upload em chunks, até 2GB), embeds automáticos de YouTube/Twitch/mídia direta e Open Graph, reações, respostas, editar/apagar mensagem
- Canais de voz com câmera e tela compartilhada (LiveKit)
- Diretório de usuários (online/offline) e painel de moderação (apagar conta)
- Aba de mídias — todo anexo/embed do projeto, de todos os canais
- Preferências salvas neste navegador (volume por chamada/pessoa, volume de notificações, qualidade de envio)
- Notificação no Discord quando alguém entra na chamada ou compartilha tela (Webhook)

## Stack

- **Frontend**: React + TypeScript + Vite, Tailwind
- **Backend**: Node.js + TypeScript (ESM) com Fastify + Socket.IO
- **Banco**: PostgreSQL via Drizzle ORM
- **Vídeo/áudio**: LiveKit Cloud (WebRTC)

## Rodando localmente

Requer Node.js 22+ e um Postgres acessível (`DATABASE_URL`).

```bash
npm ci
npm ci --prefix web
cp .env.example .env   # preencha DATABASE_URL, códigos de cadastro, LIVEKIT_*, etc.
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

## Testes

- **Backend**: `node --test` (`server/src/**/*.test.ts`) — não precisa de Postgres nem LiveKit de verdade rodando.
- **Frontend**: Vitest + React Testing Library (`web/src/**/*.test.tsx`).

```bash
npm test              # backend + frontend
npm run test:server   # só o backend
npm run test:web      # só o frontend
```

Roda automaticamente em todo push/PR pra `main`/`develop` ([`.github/workflows/test.yml`](.github/workflows/test.yml)).

## Variáveis de ambiente

Veja [`.env.example`](.env.example) — cobre servidor, banco, contas/sessão, LiveKit, upload e a integração opcional com Discord.

## Deploy

A imagem é construída pelo [`Dockerfile`](Dockerfile) (multi-stage: builda o frontend, compila o backend TypeScript, e monta um runtime enxuto sem devDependencies nem código-fonte). Produção roda via [Dokploy](https://dokploy.com) a partir desse `Dockerfile` — sem proxy reverso nem systemd no repositório, o Dokploy já cuida de domínio, HTTPS e do proxy na frente. Nesse cenário, configure `TRUST_PROXY=1` no Dokploy; mantenha o padrão `0` quando a aplicação estiver diretamente acessível.

Pra rodar localmente com Docker, o Compose já inclui um PostgreSQL privado e persistente. Preencha no `.env` `ADMIN_REGISTRATION_CODE` para criar o primeiro administrador, `REGISTRATION_CODE` para os demais usuários e as credenciais do LiveKit; o `DATABASE_URL` é configurado internamente pelo Compose. Remova ou rotacione o código de administrador após o primeiro cadastro.

```bash
cp .env.example .env
docker compose up -d --build
```

Os anexos continuam em `./uploads` e o banco fica no volume nomeado `postgres-data`. Em Linux, se `./uploads` já existir com outro proprietário, garanta que o UID 1000 possa escrever nessa pasta antes de subir o container.

## Nota sobre áudios

Os áudios de notificação usados atualmente no projeto são de autoria do Discord e estão presentes apenas para fins de teste durante o desenvolvimento — serão substituídos em breve.

## Licença

[MIT](LICENSE)
