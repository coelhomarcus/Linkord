import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { RequestsRedirect } from '@/features/friends/RequestsRedirect';

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}${location.hash}`}</p>;
}

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app/requests" element={<RequestsRedirect />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequestsRedirect (links antigos)', () => {
  it('/app/requests vai para as solicitacoes recebidas', () => {
    at('/app/requests');
    expect(screen.getByTestId('where')).toHaveTextContent('/app/friends?tab=pending#received');
  });

  it('/app/requests?tab=invitations vai para os convites', () => {
    at('/app/requests?tab=invitations');
    expect(screen.getByTestId('where')).toHaveTextContent('/app/friends?tab=invitations');
  });

  it('com barra final e tab desconhecida ainda cai nas recebidas', () => {
    at('/app/requests/?tab=outra');
    expect(screen.getByTestId('where')).toHaveTextContent('/app/friends?tab=pending#received');
  });
});
