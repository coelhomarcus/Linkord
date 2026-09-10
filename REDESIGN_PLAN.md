# Linkord Redesign Plan

## Direcao

Linkord deixa de ser uma aplicacao com DNA de Discord, baseada em categorias,
canais de texto e canais de voz, e passa a ser um app de conversacao estilo
WhatsApp/Telegram moderno:

- DMs entre qualquer usuario do sistema, sem sistema de amizade por enquanto.
- Grupos criados por admins, com membros escolhidos no momento da criacao e
  gerenciados depois.
- Chamadas apenas em grupos. DM continua sendo somente mensagem.
- Sidebar vira a area protagonista da aplicacao, com conversas, grupos,
  usuarios e acoes principais.
- Chat usa bubbles com avatar, inspirado no componente beUI
  `message-bubble`.
- Visual dark-first, moderno, com motion sutil, bordas finas, superficies mais
  leves e o accent atual preservado, mas renomeado para um token sem semantica
  de Discord.

## Referencias

- beUI: componentes animados, copy-paste via shadcn registry, dark UI, motion
  em pequenas interacoes.
- Vercel: hierarquia limpa, pouca decoracao, contraste preciso, navegacao de
  produto.
- Chatbots atuais: composer central forte, mensagens em bubble, contexto da
  conversa no topo, acoes visiveis sem poluir.

## Status Da Implementacao

### Fase 1 - base conversacional iniciada

Status: concluida em 2026-09-10.

- Instalados componentes beUI iniciais: `message-bubble`, `prompt-input`,
  `animated-sidebar`, `tabs`, `drawer` e `expandable-action-bar`.
- Criado modelo backend de `conversations` e `conversation_members`.
- Criadas DMs por par de usuarios com `dm_key` unico.
- Criacao de grupos por admin implementada no protocolo realtime.
- Chamadas movidas para grupos via `call-join`, com DMs bloqueadas no backend.
- Frontend passou a expor `ConversationSidebar` e `ConversationPanel`.
- Chat principal agora usa bubbles com avatar e composer baseado em beUI.
- Busca, notificacoes, anexos, respostas, edicao, delete e reacoes foram
  adaptados para `conversationId`, mantendo aliases legados enquanto a limpeza
  final nao acontece.
- Migration `0011_messy_lord_tyger.sql` gerada para alinhar banco novo.

### Fase 7 - limpeza do legado Discord

Status: concluida em 2026-09-10.

- Removidas as tabelas `categories`/`channels` do schema e a coluna de
  compatibilidade `messages.channel_id` (migration `0012`), aplicada no
  banco (vazio, sem dado a migrar de verdade).
- Removido `server/src/modules/channels.ts` (ja estava desconectado dos
  handlers) e todo fallback `conversationId ?? channelId` em `chat.ts`,
  `attachments.ts` e `realtime/socket.ts`. Eventos `voice-join`/`voice-leave`
  saem do protocolo, so resta `call-join`/`call-leave`/`call-kick`.
  `voiceChannelId` sai de `Participant`/`PublicParticipant`, so
  `callConversationId`.
- `media.ts` (aba Midia de Settings) foi reescrito: agora junta por
  `conversations`/`conversation_members` em vez de `channels`, e passou a
  escopar por usuario (so mostra midia das conversas de quem pediu) — antes
  do redesign ele expunha midia de TODAS as conversas para qualquer usuario
  logado, o que teria vazado DMs de terceiros; e como `channelId` nunca era
  mais preenchido em mensagens novas, a aba já estava retornando vazio.
- Frontend: `RoomProvider`/`RoomContext` perderam toda a API dupla de
  canal/categoria (`categories`, `activeChannelId`, `messagesByChannel`,
  `createCategory`/`createChannel`/etc.) — sobra só a API por
  `conversationId`. `GlobalContextMenu` perdeu a gestão de categoria/canal
  (criar/renomear/apagar), mantendo reacoes, responder, copiar, apagar
  mensagem, baixar anexo e "ocultar sem video" da call.
- Apagados os componentes mortos (sem import algum): `LeftSidebar`,
  `ChannelTree`, `ChatPage`, `ChatComposer`, `ChatMessageList`,
  `UserDirectory`, `VoiceIdleScreen`, com os respectivos testes.
- `voiceKickParticipant` virou `kickFromCall` (`call-kick`) — a acao existe
  no `RoomContext` mas ainda sem gatilho na UI nova (o menu por participante
  vivia so no `ChannelTree` apagado); entra junto da Fase visual da call.
- Build (server + web), testes (122 server / 98 web) e migration passando.

### Fase 6 (parcial) - gestao de grupo

Status: concluida em 2026-09-10.

- Backend: `group-update` (renomear, admin-only), `group-members-add`
  (admin-only, ignora ids invalidos/ja membros) e `group-members-remove`
  (admin remove qualquer um; qualquer membro remove a si mesmo = sair) em
  `server/src/modules/conversations.ts`. Grupo que fica sem membro nenhum e
  apagado automaticamente (sem UI de "todos os grupos", um grupo vazio
  vira um registro invisivel pra sempre — mais seguro purgar).
  Quem e removido recebe `conversation-deleted`, reaproveitando o handling
  que o client ja tinha (limpa mensagens, sai da call se estava nela).
- Frontend: novo `GroupDetailsDrawer.tsx` (drawer beUI) com avatar/titulo
  editavel (admin), lista de membros com status online, adicionar pessoas
  (busca + selecao), remover membro (admin, com confirm), sair do grupo
  (qualquer membro, com confirm) e excluir grupo (admin, com confirm).
  Aberto pelo icone de info ou pelo avatar/titulo no header do
  `ConversationPanel`, só para conversas do tipo `group`.
- Testado o fluxo inteiro num browser real (Playwright headless): criar
  grupo -> abrir drawer -> renomear -> remover membro -> readicionar ->
  abrir/cancelar "sair" -> abrir e confirmar "excluir" de verdade -> grupo
  some da sidebar sem sobra de estado. Sem erros no console alem dos 401
  esperados do check de sessao antes do login.
- `voiceKickParticipant` (renomeado `kickFromCall` na Fase 7) segue sem
  gatilho na UI — fica para a fase de redesign visual da chamada.

### Fase 5 (parcial) - controles da chamada com beUI

Status: concluida em 2026-09-10.

- `CallControlBar.tsx` passou a usar o `ExpandableActionBar` do beUI (ja
  instalado na Fase 0, nunca usado ate agora) para mic/ouvir/camera/tela —
  vira uma pilula que expande com label ao passar o mouse. Reagir e Sair
  continuam como botoes separados (o primeiro precisa de popover, o segundo
  e deliberadamente destacado/vermelho, fora do grupo de toggles).
- `TileMenu.tsx` ganhou "Remover da chamada" (admin-only, nunca no proprio
  tile) chamando `kickFromCall` — essa acao existia no `RoomContext` desde a
  Fase 7 mas não tinha gatilho de UI.
- Achado e corrigido de quebra um gap adjacente: apagar uma conta (Settings
  > Moderacao) apagava a membership via CASCADE mas nunca verificava se isso
  esvaziava um grupo — um grupo podia ficar orfao (zero membros, invisivel
  pra sempre) sem passar pelo purge que `group-members-remove` ja fazia.
  Extraido `reconcileGroupMembership()` em `conversations.ts`, reusado nos
  dois lugares.
- Testado: como o ambiente sandbox nao consegue completar WebRTC de verdade
  (headless Chromium com fake device de audio nao publica track — testado e
  confirmado, LiveKit conecta mas o mic nunca ativa), a verificacao foi via
  componente (Vitest + Testing Library, `CallControlBar.test.tsx` e novo
  `TileMenu.test.tsx`, 8 testes) em vez de screenshot end-to-end. Cobre: os
  botoes certos aparecem com os labels certos, clique aciona a funcao certa,
  "Remover da chamada" so aparece pra admin e nunca no proprio tile.
- Nao mudou: `Tile.tsx`, `TileGrid.tsx`, `FloatingPip.tsx` — ja usavam os
  tokens de tema atuais (nao tinham "DNA Discord" real, so faltava o
  gatilho do kick e a pilula de controles beUI).

### Fase 6 (parcial) - settings, perfil e o token `blurple`

Status: concluida em 2026-09-10.

- Achado: o token `--color-blurple`/`bg-blurple`/`text-blurple` (o proprio
  nome que a Discord deu pra cor de marca deles) nunca tinha sido migrado
  pra `--color-accent-primary` como o plano original (Fase 0) pedia —
  `--color-accent-primary` foi criado como alias, mas 15 arquivos (incluindo
  o `Button` base) continuavam usando `bg-blurple`/`text-blurple` de
  verdade. Migrado tudo pra `bg-primary`/`text-primary` (ja o padrao usado
  nos componentes novos da Fase 1-5), e o hover fixo `blurple-hover` virou
  `hover:bg-primary/90`, o padrao que o proprio beUI usa.
- O rotulo visivel "Blurple" no seletor de cor de perfil (Settings > Perfil)
  virou "Índigo" — o `value: 'blurple'` interno (dado ja salvo pra contas
  reais) foi mantido, so o texto que aparece pra usuario mudou.
- Removidos os tokens CSS mortos (zero uso fora da propria definicao):
  `--color-bg-channel-active`, `--color-bg-panel`, `--color-bg-sidebar` e
  `--color-surface-sidebar`.
- Corrigido texto residual da Fase 7: notificacoes ainda diziam "mensagem
  em um canal que voce nao esta vendo".
- `SettingsModal.tsx`: rail vertical e cards passaram da superficie opaca
  antiga (`border-strong bg-bg-tertiary`, bloco solido `bg-bg-primary` no
  rail — visualmente muito perto do "User Settings" da Discord) pra
  bordas translucidas `border-white/10`, cards `bg-white/[0.03]
  rounded-xl` e a aba ativa como pilula `bg-primary/12 rounded-lg`,
  mesma linguagem do `ConversationSidebar`/`GroupDetailsDrawer`.
- `AuthScreen.tsx` foi revisado mas nao muda: e um card simples, sem
  elementos de canal/categoria/servidor, e ja usa os tokens atuais —
  nao carrega DNA Discord de verdade, so e visualmente mais simples do
  que o resto do app. Nao mexido pra nao gastar tempo em algo que nao
  era o problema.

### Fase 8 - QA visual mobile

Status: concluida em 2026-09-10.

Testado com Playwright + emulacao de iPhone 13 (dois usuarios de teste,
apagados no final): login, sidebar, aba Pessoas, abrir DM, mandar
mensagem, criar grupo, drawer de detalhes do grupo, busca, settings. Dois
bugs reais encontrados e corrigidos:

- **Sidebar mobile ficava presa depois de criar um grupo.** `activeConversationId`
  mudava (o grupo abria de verdade no estado), mas `mobileShowSidebar`
  so virava `false` num tap direto de linha na sidebar — criar grupo, clicar
  numa notificacao, ou qualquer outra abertura de conversa iniciada pelo
  servidor deixava o usuario "preso" olhando a lista, sem indicio visual de
  que algo mudou. Corrigido em `App.tsx`: um `useEffect` observa
  `activeConversationId` e esconde a sidebar em qualquer mudanca DEPOIS da
  primeira (a primeira e o auto-select do `welcome`, que deve continuar
  pousando na lista, nao entrar direto numa conversa). `GroupCreateDialog`
  ganhou `onCreated`, usado pelo `ConversationSidebar` pra tambem resetar a
  aba de volta pra "Conversas" (senao o "Voltar" deixava a pessoa na aba
  "Pessoas", sem ver o grupo novo).
- **`SettingsModal` estourava a largura da tela no mobile.** O rail de abas
  horizontal (`overflow-x-auto`) nao tinha `min-w-0` nos ancestrais flex/grid
  — o classico problema do flexbox de nao encolher abaixo do min-content,
  entao a MODAL inteira (nao so o rail) crescia mais larga que o viewport
  em vez do rail rolar dentro dos proprios limites. Corrigido com `min-w-0`
  no `Tabs`, no `TabsList` e no container de conteudo.
- Revisados sem problema: `GroupDetailsDrawer` (drawer de 85vw, cabe bem),
  `ChatSearchDialog`, bubbles de mensagem, `GroupCreateDialog` (lista +
  botoes empilhados full-width — ja se adapta bem ao mobile).

## Principios De Design

- Remover linguagem visual de servidor/canal/categoria.
- Evitar tokens e nomes como `blurple`, `channel`, `category`, `voiceChannel`
  na camada de UI nova.
- Usar `conversation`, `direct`, `group`, `call`, `member`, `people`.
- Sidebar com largura generosa, busca, tabs e lista rica de conversas.
- Area de chat mais elegante: largura controlada, bubbles, composer grande,
  header limpo e estados vazios melhores.
- Chamada continua central: grupos devem ter entrada clara para call, estado
  ativo e surface de video/tela renovada.
- Motion deve ajudar orientacao e feedback, nao virar efeito decorativo.
- Mobile deve parecer app de mensagens: lista primeiro, conversa depois, sheet
  para detalhes/participantes.

## beUI

O repo ja tem o skill local `beui` em `.agents/skills/beui`. Para implementar,
usar o registry vivo do beUI como fonte de verdade e instalar componentes
copy-paste com shadcn.

Comandos de ambiente sugeridos:

```bash
npx skills add starc007/ui-components --skill beui
codex mcp add beui --url https://mcp.beui.dev/mcp
claude mcp add --transport http beui https://mcp.beui.dev/mcp
```

Componentes beUI candidatos para a primeira leva:

- `message-bubble`: bubbles de chat com avatar.
- `prompt-input`: composer moderno para mensagens.
- `animated-sidebar`: base para a nova sidebar protagonista.
- `command-palette`: navegacao rapida, busca e comandos.
- `drawer`: detalhes de conversa, membros e settings em painel.
- `bottom-sheet`: mobile para detalhes de grupo e membros.
- `tabs` ou `expandable-tabs`: alternar Conversas / Pessoas / Grupos.
- `attachment-upload`: anexos e previews no composer.
- `animated-toast-stack`: feedbacks de erro/sucesso.
- `expandable-action-bar`: controles compactos da chamada.
- `button-base`, `button-stateful`, `input`, `select`, `switch`: padronizacao
  gradual de controles comuns.

Antes de instalar qualquer slug:

```bash
curl -fsS https://beui.dev/r/registry.json
npx shadcn@latest view @beui/<slug>
npx shadcn@latest add @beui/<slug>
```

## Novo Modelo De Produto

### Conversas

Tipos:

- `direct`: conversa 1:1 entre dois usuarios.
- `group`: conversa com varios usuarios, criada por admin.

Regras:

- Todo usuario pode iniciar DM com qualquer outro usuario existente.
- Nao existe amizade, convite ou bloqueio nesta etapa.
- Admin cria grupo e seleciona membros.
- Grupo e uma conversa unica: ele tem exatamente um chat e, quando ativa,
  exatamente uma call associada ao proprio `conversationId`.
- Nao existe criacao de canais dentro de grupo, nem canais de texto, nem salas
  de voz extras. O modelo deve permanecer parecido com WhatsApp.
- Somente grupos podem iniciar chamada.
- Usuario so ve grupos dos quais faz parte, exceto admin se decidirmos dar
  visao global no painel administrativo.

### Chamadas

- LiveKit room deve usar `conversationId` do grupo.
- Evento `call-join` valida que a conversa existe, e que ela e `group`.
- DM nao exibe botao de chamada e o backend rejeita join em DM.
- Cada grupo usa sempre uma unica LiveKit room derivada do proprio
  `conversationId`.
- Participantes passam a ter `callConversationId` em vez de `voiceChannelId`.
- UI de call deve aparecer dentro do contexto do grupo, com botao de voltar
  para mensagens.

### Pessoas

- Nova aba "Pessoas" mostra todos os usuarios do sistema.
- Clicar em usuario abre ou cria DM.
- Online/offline continua existindo.
- Perfil continua acessivel, mas com visual atualizado.

## Banco De Dados

Como o banco e novo e nao ha preocupacao com migracao, podemos substituir o
schema atual de `categories`/`channels`.

### Tabelas principais

- `users`: manter, mas trocar default visual de `avatarColor` para token novo
  de accent. Revisar textos e defaults.
- `conversations`:
  - `id`
  - `type`: `direct` ou `group`
  - `title`: obrigatorio para grupo, opcional para DM
  - `avatar`
  - `created_by`
  - `dm_key`: unico e nullable para garantir uma DM por par de usuarios
  - `last_message_at`
  - `created_at`
  - `updated_at`
- `conversation_members`:
  - `conversation_id`
  - `user_id`
  - `role`: `owner`, `admin`, `member`
  - `last_read_message_id`
  - `joined_at`
  - chave unica `(conversation_id, user_id)`
- `messages`:
  - trocar `channel_id` por `conversation_id`
  - manter `author_id`, `text`, `reply_to`, `reactions`, `search_vector`
  - indexar por `(conversation_id, id)`
- `attachments`:
  - manter `message_id`
  - adaptar validacoes de upload para `conversationExistsForUser`

### Seed

- Criar primeiro admin pelo fluxo atual de auth.
- Nao criar categorias/canais default.
- Opcional: criar grupo default "Geral" apenas se isso for desejavel para demo.

## Protocolo Realtime

Substituir mensagens antigas:

- `categories`, `channels-tree`, `channel-open`, `channel-history`,
  `voice-join`, `voice-leave`

Por mensagens novas:

- `conversation-open`
- `conversation-history`
- `conversation-history-more`
- `conversation-history-around`
- `conversation-search`
- `conversation-list`
- `direct-open`
- `group-create`
- `group-update`
- `group-delete`
- `group-members-add`
- `group-members-remove`
- `call-join`
- `call-leave`
- `call-kick`

Payloads do `welcome`:

- `conversations`: lista inicial acessivel ao usuario.
- `users`: todos os usuarios do sistema.
- `onlineUserIds`: manter.
- `activeCalls`: grupos com chamada ativa, se quisermos mostrar indicador.

## Backend

1. Refatorar `server/src/db/schema.ts`.
2. Trocar modulo `channels.ts` por `conversations.ts`.
3. Adaptar `chat.ts` para `conversationId`, membership e DM/group rules.
4. Adaptar `attachments.ts` para validar conversa e permissao do usuario.
5. Adaptar `realtime/socket.ts` para:
   - enviar conversas no `welcome`
   - abrir/criar DM
   - criar grupo admin-only
   - entrar em call somente em grupo
6. Adaptar `participants.ts` e tipos para `callConversationId`.
7. Atualizar testes de backend:
   - criar DM unica por par
   - usuario nao acessa grupo fora da membership
   - admin cria grupo
   - DM rejeita chamada
   - grupo permite chamada
   - upload so funciona em conversa acessivel
   - busca escopa por conversa

## Frontend

### Estrutura Nova

Criar uma camada de app mais proxima de mensageiro:

- `MessengerShell`
- `ConversationSidebar`
- `ConversationList`
- `PeopleList`
- `GroupCreateDialog`
- `ConversationPanel`
- `ConversationHeader`
- `MessageBubbleList`
- `MessageComposer`
- `GroupCallPanel`
- `ConversationDetailsDrawer`

Componentes antigos a substituir ou renomear:

- `LeftSidebar` vira `ConversationSidebar`.
- `ChannelTree` sai.
- `ChatPage` vira `ConversationPanel`.
- `ChatMessageList` vira `MessageBubbleList`.
- `ChatComposer` vira `MessageComposer`.
- `UserDirectory` vira aba/painel `PeopleList`, nao sidebar direita fixa.
- `Stage` permanece como base, mas vira uma experiencia de chamada de grupo.

### Sidebar

Requisitos:

- Largura desktop inicial entre 340px e 380px.
- Header com logo, usuario atual e botao de settings.
- Busca no topo.
- Tabs: Conversas, Pessoas, Grupos/Admin.
- Lista de conversas com:
  - avatar ou stack de avatars
  - nome
  - ultima mensagem
  - horario
  - unread
  - online dot em DM
  - indicador de chamada ativa em grupo
- Botao de criar grupo visivel para admin.
- No mobile, sidebar ocupa a primeira tela e conversa entra como drill-in.

### Chat

Requisitos:

- Header com avatar, nome, status e acoes.
- DM: sem botao de chamada.
- Grupo: botao de chamada, membros, detalhes.
- Mensagens em bubbles com avatar, inspiradas em `message-bubble`.
- Diferenciar mensagens minhas e de outros usuarios.
- Reactions e menu de mensagem aparecem com motion sutil.
- Composer inspirado em `prompt-input`:
  - anexar arquivo
  - emoji
  - enviar
  - reply preview
  - upload progress
  - mention autocomplete

### Call

Requisitos:

- Botao "Entrar na chamada" no header de grupo.
- Ao entrar, mostrar surface de call no contexto do grupo.
- Controles usando padrao proximo de `expandable-action-bar`.
- Manter camera, mic, deafened, screen share, reacoes e leave.
- Mostrar call ativa na sidebar.
- DM nunca renderiza controles de call.

### Settings E Perfil

- Redesenhar modais como drawers/panels.
- Padronizar inputs, switches e tabs com beUI gradualmente.
- Remover copys com cara de servidor/canal.

## Design Tokens

Trocar tokens atuais:

- `--color-blurple` vira `--color-accent-primary`.
- `--color-bg-sidebar` vira `--color-surface-sidebar`.
- `--color-bg-channel-active` vira `--color-surface-selected`.
- `--color-bg-panel` vira `--color-surface-main`.

Manter o accent visual atual:

- Base atual: `oklch(52.82% 0.2628 279.30)`.
- Usar com mais contencao: foco, CTA, unread, active item, call active.
- Reduzir dominancia de roxo/azul no resto da UI para nao virar Discord.

Nova direcao dark:

- Fundo principal quase preto, neutro.
- Sidebar com superficie propria, mas sem bloco chapado estilo Discord.
- Bordas sutis e highlights por transparencia.
- Radius entre 8px e 14px, evitando excesso de pills em tudo.
- Tipografia menor e precisa, estilo app de produto.

## Ordem De Implementacao

### Fase 0 - Setup beUI e base visual

- Verificar registry beUI.
- Instalar primeira leva de componentes.
- Adicionar dependencia `motion` se o shadcn nao adicionar automaticamente.
- Criar tokens novos no `index.css`.
- Criar wrappers de compatibilidade para botao/input se necessario.
- Rodar build.

### Fase 1 - Banco e protocolo

- Reescrever schema para conversas.
- Remover seed de categorias/canais.
- Criar modulos de conversa e membership.
- Atualizar tipos compartilhados.
- Adaptar handlers realtime.
- Atualizar testes de backend.

### Fase 2 - Estado do client

- Refatorar `RoomProvider` para estado de conversas.
- Trocar mapas `messagesByChannel` por `messagesByConversation`.
- Trocar unread por conversa.
- Atualizar notificacoes para conversa.
- Atualizar upload para `conversationId`.

### Fase 3 - Nova sidebar

- Implementar `ConversationSidebar`.
- Implementar tabs Conversas/Pessoas.
- Abrir/criar DM ao clicar em pessoa.
- Criar fluxo admin de grupo.
- Remover `ChannelTree` da experiencia principal.

### Fase 4 - Chat bubble

- Instalar/usar `message-bubble`.
- Migrar `ChatMessageList` para bubbles.
- Migrar composer para `prompt-input`.
- Recriar reply, reactions, edit/delete e anexos no novo layout.

### Fase 5 - Chamadas em grupo

- Trocar `voiceChannelId` por `callConversationId`.
- Atualizar LiveKit room para grupo.
- Bloquear chamada em DM no backend e na UI.
- Redesenhar `Stage`, `CallControlBar` e estados vazios.

### Fase 6 - Modais e detalhes

- Redesenhar perfil, settings, busca e membros.
- Mover detalhes de grupo para drawer/bottom-sheet.
- Remover sidebar direita fixa de membros.

### Fase 7 - Limpeza

- Apagar ou arquivar componentes antigos:
  - `LeftSidebar`
  - `ChannelTree`
  - tipos de `Category`/`Channel`
  - handlers de categoria/canal
- Renomear arquivos e testes.
- Remover tokens antigos.
- Revisar strings antigas com "canal", "categoria", "servidor".

### Fase 8 - QA visual e funcional

- Build web e server.
- Testes unitarios server/web.
- Teste manual desktop:
  - login
  - abrir DM
  - criar grupo
  - enviar mensagens
  - reply/reaction/edit/delete
  - upload
  - entrar/sair de chamada em grupo
- Teste manual mobile:
  - lista de conversas
  - drill-in para chat
  - composer
  - drawer/bottom-sheet
- Verificar que nao ha overflow de texto em sidebar, bubbles, botoes e header.

## Arquivos Provavelmente Afetados

Backend:

- `server/src/db/schema.ts`
- `server/src/realtime/socket.ts`
- `server/src/realtime/participants.ts`
- `server/src/types.ts`
- `server/src/modules/chat.ts`
- `server/src/modules/attachments.ts`
- novo `server/src/modules/conversations.ts`
- testes em `server/src/**/*.test.ts`

Frontend:

- `web/src/index.css`
- `web/src/App.tsx`
- `web/src/types/protocol.ts`
- `web/src/state/RoomProvider.tsx`
- `web/src/state/RoomContext.tsx`
- `web/src/state/roomReducer.ts`
- `web/src/components/LeftSidebar.tsx`
- `web/src/components/ChannelTree.tsx`
- `web/src/features/chat/*`
- `web/src/features/sharing/*`
- `web/src/features/settings/*`
- `web/src/features/profile/*`
- novos componentes em `web/src/features/conversations/*`
- componentes beUI em `web/src/components/motion/*` e `web/src/lib/*`

## Decisoes Tomadas (eram "Em Aberto")

- Nome final das abas: "Conversas" e "Pessoas".
- Admin pode gerenciar (renomear, adicionar/remover membro, excluir) qualquer
  grupo por ser admin, nao por ser owner/membro — mesmo padrao que
  `group-delete` ja usava desde a Fase 1. Nao existe visao "todos os grupos
  do servidor" fora dos que o admin ja e membro; nunca foi pedida.
- Membros comuns podem sair de grupos (`group-members-remove` com o proprio
  id).
- Admin adiciona/remove membros depois da criacao (drawer de detalhes,
  Fase 6).
- Sem grupo default "Geral" — banco novo comeca vazio, sem seed.
- Busca (`message-search`) cobre so mensagens das conversas do usuario, nao
  busca usuarios (isso already existe na aba Pessoas).
- Chamadas continuam efemeras, sem historico persistido.

## Definition Of Done

- [x] A aplicacao nao mostra mais categorias/canais no fluxo principal.
- [x] A primeira tela parece um app de conversacao moderno, nao Discord.
- [x] DMs funcionam com qualquer usuario.
- [x] Admin cria grupo e adiciona usuarios (inclusive depois da criacao).
- [x] Mensagens, replies, reactions, edicao, delete, anexos e busca funcionam
  por conversa.
- [x] Chamadas funcionam apenas em grupos.
- [x] Sidebar e chat usam uma linguagem visual alinhada com beUI/Vercel dark.
- [x] Tokens antigos de Discord foram removidos (`blurple`, `channel`,
  `category`, `voiceChannel` — nenhum sobrevive fora do valor interno
  `avatarColor: 'blurple'`, que e um dado ja salvo pra contas reais e nunca
  aparece na tela).
- [x] Testes e build passam (122 testes server, 106 web).

Com isso as 9 fases do plano original (0 a 8) estao concluidas. O que
ficou pra depois, sem ser bloqueador: gatilho de UI pro `kickFromCall`
(admin remover alguem de uma call em andamento) e um fade/gradient de
affordance na aba horizontal do Settings no mobile.
