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
import type {
  CreateRideBody,
  GeoLineString,
  PreviewBody,
  PreviewResponse,
  PriceRow,
  RideListItem,
  RideListResponse,
  RideOwnerView,
  RideStatus,
} from '@contracts/rides';

export type { FuelType, LatLng, Place, PublicUser };
export type Me = MeResponse;
export type Vehicle = VehicleResponse;
export type LegalCurrent = LegalCurrentResponse;

// Rides (E2): types from the backend contracts (type-only, no zod at runtime).
export type { PriceRow, RideListItem, RideListResponse, RideStatus };
export type RoutePreview = PreviewResponse;
export type RoutePreviewRequest = PreviewBody;
export type PublishRideRequest = CreateRideBody;
export type OwnerRide = RideOwnerView;
export type RouteLine = GeoLineString;
