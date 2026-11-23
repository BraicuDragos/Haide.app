-- My rides, "Canceled" tab (improvement 5): who cancelled a ride. Forward-only, additive, nullable.
-- Bookings already store cancelled_by (passenger/driver/system). Rides did not. Old rows stay NULL and
-- are read as 'driver' by the API (before this column the only cancel paths were the driver endpoint
-- and the suspended-driver sweep). No cancel reason is stored anywhere.
alter table app.rides
  add column cancelled_by text;

alter table app.rides
  add constraint rides_cancelled_by_check check (cancelled_by in ('driver', 'system'));
