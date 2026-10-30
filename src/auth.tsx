import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import type { User } from '../shared/types';
import { api } from './api';
import { closeWorkspace, openWorkspace } from './data/workspace';
import { browserBackend } from './storage/browser';
import { signInWithGoogle } from './storage/drive';

export const ME_KEY = ['me'];

/** The person whose data is open, or null when nothing is open (the sign-in screen). */
export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: api.me, staleTime: Infinity, retry: false });
}

/**
 * Marks the user signed out and drops everyone else's cached data. `queryClient.clear()` would
 * also detach the `me` query the app is observing, leaving it stuck on a signed-in screen.
 */
export function forgetUser(qc: QueryClient) {
  qc.setQueryData(ME_KEY, null);
  qc.removeQueries({ predicate: q => q.queryKey[0] !== ME_KEY[0] });
}

/** Opens the data: from Google Drive (opens Google's sign-in, so run it from a click) or this browser. */
export function useSignIn() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (storage: User['storage']) => {
      await openWorkspace(storage === 'drive' ? await signInWithGoogle() : browserBackend());

      return api.me();
    },
    onSuccess: user => qc.setQueryData(ME_KEY, user),
  });
}

/** Saves anything pending, then signs out. Fails (and stays signed in) if the last change can't be saved. */
export function useSignOut() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: closeWorkspace,
    onSuccess: () => forgetUser(qc),
  });
}
