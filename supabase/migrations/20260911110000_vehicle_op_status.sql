-- Vehicle operational status — set by supervisors via team portal
-- Separate table so supervisors (who cannot UPDATE vehicles) can still
-- record moving/halted/maintenance and note the current driver.

CREATE TABLE IF NOT EXISTS vehicle_op_statuses (
  vehicle_id          uuid PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
  org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  op_status           TEXT NOT NULL DEFAULT 'moving'
                        CHECK (op_status IN ('moving', 'halted', 'maintenance')),
  current_driver_name TEXT,
  updated_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vos_org ON vehicle_op_statuses(org_id);
ALTER TABLE vehicle_op_statuses ENABLE ROW LEVEL SECURITY;

-- supervisors/drivers with update access can read and write their vehicles' status
CREATE POLICY vos_select ON vehicle_op_statuses FOR SELECT TO authenticated
  USING (can_view_vehicle_id(org_id, vehicle_id));

CREATE POLICY vos_upsert ON vehicle_op_statuses FOR INSERT TO authenticated
  WITH CHECK (can_update_vehicle_id(org_id, vehicle_id));

CREATE POLICY vos_update ON vehicle_op_statuses FOR UPDATE TO authenticated
  USING (can_update_vehicle_id(org_id, vehicle_id))
  WITH CHECK (can_update_vehicle_id(org_id, vehicle_id));

CREATE POLICY vos_delete ON vehicle_op_statuses FOR DELETE TO authenticated
  USING (is_org_admin(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON vehicle_op_statuses TO authenticated;

COMMENT ON TABLE vehicle_op_statuses IS
  'Real-time vehicle status (moving/halted/maintenance) set by supervisors; '
  'current_driver_name is who is at the wheel right now, distinct from the permanent driver assignment.';
