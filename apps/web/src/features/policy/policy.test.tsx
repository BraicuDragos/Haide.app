import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPolicy } from './content';
import { PrivacyScreen, TermsScreen } from './screens/PolicyScreen';

// jsdom has no SVG geometry; the branded loader measures its path.
vi.mock('@/ui/Loader', () => ({ Loader: () => <div role="status">Loading</div> }));

afterEach(cleanup);

function renderScreen(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('policy content v1.1', () => {
  it('both documents are version 1.1 (matches the legal_documents migration)', async () => {
    expect((await loadPolicy('terms')).version).toBe('1.1');
    expect((await loadPolicy('privacy')).version).toBe('1.1');
  });

  it('terms carry the cost-sharing, age and ride-limit clauses', async () => {
    const text = (await loadPolicy('terms')).sections.flatMap((s) => s.body).join(' ');
    expect(text).toMatch(/makes no profit/);
    expect(text).toMatch(/extra payments, surcharges or tips/);
    expect(text).toMatch(/one they would make anyway/);
    expect(text).toMatch(/18 or older/);
    expect(text).toMatch(/up to 4 rides a day/);
    expect(text).toMatch(/up to 4 passengers/);
  });

  it('privacy covers controller, lawful bases, processors, retention, rights and ANSPDCP', async () => {
    const doc = await loadPolicy('privacy');
    const ids = doc.sections.map((s) => s.id);
    for (const id of ['controller', 'purposes', 'processors', 'retention', 'rights', 'complaints'])
      expect(ids).toContain(id);
    const text = doc.sections.flatMap((s) => s.body).join(' ');
    expect(text).toMatch(/\[name, registration number and address to be added before launch\]/);
    expect(text).toMatch(/ANSPDCP/);
    expect(text).toMatch(/anspdcp@dataprotection\.ro/);
  });

  it('section ids are unique so anchors work', async () => {
    for (const kind of ['terms', 'privacy'] as const) {
      const ids = (await loadPolicy(kind)).sections.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('PolicyScreen', () => {
  it('renders the terms with a contents list that links to every section', async () => {
    renderScreen(<TermsScreen />);
    expect(await screen.findByText(/Version 1\.1, in force from 21 November 2026/)).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Contents' });
    const links = nav.querySelectorAll('a');
    expect(links.length).toBeGreaterThan(5);
    for (const a of links) {
      const id = a.getAttribute('href')!.slice(1);
      expect(document.getElementById(id)).not.toBeNull();
    }
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of use' })).toBeTruthy();
  });

  it('renders the privacy policy', async () => {
    renderScreen(<PrivacyScreen />);
    expect(await screen.findByRole('heading', { name: /Complaints/ })).toBeTruthy();
  });
});
