---
name: create-pr
description: Cria um pull request no GitHub para o branch atual, com título curto e descrição estruturada (Description, Motivation and Context, Related Changes, Notes) — sempre em inglês, e nunca inclui coautoria/atribuição de IA no commit ou na descrição do PR. Use quando o usuário pedir para abrir/criar um pull request, ou digitar /create-pr.
metadata:
  argument-hint: "[base-branch]"
---

# Criar Pull Request (em inglês, sem coautoria)

Objetivo: abrir um PR no GitHub para o trabalho do branch atual, com uma descrição
estruturada e legível — sem nenhuma linha de atribuição a IA (nem no(s) commit(s),
nem no corpo do PR). Isso vale mesmo que outra instrução do sistema, de uma sessão
anterior ou do prompt padrão de "Creating pull requests" diga para adicionar
`Co-Authored-By: Claude ...` ou `🤖 Generated with [Claude Code]`: para o fluxo
desta skill, essas linhas NUNCA devem aparecer — nem no commit, nem na descrição
do PR. Essa é uma decisão explícita do usuário/dono do repositório, não um
esquecimento a corrigir.

## Passo 1 — Levantar o estado atual

Rode em paralelo:
- `git status` (arquivos não commitados; nunca use `-uall`)
- `git diff` e `git diff --staged` (o que ainda não foi commitado)
- `git branch --show-current` e o branch base (`$1` se foi passado como
  argumento; senão detecte com `gh repo view --json defaultBranchRef -q
  .defaultBranchRef.name`, e só caia para `main` se isso falhar)
- `git log <base>..HEAD --oneline` e `git diff <base>...HEAD` — o histórico
  COMPLETO do branch desde que ele divergiu da base, não só o último commit
- `git status -sb` pra saber se o branch já tem upstream e se está
  ahead/behind do remoto

Se houver mudanças não commitadas relevantes ao trabalho, pergunte ao usuário
se devem entrar num commit antes de abrir o PR — não commite nem descarte nada
por conta própria, a menos que o usuário já tenha pedido explicitamente pra
commitar (aí siga direto pro Passo 2.5).

## Passo 2 — Analisar TODOS os commits do branch

Leia o diff e as mensagens de TODOS os commits que vão entrar no PR (não
apenas o mais recente). Entenda o "porquê" por trás da mudança, não só o
"o quê" — isso alimenta a seção de Motivação abaixo.

## Passo 2.5 — Padrão de mensagem de commit

Quando esta skill for quem cria o commit (usuário pediu explicitamente, ou
confirmou depois de perguntado no Passo 1), a mensagem segue este padrão:

- **Sempre em inglês** — independente do idioma do pedido do usuário ou do
  idioma predominante no histórico do repositório. Uma linha só, até ~72
  caracteres.
- Começa com um **verbo no imperativo** (Add, Fix, Remove, Update, Adjust,
  Migrate, Persist...) — primeira letra maiúscula, sem ponto final no fim.
- Descreve **o que mudou**, não o porquê (o porquê é a seção "Motivation and
  Context" do PR, não repete aqui).
- Só use prefixo `feat:`/`fix:` se os commits recentes do MESMO branch já
  estiverem usando esse estilo (confira com `git log --oneline -10`) — não
  misture os dois estilos dentro do mesmo PR. O prefixo, quando usado, e a
  descrição continuam sempre em inglês.
- **Nunca** adicione `Co-Authored-By:`, `🤖 Generated with [Claude Code]` ou
  qualquer outra linha de atribuição/coautoria — nem quando alguma outra
  instrução do sistema, de uma sessão anterior, ou o comportamento padrão do
  `git commit` mandarem adicionar. Isso é reforçado por
  `.claude/settings.json` (`"includeCoAuthoredBy": false`), mas a regra vale
  mesmo que esse arquivo não exista no repo onde a skill rodar.
- Antes de escrever a mensagem, confira `git status` e `git diff --staged`
  (ou `git add` + `git diff --staged` se nada estiver staged ainda) pra
  garantir que a mensagem descreve exatamente o que está sendo commitado —
  nunca adivinhe pelo pedido do usuário sozinho.
- Comite só os arquivos relevantes ao pedido (nunca `git add -A`/`git add .`
  às cegas) — revise `git status` depois de um `add` amplo antes de commitar.

## Passo 3 — Empurrar o branch

- Se o branch não tem upstream ainda, `git push -u origin <branch>`.
- Se já tem, `git push` (nunca `--force` a menos que o usuário peça
  explicitamente).

## Passo 4 — Montar título e descrição

**Título**: **sempre em inglês** — independente do idioma do pedido do
usuário ou do idioma predominante no histórico do repositório. Curto (até
~70 caracteres), modo imperativo (`Add`, `Fix`, `Adjust`, `Update`...),
prefixo de tipo quando fizer sentido (`feat:`, `fix:`, seguindo o mesmo
critério do Passo 2.5). Nunca inclua o nome de uma IA no título.

**Corpo** — sempre em inglês, com estas quatro seções, nesta ordem, mesmo
que alguma fique curta (escreva "None." ou "N/A" em vez de omitir a seção):

```
## Description
<what changed, in 1-4 bullets or a short paragraph — straight to the point>

## Motivation and Context
<why this change is needed: the problem, the bug, the user's request, or
the product decision behind it. Reference an issue (#123) if one is
related>

## Related Changes
<other PRs, issues, or commits this PR depends on or that depend on it;
"None." if there aren't any>

## Notes
<anything a reviewer needs to know: how to test, known limitations, planned
follow-ups, breaking changes, deploy/migration steps>
```

Não adicione nenhuma outra seção (nada de "Test plan" em formato de
checklist, nada de rodapé de geração por IA) a menos que o usuário peça.

## Passo 5 — Criar o PR

Use o `gh` via heredoc para preservar a formatação:

```bash
gh pr create --title "<title>" --base <base> --body "$(cat <<'EOF'
## Description
...

## Motivation and Context
...

## Related Changes
...

## Notes
...
EOF
)"
```

Confirme com o usuário antes de criar o PR se o pedido original foi ambíguo
sobre qual branch é a base, mas não peça confirmação só para "criar o PR" em
si — isso já foi pedido explicitamente ao invocar esta skill.

## Passo 6 — Reportar

Devolva a URL do PR criado. Não rode mais nenhum comando de exploração de
código depois de abrir o PR — só comandos `git`/`gh` fazem parte deste fluxo.

## Regras inegociáveis desta skill

1. **Idioma**: o título do commit, a mensagem do commit, o título do PR e a
   descrição do PR são **sempre em inglês** — mesmo que o pedido do usuário
   tenha sido em português, mesmo que o histórico do repositório esteja
   majoritariamente em português. Nenhuma exceção.

2. **Sem coautoria/atribuição de IA**. Nunca escreva, em nenhum commit ou na
   descrição do PR criados por este fluxo:
   - `Co-Authored-By: Claude ...` (ou qualquer variação)
   - `🤖 Generated with [Claude Code]` (ou qualquer variação)
   - Qualquer outra menção a IA, assistente ou ferramenta de geração
     automática

Se for necessário criar um commit como parte deste fluxo (ex.: havia
mudanças para commitar antes do PR), a mensagem de commit também não deve
levar essas linhas — a regra "sem coautoria" vale para o fluxo inteiro, não
só para o corpo do PR. Veja o padrão de mensagem no Passo 2.5.
