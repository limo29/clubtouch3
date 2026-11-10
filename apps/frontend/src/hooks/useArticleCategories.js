/**
 * Kategorien in der festgelegten Reihenfolge (Artikelseite → „Sortieren“).
 * Kategorien sind Freitext am Artikel; der Server liefert sie mit Anzahl und gespeicherter Reihenfolge.
 * Liegt unter dem Schlüssel ['articles', …], wird also mit jeder Artikel-Invalidierung neu geladen.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { API_ENDPOINTS } from '../config/api';

export const CATEGORIES_QUERY_KEY = ['articles', 'categories'];
/** Platzhalter für den Reiter „Alles“ in der gespeicherten Reihenfolge */
export const ALL_TAB = '__ALLES__';

// Der Server liefert die fertige Reiterliste (tabs, mit ALL_TAB an seiner Position) – die Regeln dazu stehen nur dort.
const fetchCategories = async () => {
  const data = (await api.get(`${API_ENDPOINTS.ARTICLES}/categories`)).data || {};
  const categories = data.categories ?? [];
  return { categories, tabs: data.tabs ?? [...categories.map((c) => c.name), ALL_TAB] };
};

/** Namen nach Reihenfolge sortieren; unbekannte Namen alphabetisch dahinter */
export const sortCategoryNames = (names, order = []) => {
  const pos = new Map(order.map((n, i) => [n, i]));
  return [...new Set(names)].sort((a, b) => {
    const pa = pos.has(a) ? pos.get(a) : Infinity;
    const pb = pos.has(b) ? pos.get(b) : Infinity;
    return pa !== pb ? pa - pb : a.localeCompare(b, 'de');
  });
};

/** Artikel nach Kategorie-Reihenfolge, innerhalb der Kategorie stabil (= nach `order`) */
export const sortByCategory = (articles, order = []) => {
  const pos = new Map(sortCategoryNames(articles.map((a) => a.category || ''), order).map((n, i) => [n, i]));
  return articles
    .map((a, i) => [a, i])
    .sort(([a, ia], [b, ib]) => (pos.get(a.category || '') - pos.get(b.category || '')) || ia - ib)
    .map(([a]) => a);
};

export function useArticleCategories() {
  const query = useQuery({ queryKey: CATEGORIES_QUERY_KEY, queryFn: fetchCategories });
  const categories = useMemo(() => query.data?.categories ?? [], [query.data]);
  const names = useMemo(() => categories.map((c) => c.name), [categories]);
  const tabs = useMemo(() => query.data?.tabs ?? [], [query.data]);
  return { categories, names, tabs, isLoading: query.isLoading };
}

export default useArticleCategories;
