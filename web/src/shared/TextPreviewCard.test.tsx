import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextPreviewCard } from './TextPreviewCard';

vi.mock('./lib/highlightCode', () => ({ highlightCode: vi.fn(async () => null) }));

function mockFetchOnce(response: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => response })));
}

describe('TextPreviewCard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renderiza markdown (titulo vira <h1>, nao aparece como texto cru)', async () => {
    mockFetchOnce({ previewable: true, content: '# Ola\n\ntexto', truncated: false, totalSize: 20, language: 'markdown' });
    render(<TextPreviewCard attachment={{ id: 'md-id', name: 'notas.md', mime: 'text/markdown', size: 20 }} />);

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Ola' })).toBeInTheDocument());
  });

  it('sanitiza link markdown com esquema perigoso (javascript:)', async () => {
    mockFetchOnce({ previewable: true, content: '[clique](javascript:alert(1))', truncated: false, totalSize: 30, language: 'markdown' });
    render(<TextPreviewCard attachment={{ id: 'md-id', name: 'notas.md', mime: 'text/markdown', size: 30 }} />);

    const link = await screen.findByText('clique');
    expect(link.closest('a')?.getAttribute('href')).not.toBe('javascript:alert(1)');
  });

  it('arquivo de codigo sem highlight disponivel cai pro <pre> simples', async () => {
    mockFetchOnce({ previewable: true, content: 'print(1)', truncated: false, totalSize: 8, language: 'python' });
    render(<TextPreviewCard attachment={{ id: 'py-id', name: 'script.py', mime: 'text/x-python', size: 8 }} />);

    await waitFor(() => expect(screen.getByText('print(1)').tagName).toBe('PRE'));
  });

  it('botao "Mostrar mais/menos" alterna a altura colapsada', async () => {
    const user = userEvent.setup();
    mockFetchOnce({ previewable: true, content: 'linha unica', truncated: false, totalSize: 11, language: 'text' });
    render(<TextPreviewCard attachment={{ id: 'txt-id', name: 'notas.txt', mime: 'text/plain', size: 11 }} />);

    const toggle = await screen.findByRole('button', { name: /Mostrar mais/ });
    await user.click(toggle);
    expect(screen.getByRole('button', { name: /Mostrar menos/ })).toBeInTheDocument();
  });

  it('mostra "Baixar pra ver tudo" so quando truncated', async () => {
    mockFetchOnce({ previewable: true, content: 'so um pedaco', truncated: true, totalSize: 999999, language: 'text' });
    render(<TextPreviewCard attachment={{ id: 'txt-id', name: 'log.txt', mime: 'text/plain', size: 999999 }} />);

    expect(await screen.findByText('Baixar pra ver tudo')).toBeInTheDocument();
  });

  it('previewable false nao mostra corpo de preview, so o card de arquivo', async () => {
    mockFetchOnce({ previewable: false });
    render(<TextPreviewCard attachment={{ id: 'bin-id', name: 'dados.log', mime: 'text/plain', size: 50 }} />);

    await waitFor(() => expect(screen.queryByRole('button', { name: /Mostrar mais/ })).not.toBeInTheDocument());
    expect(screen.getByText('dados.log')).toBeInTheDocument();
  });
});
