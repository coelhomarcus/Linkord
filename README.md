<p align="center">
  <img src="web/public/logo.svg" alt="Linkord" width="120" />
</p>

<h1 align="center">Linkord</h1>

<p align="center">
  Comunicação em tempo real, self-hosted — amigos, grupos e chamadas.
</p>

<p align="center">
  <a href="https://github.com/coelhomarcus/Linkord/actions/workflows/test.yml">
    <img src="https://github.com/coelhomarcus/Linkord/actions/workflows/test.yml/badge.svg" alt="CI" />
  </a>
</p>

## O que é

Linkord é uma plataforma de chat e chamadas self-hosted, no estilo Discord — mas organizada por **amigos e grupos**, não por servidores/canais públicos. Cada conta adiciona amigos por `@username` exato, conversa por DM ou cria grupos próprios (com convite e aceite), e chama por voz/vídeo/tela dentro dessas conversas.

- **Amigos**: pedido de amizade, aceitar/recusar, bloqueio
- **Conversas**: DMs e grupos — qualquer conta pode criar um grupo e é dona dele (renomear, convidar, remover membro, transferir posse)
- **Chat**: anexos (upload em chunks, até 2GB), embeds automáticos (YouTube/Twitch/mídia direta/Open Graph), reações, respostas, editar/apagar mensagem, busca
- **Chamadas**: voz, câmera e compartilhamento de tela por conversa (LiveKit)
- **Administração** (`/admin`): usuários, grupos, denúncias, log de auditoria e limpeza de arquivos órfãos
- **Ajustes**: perfil, conta/segurança, dispositivos de áudio/vídeo, notificações, preferências, privacidade (bloqueados)

## Stack

- **Frontend**: React + TypeScript + Vite, Tailwind
- **Backend**: Node.js + TypeScript (ESM) com Fastify + Socket.IO
- **Banco**: PostgreSQL via Drizzle ORM
- **Vídeo/áudio**: LiveKit Cloud (WebRTC)

## Rodando localmente

Requer Node.js 22+ e um Postgres acessível (`DATABASE_URL`). Pra um Postgres local via Docker, sem depender de nada externo:

```bash
docker compose -f docker-compose.dev.yml up -d   # só o Postgres, isolado de produção
```

Isso sobe em `localhost:5432` com usuário/senha/banco `linkord`/`linkord`/`linkord` — bate com o `DATABASE_URL` de exemplo do `.env.example`.

```bash
npm install
cp .env.example .env   # preencha DATABASE_URL, LIVEKIT_*, REGISTRATION_CODE, etc.
npm run db:migrate
npm run dev             # server (watch) + web (Vite) juntos
```

O frontend sobe em `http://localhost:5173` (proxy pro backend em `:3000`).

Cadastro é fechado por padrão (`REGISTRATION_CODE` vazio = ninguém se cadastra). Depois de criar sua conta, vire admin com:

```bash
npm run admin:grant -- <seu-username>
```

### Scripts principais

| Script | O que faz |
|---|---|
| `npm run dev` | Backend (`tsx --watch`) + frontend (Vite) em paralelo |
| `npm run build` | Compila o backend (`tsc`) e builda o frontend (`vite build`) |
| `npm start` | Roda o backend já compilado (`server/dist/index.js`) |
| `npm test` | Testes do backend (`node --test`) e do frontend (`vitest`) |
| `npm run db:generate` | Gera uma migration nova a partir de `server/src/db/schema.ts` |
| `npm run db:migrate` | Aplica as migrations pendentes |
| `npm run admin:grant -- <username>` | Concede papel de admin a uma conta existente |

## Testes

- **Backend**: `node --test` (`server/tests/**/*.test.ts`) — não precisa de Postgres nem LiveKit de verdade rodando.
- **Frontend**: Vitest + React Testing Library (`web/tests/**/*.test.tsx`).

```bash
npm test              # backend + frontend
npm run test:server   # só o backend
npm run test:web      # só o frontend
```

Roda automaticamente em todo push/PR pra `main`/`develop` ([`.github/workflows/test.yml`](.github/workflows/test.yml)).

## Variáveis de ambiente

Veja [`.env.example`](.env.example) — cobre servidor, banco, contas/sessão, LiveKit, upload e limites de abuso.

## Deploy

A imagem é construída pelo [`Dockerfile`](Dockerfile) (multi-stage: builda o frontend, compila o backend TypeScript, e monta um runtime enxuto sem devDependencies nem código-fonte). Produção roda via [Dokploy](https://dokploy.com) a partir desse `Dockerfile` — sem proxy reverso nem systemd no repositório, o Dokploy já cuida de domínio, HTTPS e do proxy na frente.

Pra rodar localmente com Docker (app + Postgres, tudo em container):

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml -f docker-compose.yml up -d
```

## Nota sobre áudios

Os áudios de notificação usados atualmente no projeto são de autoria do Discord e estão presentes apenas para fins de teste durante o desenvolvimento — serão substituídos em breve.

## Licença

[MIT](LICENSE)
