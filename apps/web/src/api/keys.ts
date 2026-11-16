/** Query keys in one place (architecture §11). Add one factory per resource. */
export const keys = {
  places: {
    all: ['places'] as const,
    search: (q: string) => ['places', 'search', q] as const,
  },
  legal: ['legal'] as const,
  me: ['me'] as const,
  vehicle: ['me', 'vehicle'] as const,
  rides: {
    all: ['rides'] as const,
    list: (scope: 'upcoming' | 'past') => ['rides', 'list', scope] as const,
    mine: (id: string) => ['rides', 'mine', id] as const,
  },
  search: (body: unknown) => ['search', body] as const,
  ride: (id: string) => ['rides', 'public', id] as const,
  match: (id: string, body: unknown) => ['rides', 'match', id, body] as const,
  bookings: {
    all: ['bookings'] as const,
    list: (scope: 'upcoming' | 'past') => ['bookings', 'list', scope] as const,
    one: (id: string) => ['bookings', 'one', id] as const,
  },
  summary: ['summary'] as const,
  user: (id: string) => ['users', id] as const,
} as const;
