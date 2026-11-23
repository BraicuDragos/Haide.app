import { describe, expect, it } from 'vitest';
import { toPreviewRequest } from './rides';
import type { Place } from './types';

const place = (name: string, approximate?: boolean): Place => ({
  id: name,
  name,
  secondary: '',
  kind: 'address',
  point: { lat: 45.78, lng: 24.17 },
  areaName: 'Terezian',
  ...(approximate === undefined ? {} : { approximate }),
});

describe('toPreviewRequest', () => {
  it('sends the approximate flags only for approximate places, with the label exactly as picked', () => {
    const body = toPreviewRequest(place('Strada Negoveanu 2', true), place('Piața Mare'));
    expect(body.originLabel).toBe('Strada Negoveanu 2');
    expect(body.originApproximate).toBe(true);
    expect(body).not.toHaveProperty('destinationApproximate');
  });

  it('sends no flags when neither place is approximate', () => {
    const body = toPreviewRequest(place('A', false), place('B'));
    expect(body).not.toHaveProperty('originApproximate');
    expect(body).not.toHaveProperty('destinationApproximate');
  });

  it('flags the destination independently', () => {
    const body = toPreviewRequest(place('A'), place('Strada X 2/B', true));
    expect(body.destinationApproximate).toBe(true);
    expect(body.destinationLabel).toBe('Strada X 2/B');
  });
});
