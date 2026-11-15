// API types come straight from the backend contracts. Type-only imports: no zod at runtime, so the
// bundle does not grow, and a contract change breaks the web typecheck instead of drifting.
import type {
  FuelType,
  LegalCurrentResponse,
  MeResponse,
  PublicUser,
  VehicleResponse,
} from '@contracts/account';
import type { LatLng, Place } from '@contracts/geo';

export type { FuelType, LatLng, Place, PublicUser };
export type Me = MeResponse;
export type Vehicle = VehicleResponse;
export type LegalCurrent = LegalCurrentResponse;
