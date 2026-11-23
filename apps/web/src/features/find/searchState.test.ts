import { beforeEach, describe, expect, it } from 'vitest';
import type { Place } from '@/api/types';
import { readSearch, saveSearch, toRequest, type SearchCriteria } from './searchState';

const place = (id: string, name: string, lat: number, lng: number): Place => ({
  id,
  name,
  secondary: '',
  kind: 'area',
  point: { lat, lng },
  areaName: name,
});

const criteria: SearchCriteria = {
  from: place('a', 'Șelimbăr', 45.759512345, 24.212812345),
  to: place('b', 'Zona Industrială Vest', 45.7926, 24.0973),
  day: '2026-11-17',
  time: '07:30',
  win: '30',
};

describe('search state', () => {
  beforeEach(() => sessionStorage.clear());

  it('round-trips through sessionStorage', () => {
    expect(readSearch()).toBeNull();
    saveSearch(criteria);
    expect(readSearch()).toEqual(criteria);
  });

  it('ignores corrupt storage and falls back to the memory copy', () => {
    saveSearch(criteria);
    sessionStorage.setItem('haide.search', '{"from":1}');
    expect(readSearch()).toEqual(criteria);
  });

  it('keeps the approximate flag through the storage round trip', () => {
    const c: SearchCriteria = {
      ...criteria,
      from: { ...place('approx:x', 'Strada Negoveanu 2', 45.7856, 24.1747), approximate: true },
    };
    saveSearch(c);
    expect(sessionStorage.getItem('haide.search')).toContain('"approximate":true');
    expect(readSearch()?.from.approximate).toBe(true);
    expect(readSearch()?.from.name).toBe('Strada Negoveanu 2');
    expect(readSearch()?.to.approximate).toBeUndefined();
  });

  it('still loads a stored value written before the flag existed', () => {
    sessionStorage.setItem('haide.search', JSON.stringify(criteria));
    expect(readSearch()).toEqual(criteria);
  });

  it('POST /search stays coordinates only for an approximate place', () => {
    const body = toRequest({
      ...criteria,
      from: { ...criteria.from, approximate: true },
    });
    expect(JSON.stringify(body)).not.toContain('approximate');
    expect(body.from).toEqual({ lat: 45.75951, lng: 24.21281 });
  });

  it('builds the POST /search body: 5-decimal points, numeric window, no place names', () => {
    const body = toRequest(criteria);
    expect(body).toEqual({
      from: { lat: 45.75951, lng: 24.21281 },
      to: { lat: 45.7926, lng: 24.0973 },
      date: '2026-11-17',
      time: '07:30',
      windowMin: 30,
    });
    expect(JSON.stringify(body)).not.toContain('Șelimbăr');
  });
});
