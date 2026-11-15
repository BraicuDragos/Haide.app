// TODO(E0 BE task 7): replace with imports from '@contracts/*' once supabase/functions/_shared/contracts exists.
export type LatLng = { lat: number; lng: number };
export type Place = {
  id: string;
  name: string;
  secondary: string;
  kind: 'street' | 'poi' | 'address' | 'area';
  point: LatLng;
  areaName: string;
};
