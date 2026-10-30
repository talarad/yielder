import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import type { User } from '../shared/types';
import { api, ApiError } from './api';

export const ME_KEY = ['me'];

/** The signed-in user, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<User | null> => {
      try {
        return await api.me();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          return null;
        }

        throw err;
      }
    },
    staleTime: Infinity,
  });
}

/**
 * Marks the user signed out and drops everyone else's cached data. `queryClient.clear()` would
 * also detach the `me` query the app is observing, leaving it stuck on a signed-in screen.
 */
export function forgetUser(qc: QueryClient) {
  qc.setQueryData(ME_KEY, null);
  qc.removeQueries({ predicate: q => q.queryKey[0] !== ME_KEY[0] });
}

export function useSignOut() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: api.logout,
    onSettled: () => forgetUser(qc),
  });
}
