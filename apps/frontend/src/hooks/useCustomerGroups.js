import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { API_ENDPOINTS } from '../config/api';

/** Präfix für invalidateQueries: trifft beide Varianten (nur aktive / mit inaktiven). */
export const CUSTOMER_GROUPS_KEY = ['customer-groups'];

/**
 * Kundengruppen als Array. Alle Stellen laden über diesen Hook, damit der Cache unter einem Schlüssel
 * immer dieselbe Form hat (früher lag dort mal das Array, mal { groups } – die Kundenseite sah dann keine Gruppen).
 * includeInactive nur für die Gruppenverwaltung.
 */
export function useCustomerGroups({ includeInactive = false, enabled = true } = {}) {
  const query = useQuery({
    queryKey: [...CUSTOMER_GROUPS_KEY, includeInactive ? 'all' : 'active'],
    queryFn: async () => {
      const res = await api.get(API_ENDPOINTS.CUSTOMER_GROUPS, { params: includeInactive ? { includeInactive: true } : {} });
      return Array.isArray(res.data?.groups) ? res.data.groups : [];
    },
    staleTime: 60000,
    enabled,
  });
  return { ...query, groups: query.data || [] };
}
