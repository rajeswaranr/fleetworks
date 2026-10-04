-- Passenger-transport anomaly detection (school/passenger buses and trains).
-- Adds the passenger-safety anomaly types to device_events so the bus-anomaly engine (rules +
-- Gemma) can log them alongside the existing DMS / telematics events, and they surface in
-- Incident Triage and the new Passenger Safety console.
alter table device_events drop constraint if exists device_events_event_type_check;
alter table device_events add constraint device_events_event_type_check check (event_type in (
  'lane_departure','forward_collision','headway_warning','pedestrian_warning',
  'fatigue','distraction','phone_use','no_seatbelt','smoking',
  'harsh_brake','harsh_accel','harsh_corner','overspeed',
  'fuel_drop','tamper','power_cut','sos','panic',
  'manual_record',
  -- passenger-transport anomalies
  'route_deviation','unscheduled_stop','schedule_deviation','prolonged_idle',
  'speed_zone_violation','door_open_moving','overcrowding','child_left_behind',
  'unusual_pattern'));
