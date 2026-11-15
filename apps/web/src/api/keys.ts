/** Query keys in one place (architecture §11). Add one factory per resource. */
export const keys = {
  places: {
    all: ['places'] as const,
    search: (q: string) => ['places', 'search', q] as const,
  },
} as const;
