import { describe, expect, it } from 'vitest';
import { parseInline, parseMessage, previewableLinks, trimUrl } from '@/features/chat/messageMarkup';

describe('parseInline', () => {
  it('negrito, italico, riscado e codigo', () => {
    expect(parseInline('**forte** *leve* ~~feito~~ `x = 1`')).toEqual([
      { type: 'bold', children: [{ type: 'text', text: 'forte' }] },
      { type: 'text', text: ' ' },
      { type: 'italic', children: [{ type: 'text', text: 'leve' }] },
      { type: 'text', text: ' ' },
      { type: 'strike', children: [{ type: 'text', text: 'feito' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'x = 1' },
    ]);
  });

  it('enfase aninhada nao perde o resto do texto', () => {
    expect(parseInline('antes **a _b_ c** depois')).toEqual([
      { type: 'text', text: 'antes ' },
      { type: 'bold', children: [{ type: 'text', text: 'a ' }, { type: 'italic', children: [{ type: 'text', text: 'b' }] }, { type: 'text', text: ' c' }] },
      { type: 'text', text: ' depois' },
    ]);
  });

  it('dentro de codigo nada e especial: nem mencao, nem link, nem enfase', () => {
    expect(parseInline('`@ana https://x.com **y**`')).toEqual([{ type: 'code', text: '@ana https://x.com **y**' }]);
  });

  it('mencao so no inicio de palavra: e-mail nao vira mencao', () => {
    expect(parseInline('fale com @ana ou ana@exemplo.com').filter((n) => n.type === 'mention')).toEqual([{ type: 'mention', name: 'ana' }]);
  });

  it('ponto final depois da mencao nao entra no nome', () => {
    expect(parseInline('oi @ana.')).toEqual([{ type: 'text', text: 'oi ' }, { type: 'mention', name: 'ana' }, { type: 'text', text: '.' }]);
  });

  it('link: pontuacao final e parentese sem par ficam fora; sublinhado na URL nao vira italico', () => {
    expect(parseInline('veja (https://ex.com/a_b_c).')).toEqual([
      { type: 'text', text: 'veja (' },
      { type: 'link', url: 'https://ex.com/a_b_c', suppressed: false },
      { type: 'text', text: ').' },
    ]);
  });

  it('<url> e um link sem previa', () => {
    expect(parseInline('<https://ex.com>')).toEqual([{ type: 'link', url: 'https://ex.com', suppressed: true }]);
  });

  it('asteriscos soltos continuam texto', () => {
    expect(parseInline('2 * 3 = 6')).toEqual([{ type: 'text', text: '2 * 3 = 6' }]);
  });

  it('snake_case nao vira italico', () => {
    expect(parseInline('use minha_var_aqui')).toEqual([{ type: 'text', text: 'use minha_var_aqui' }]);
  });

  it('HTML bruto e so texto', () => {
    expect(parseInline('<b>oi</b><script>x</script>')).toEqual([{ type: 'text', text: '<b>oi</b><script>x</script>' }]);
  });
});

describe('trimUrl', () => {
  it('mantem parenteses balanceados (wikipedia)', () => {
    expect(trimUrl('https://pt.wikipedia.org/wiki/Java_(linguagem)')).toBe('https://pt.wikipedia.org/wiki/Java_(linguagem)');
  });
});

describe('parseMessage', () => {
  it('bloco de codigo com linguagem, citacao e listas', () => {
    const blocks = parseMessage('intro\n```ts\nconst a = 1;\n```\n> citado\n> segunda\n- um\n- dois\n1. primeiro');
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'code', 'quote', 'list', 'list']);
    expect(blocks[1]).toEqual({ type: 'code', lang: 'ts', code: 'const a = 1;' });
    expect(blocks[3]).toMatchObject({ ordered: false, items: [[{ type: 'text', text: 'um' }], [{ type: 'text', text: 'dois' }]] });
    expect(blocks[4]).toMatchObject({ ordered: true });
  });

  it('cerca sem fechamento continua texto', () => {
    expect(parseMessage('```\nsem fim').map((b) => b.type)).toEqual(['paragraph']);
  });

  it('mensagem antiga comum nao muda: quebras de linha preservadas, sem titulos', () => {
    expect(parseMessage('# nao e titulo\nlinha 2')).toEqual([{ type: 'paragraph', children: [{ type: 'text', text: '# nao e titulo\nlinha 2' }] }]);
  });
});

describe('previewableLinks', () => {
  it('ignora links em codigo e suprimidos, remove repetidos e limita a tres', () => {
    const text = '`https://code.com` <https://quiet.com> https://a.com https://a.com https://b.com?q=1 https://c.com https://d.com';
    expect(previewableLinks(parseMessage(text))).toEqual(['https://a.com', 'https://b.com?q=1', 'https://c.com']);
  });

  it('bloco de codigo nao gera previa', () => {
    expect(previewableLinks(parseMessage('```\nhttps://x.com\n```'))).toEqual([]);
  });
});
