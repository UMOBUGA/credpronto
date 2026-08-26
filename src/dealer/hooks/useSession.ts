import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/shared/lib/api'
import type { DealerUser } from '@/shared/types'

export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => apiFetch<{ user: DealerUser | null }>('/api/auth/session'),
  })
}
