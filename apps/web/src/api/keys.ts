/** Query keys in one place (architecture §11). Add one factory per resource. */
export const keys = {
  places: {
    all: ['places'] as const,
    search: (q: string) => ['places', 'search', q] as const,
  },
  legal: ['legal'] as const,
  me: ['me'] as const,
  vehicle: ['me', 'vehicle'] as const,
  user: (id: string) => ['users', id] as const,
} as const;
