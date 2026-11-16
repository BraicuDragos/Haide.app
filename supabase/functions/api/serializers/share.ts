import { sharedTripSchema, type SharedTrip } from '../../_shared/contracts/safety.ts';

/**
 * Last line of defence for the public share page (ADR 0026). The response is rebuilt through the
 * contract schema, which is not `passthrough`: any field the service adds by mistake (a phone, the
 * passenger, the driver's origin) is dropped before it reaches an anonymous reader.
 */
export function toSharedTripResponse(trip: SharedTrip): SharedTrip {
  return sharedTripSchema.parse(trip);
}
