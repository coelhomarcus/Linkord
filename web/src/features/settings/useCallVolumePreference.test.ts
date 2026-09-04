import { beforeEach, describe, expect, it } from 'vitest';
import { loadCallVolume, saveCallVolume } from './useCallVolumePreference';

beforeEach(() => {
  localStorage.clear();
});

describe('loadCallVolume / saveCallVolume', () => {
  it('sem nada salvo, default e 1 (100%)', () => {
    expect(loadCallVolume('user-1')).toBe(1);
  });

  it('save/load faz round-trip pra uma chave especifica', () => {
    saveCallVolume('user-1', 0.2);
    expect(loadCallVolume('user-1')).toBe(0.2);
  });

  it('chaves diferentes (mic vs tela de uma pessoa) nao se sobrescrevem', () => {
    saveCallVolume('user-1', 0.2);
    saveCallVolume('user-1:screen', 0.8);
    expect(loadCallVolume('user-1')).toBe(0.2);
    expect(loadCallVolume('user-1:screen')).toBe(0.8);
  });

  it('JSON corrompido no localStorage nao lanca — cai no default', () => {
    localStorage.setItem('ss-call-volumes', '{ isso nao e json valido');
    expect(loadCallVolume('user-1')).toBe(1);
  });

  it('clampa entre 0 e 1', () => {
    saveCallVolume('user-1', 5);
    // saveCallVolume nao clampa na escrita (quem chama ja manda 0..1) — o
    // clamp de protecao e no LOAD, contra um valor que tenha entrado torto
    // de qualquer jeito (edicao manual do localStorage, versao antiga etc.).
    expect(loadCallVolume('user-1')).toBe(1);
  });
});
