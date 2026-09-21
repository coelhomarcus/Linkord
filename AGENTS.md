# AGENTS.md

Instructions for agents (and humans) working in this repository. For "what is this project, how do I run it, what's the stack" see [README.md](README.md) — this file is about **how the code is organized and the conventions to follow when touching it**.

Monorepo: `web/` (frontend, React + Vite + Vitest) and `server/` (backend, Fastify + Drizzle/Postgres + Socket.IO + LiveKit, `node --test`). Both TypeScript/ESM.

## General rule: organize by feature, not by layer

The project was restructured (see commit history `refactor: reorganiza o backend em módulos por domínio` / `reorganiza o frontend por funcionalidade`) to group by **domain/feature**, not by technical type. Don't recreate a generic `hooks/`, `components/`, or `handlers/` folder at the root — each feature has its own folder with everything only it uses.

## Frontend (`web/src/`)

```
web/src/
  app/                  # composition root — nothing should import FROM app/
    App.tsx
    layout/             # GlobalContextMenu, LoadingScreen, RoomErrorScreen, ReconnectBanner
    providers/          # RoomProvider.tsx (the room's state root)
  features/<domain>/    # calls, chat, conversations, media, profile, settings, auth, reactions...
  shared/                # see criteria below
    api/ hooks/ lib/ types/ ui/{primitives,motion}/
    Avatar.tsx, ConfirmDialog.tsx, notifications.ts, sounds.ts, ...
  state/                 # RoomContext, AuthContext, roomReducer + state/hooks/ (cross-cutting)
  styles/                # global CSS
web/tests/               # mirrors web/src/ — NO tests inside src/
```

- **`features/<domain>/`**: a feature's component, hook, and test live together (the test in `web/tests/features/<domain>/`, mirroring the path). If a hook/component is only used by one feature, it lives there — not in `shared/`.
- **`shared/` is only for things that genuinely have no owner** — used by 2+ features with none of them being the natural owner, or pure infrastructure (HTTP client, protocol types, UI primitives). Before putting something in `shared/`, confirm with a grep of who imports it — if only one feature uses it, it's not a `shared/` candidate.
- **`state/hooks/`** is for the rare case of a cross-cutting hook with no owning feature at all (e.g. `usePresence`, `useTypingIndicator`, `useSocketConnection` — only used by `RoomProvider`, but don't belong to any specific feature).
- **Alias `@/`** → `web/src`; **`@tests/`** → `web/tests` (configured in `vite.config.ts` and `tsconfig.app.json`). An import of a file in the same directory stays relative (`./Sibling`); any import that would need to climb out with `../` becomes `@/full/path` instead.
- Tests ALWAYS in `web/tests/`, never inside `web/src/`.

## Backend (`server/src/`)

```
server/src/
  app/                  # bootstrap.ts (the whole boot sequence) + index.ts (3 lines: imports and calls bootstrap)
  config/               # env.ts
  db/                   # client.ts, schema.ts, migrate.ts
  http/                 # app.ts (Fastify), cookies.ts, respond.ts
  realtime/             # socket.ts — combines every module's `handlers` into one dispatch table
  integrations/<name>/  # external service adapters: livekit/
  modules/<domain>/     # auth, users, presence, conversations, messages, calls,
                        # attachments, moderation, profile, link-preview
server/tests/            # mirrors server/src/ — NO tests inside src/
```

- **No alias** — every import is a relative path, with an explicit `.js` extension even though the file is `.ts` (this is real ESM; `.js` is what exists after the build). E.g. `import { db } from '../../db/client.js';`.
- **When to split a large module into repository vs. handlers** (the pattern used in `conversations.ts`/`conversationsRepository.ts` and `attachmentUploads.ts`/`uploadSession.ts`): only split with **real fan-in evidence** — if specific functions in the file are already imported by several different external modules (a repository API buried alongside handlers nobody imports individually), splitting is worth it. File size alone is **not** a reason — `messages.ts` stays at ~470 lines on purpose because it's cohesive and none of its functions are used outside its own socket dispatch. Don't split "because it got big"; split when two different groups of external consumers each only need one half of the file.
- **Never use a dynamic `import()` just to dodge an import cycle.** If two modules form a cycle, extract the part both need into a new leaf module (zero dependency back into the cycle) — that's what resolved the `conversations.ts`/`attachments.ts` cycle (see `modules/attachments/attachmentCleanup.ts`, which only depends on `db`/schema/`attachmentStorage.ts`). A dynamic import is a sign the module boundary is wrong, not a solution.
- Tests ALWAYS in `server/tests/`, never inside `server/src/`.

## Verification before calling something done

```bash
# backend
npx tsc -p server/tsconfig.json --noEmit      # typecheck the production build
npm run typecheck:server:tests                 # typecheck server/tests/
npm run test:server                            # node --test

# frontend
cd web && npx tsc -p tsconfig.app.json --noEmit
cd web && npm run lint                         # oxlint
cd web && npm run test                         # vitest run

# both together
npm run build                                  # tsc -p server + vite build
npm test                                       # test:server + test:web
```

A change that touches a real flow (upload, call, conversations, auth) deserves live manual verification (`npm run dev`, 2 accounts), not just automated tests.

## Code Conventions

No Portuguese comments in any source. Comments and identifiers in English; follow the existing language of surrounding prose.

- Comments always explain the *why* (a non-obvious decision, an invariant, a workaround) — never the *what* (the code already says that). Prefer no comment at all when the name is already clear.
- UI strings and commit messages are in Portuguese (the product itself is Portuguese-language). Code identifiers (variables, functions, types) and all comments are in English regardless.
- Commits follow `type: description` (`refactor:`, `feat:`, `fix:`, `chore:`) in Portuguese, focused on the *why* of the change.
