-- Driver-initiated 2-minute recordings with a location.
--
-- The driver's Safe Drive screen gets a "Record 2-minute clip" button: it captures the
-- phone's latitude/longitude and records the cabin for two minutes, then uploads it. Unlike
-- the automatic event clips, a manual clip has no alert behind it, so it rides on a benign
-- 'manual_record' device_event (severity info) that carries the location — that way it shows
-- on the owner/supervisor dashboard on the map and in Incident Triage, next to the video.

-- 1) keep the clip's own location on the media row too
alter table device_media add column if not exists latitude  numeric;
alter table device_media add column if not exists longitude numeric;

-- 2) allow the 'manual_record' event type (existing rows already satisfy the 18 original types)
alter table device_events drop constraint if exists device_events_event_type_check;
alter table device_events add constraint device_events_event_type_check check (event_type in (
  'lane_departure','forward_collision','headway_warning','pedestrian_warning',
  'fatigue','distraction','phone_use','no_seatbelt','smoking',
  'harsh_brake','harsh_accel','harsh_corner','overspeed',
  'fuel_drop','tamper','power_cut','sos','panic',
  'manual_record'));
