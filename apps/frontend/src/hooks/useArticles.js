/**
 * Ein Hook, ein Query-Key für Artikel.
 * Lädt alle Artikel (inkl. inaktive) einmal, normalisiert sie und liefert
 * standardmäßig nur die aktiven zurück. Nach Mutationen, die Bestand oder
 * Artikel ändern, reicht `queryClient.invalidateQueries({ queryKey: ARTICLES_QUERY_KEY })`.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { API_ENDPOINTS } from '../config/api';
import { num } from '../utils/format';
import { crateFactor } from '../utils/units';

export const ARTICLES_QUERY_KEY = ['articles'];

export const normalizeArticle = (a) => ({
  ...a,
  price: num(a.price),
  stock: num(a.stock),
  minStock: num(a.minStock),
  order: num(a.order),
  unit: a.unit || 'Stück',
  purchaseUnit: a.purchaseUnit || 'Kiste',
  unitsPerPurchase: crateFactor(a),
  active: a.active !== false,
});

const sortArticles = (list) =>
  [...list].sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name, 'de'));

const fetchArticles = async () => {
  const res = await api.get(`${API_ENDPOINTS.ARTICLES}?includeInactive=true`);
  const raw = Array.isArray(res.data) ? res.data : (res.data?.articles ?? []);
  return sortArticles((raw || []).map(normalizeArticle));
};

/**
 * @param {{ activeOnly?: boolean }} options
 * @returns {{ articles: Array, allArticles: Array, isLoading: boolean, error: any, refetch: Function }}
 */
export function useArticles({ activeOnly = true } = {}) {
  const query = useQuery({ queryKey: ARTICLES_QUERY_KEY, queryFn: fetchArticles });
  const allArticles = useMemo(() => query.data ?? [], [query.data]);
  const articles = useMemo(
    () => (activeOnly ? allArticles.filter((a) => a.active) : allArticles),
    [allArticles, activeOnly]
  );
  return {
    articles,
    allArticles,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}

export default useArticles;
