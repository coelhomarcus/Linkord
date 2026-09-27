import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { PartialAttachmentError, useAttachmentsUpload } from '@/features/chat/useAttachmentsUpload';
import { uploadFileInChunks } from '@/shared/lib/chunkedUpload';

vi.mock('@/shared/lib/chunkedUpload', () => ({ uploadFileInChunks: vi.fn() }));
const upload = vi.mocked(uploadFileInChunks);

const files = ['a', 'b', 'c'].map((name) => new File(['x'], `${name}.pdf`, { type: 'application/pdf' }));

describe('useAttachmentsUpload.sendAttachments', () => {
  beforeEach(() => upload.mockReset());

  it('o primeiro arquivo cria a mensagem (com legenda e resposta); os demais anexam a ela', async () => {
    upload.mockResolvedValue(7);
    const onFileSent = vi.fn();
    const { result } = renderHook(() => useAttachmentsUpload());

    await result.current.sendAttachments({ conversationId: 'c', files, caption: 'oi', replyTo: 3, onFileSent });

    expect(upload.mock.calls.map(([opts]) => [opts.caption, opts.replyTo, opts.targetMsgId])).toEqual([
      ['oi', 3, undefined], ['', undefined, 7], ['', undefined, 7],
    ]);
    expect(onFileSent.mock.calls).toEqual([[0, 7], [1, 7], [2, 7]]);
  });

  it('falha depois do primeiro vira PartialAttachmentError com a mensagem e o indice que falhou', async () => {
    upload.mockResolvedValueOnce(7).mockResolvedValueOnce(7).mockRejectedValueOnce(new Error('rede'));
    const { result } = renderHook(() => useAttachmentsUpload());

    const err = await result.current.sendAttachments({ conversationId: 'c', files, caption: '' }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PartialAttachmentError);
    expect(err).toMatchObject({ msgId: 7, failedIndex: 2, totalCount: 3 });
  });

  it('falha no primeiro arquivo propaga o erro original: nada foi publicado', async () => {
    const original = new Error('rede');
    upload.mockRejectedValueOnce(original);
    const { result } = renderHook(() => useAttachmentsUpload());

    await expect(result.current.sendAttachments({ conversationId: 'c', files, caption: '' })).rejects.toBe(original);
  });

  it('com targetMsgId, todos os arquivos anexam a mensagem existente', async () => {
    upload.mockResolvedValue(7);
    const { result } = renderHook(() => useAttachmentsUpload());

    await result.current.sendAttachments({ conversationId: 'c', files: files.slice(1), caption: '', targetMsgId: 7 });

    expect(upload.mock.calls.map(([opts]) => opts.targetMsgId)).toEqual([7, 7]);
  });
});
