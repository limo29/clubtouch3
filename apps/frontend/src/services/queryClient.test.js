import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { queryClient, checkQueryFn } from './queryClient';

describe('Schutz vor doppelt belegten Query-Schlüsseln', () => {
  let spy;
  beforeEach(() => { spy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { spy.mockRestore(); queryClient.clear(); });

  test('gleich geschriebene Abfragen sind erlaubt', () => {
    expect(checkQueryFn('["a"]', async () => 1)).toBeNull();
    expect(checkQueryFn('["a"]', async () => 1)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  test('verschiedene Abfragen unter einem Schlüssel werden gemeldet (einmal)', () => {
    checkQueryFn('["b"]', async () => ({ groups: [] }));
    expect(checkQueryFn('["b"]', async () => [])).toMatch(/zwei verschiedenen Abfragen/);
    expect(checkQueryFn('["b"]', async () => 'drittes')).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('greift beim Einhängen echter useQuery-Aufrufe', () => {
    const A = () => { useQuery({ queryKey: ['doppelt'], queryFn: async () => ({ groups: [] }) }); return null; };
    const B = () => { useQuery({ queryKey: ['doppelt'], queryFn: async () => [] }); return null; };
    render(<QueryClientProvider client={queryClient}><A /><B /></QueryClientProvider>);
    expect(spy.mock.calls.some((c) => /\["doppelt"\]/.test(c[0]))).toBe(true);
  });
});
