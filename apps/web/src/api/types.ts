// API types come straight from the backend contracts. Type-only imports: no zod at runtime, so the
// bundle does not grow, and a contract change breaks the web typecheck instead of drifting.
import type {
  FuelType,
  LegalCurrentResponse,
  MeResponse,
  PublicUser,
  VehicleResponse,
} from '@contracts/account';
import type {
  BookingListItem as BookingListItemBase,
  BookingView as BookingViewBase,
  CancelledBy,
  SummaryResponse,
} from '@contracts/bookings';
import type { LatLng, Place } from '@contracts/geo';
import type { PopularRoute as PopularRouteBase, PopularRoutesResponse } from '@contracts/popular';
import type {
  CreateRideBody,
  GeoLineString,
  PreviewBody,
  PreviewResponse,
  PriceRow,
  RideListItem as RideListItemBase,
  RideOwnerView,
  RidePassengerItem as RidePassengerItemBase,
  RidePublicView,
  RideStatus,
} from '@contracts/rides';
import type {
  MatchResponse,
  NotBookableReason,
  SearchBody,
  SearchItem,
  SearchPlace,
  SearchResponse,
} from '@contracts/search';

export type { FuelType, LatLng, Place, PublicUser };
export type Me = MeResponse;
export type Vehicle = VehicleResponse;
export type LegalCurrent = LegalCurrentResponse;

// Rides (E2): types from the backend contracts (type-only, no zod at runtime).
export type { PriceRow, RideStatus };
export type RoutePreview = PreviewResponse;
export type RoutePreviewRequest = PreviewBody;
export type PublishRideRequest = CreateRideBody;
export type RouteLine = GeoLineString;

// Popular routes: public, gazetteer places as returned.
export type PopularRoute = PopularRouteBase;
export type { PopularRoutesResponse };

// Search and matching (E3).
export type { MatchResponse, NotBookableReason, SearchResponse };
export type SearchRequest = SearchBody;
export type SearchResultItem = SearchItem;
export type RideStopPublic = SearchPlace;
export type PublicRide = RidePublicView;

// Bookings (E4) and trust and safety (E5). The E5 fields are written here as optional additions to the contract types
// (e5-trust-safety-spec section 6) so the screens compile against the contract before and after the backend lands
// them. A missing field always reads as "not allowed / nothing to show".
export type { CancelledBy, SummaryResponse };
export type { BookingStatus, ExactOrApproxPoint, RideRequestItem } from '@contracts/rides';

export type RatingTag =
  'punctual' | 'friendly' | 'safe_driving' | 'clean_car' | 'respectful' | 'on_time_at_pickup';
export type RatingGiven = { stars: number; tags: RatingTag[]; createdAt: string };
export type Call112Window = { from: string; until: string };
export type ReportReason =
  'no_show' | 'unsafe_driving' | 'harassment' | 'extra_money' | 'fake_profile' | 'other';

export type BookingView = Omit<BookingViewBase, 'actions'> & {
  completedAt?: string | null;
  noShowBy?: 'driver' | 'passenger' | null;
  /** The viewer's own rating only. */
  rating?: { given: RatingGiven | null; rateUntil: string | null };
  /** Passenger viewer only. */
  share?: { active: boolean; expiresAt: string | null } | null;
  actions: BookingViewBase['actions'] & {
    canMarkNoShow?: boolean;
    call112Window?: Call112Window | null;
  };
};
export type BookingListItem = BookingListItemBase & {
  cancelledBy?: CancelledBy | null;
  canRate?: boolean;
};
export type BookingListResponse = { items: BookingListItem[]; nextCursor: string | null };

export type RideListItem = RideListItemBase & { toRate?: number };
export type RideListResponse = { items: RideListItem[]; nextCursor: string | null };

export type RidePassengerItem = RidePassengerItemBase & {
  noShowBy?: 'driver' | 'passenger' | null;
  rateUntil?: string | null;
  ratingGiven?: RatingGiven | null;
};
export type OwnerRide = Omit<RideOwnerView, 'passengers'> & {
  passengers: RidePassengerItem[];
  completedAt?: string | null;
  show112?: boolean;
  call112Window?: Call112Window | null;
};

export type SharedTrip = {
  departureAt: string;
  pickupEtaAt: string;
  phase: 'before' | 'underway' | 'done';
  expiresAt: string;
  driver: { firstName: string; photoUrl: string | null };
  car: { make: string; model: string; colour: string; plate: string };
  pickup: { label: string };
  dropoff: { label: string };
  /** The passenger's own segment only. */
  route: GeoLineString | null;
};
export type BlockedUser = { user: PublicUser; blockedAt: string };
