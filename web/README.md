# Frontend do Linkord

Aplicação React + TypeScript + Vite do Linkord. A documentação completa de instalação, arquitetura e deploy fica no [`README.md` da raiz](../README.md).

## Desenvolvimento isolado

Com o backend já disponível em `http://localhost:3000`:

```bash
npm ci
npm run dev
```

O Vite abre `http://localhost:5173` e encaminha `/api`, `/uploads` e `/ws` para o backend.

## Verificações

```bash
npm test
npm run lint
npm run build
```
