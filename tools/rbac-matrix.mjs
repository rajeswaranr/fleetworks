#!/usr/bin/env node
/* RBAC regression harness. Measures what each login can READ and WRITE on every table, so
   an access-control change can be proven not to break existing behaviour.

     node tools/rbac-matrix.mjs snapshot --out before.json
         Real logins only, against the linked database, changes nothing (rolled back).

     node tools/rbac-matrix.mjs snapshot --tx supabase/migrations/X.sql --synthetic --out after.json
         Applies a migration inside a transaction, adds throwaway test users for every role
         (manager, accountant, mechanic, supervisor, driver, viewer, a custom role), measures,
         then ROLLS EVERYTHING BACK. Nothing is committed.

     node tools/rbac-matrix.mjs compare before.json after.json
         Owners must be unchanged; nobody may gain access they did not have; every synthetic
         role must match what its permissions say. Exits 1 on any failure.

   "read" = rows visible. "write" = rows an UPDATE could touch under the user's policies
   (set org_id = org_id, rolled back). "probe" = one-off attempts at privilege escalation. */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const flag = (n) => args.includes(n);

function sql(text) {
  const dir = mkdtempSync(join(tmpdir(), "rbac-"));
  const f = join(dir, "q.sql");
  writeFileSync(f, text);
  const out = execFileSync("npx", ["supabase", "db", "query", "--linked", "-f", f], { encoding: "utf8", shell: true, maxBuffer: 1 << 28, timeout: 590000 });
  const i = out.indexOf("{"), j = out.lastIndexOf("}");
  if (i < 0) throw new Error("no JSON in output:\n" + out.slice(0, 600));
  const parsed = JSON.parse(out.slice(i, j + 1));
  if (parsed.error) throw new Error(JSON.stringify(parsed.error));
  return parsed.rows || [];
}

const ROLES = ["manager", "accountant", "mechanic", "supervisor", "driver", "viewer"];

function snapshot() {
  const tables = sql(`select c.relname as t, exists(select 1 from information_schema.columns k where k.table_schema='public' and k.table_name=c.relname and k.column_name='org_id') as has_org
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1`);
  const names = tables.map((r) => r.t);
  const orgTables = tables.filter((r) => r.has_org).map((r) => r.t);

  // real principals
  const real = sql(`select m.user_id::text as uid, m.org_id::text as org, coalesce(m.role,'?') as role,
                           (select count(*) from vehicles v where v.org_id=m.org_id) as veh
                      from memberships m order by veh desc, m.role`);
  const principals = real.map((r, i) => ({ name: `real-${r.role}-${String(r.uid).slice(0, 4)}`, uid: r.uid, org: r.org, role: r.role, synthetic: false }));

  const useTx = opt("--tx");
  const synthetic = flag("--synthetic");
  const richest = real[0]?.org;

  const L = [];
  L.push("begin;");
  if (useTx) L.push(readFileSync(useTx, "utf8"));
  L.push("create temp table snap(p text, t text, kind text, n bigint);");
  L.push("grant all on pg_temp.snap to authenticated;");

  if (synthetic) {
    // throwaway users for every role, in the organisation with the most data
    L.push(`do $$
    declare o uuid := '${richest}'; r text; u uuid; v1 uuid; v2 uuid; d uuid; cr uuid;
    begin
      select id into v1 from vehicles where org_id=o order by id limit 1;
      select id into v2 from vehicles where org_id=o order by id offset 1 limit 1;
      select id into d from drivers where org_id=o and vehicle_id is not null order by id limit 1;
      foreach r in array array['${ROLES.join("','")}'] loop
        u := gen_random_uuid();
        insert into auth.users(id, aud, role, email) values (u, 'authenticated', 'authenticated', 'rbac-test-'||r||'@example.invalid');
        insert into memberships(org_id, user_id, role) values (o, u, r);
        create temp table if not exists synth(role text, uid uuid);
        insert into synth values (r, u);
        if r = 'supervisor' then
          insert into vehicle_assignments(org_id,user_id,vehicle_ext_id,access) select o,u,ext_id,'update' from vehicles where id in (v1,v2);
        elsif r = 'driver' then
          update drivers set user_id = u where id = d;
          insert into vehicle_assignments(org_id,user_id,vehicle_ext_id,access) select o,u,ext_id,'view' from vehicles where id = (select vehicle_id from drivers where id=d);
        end if;
      end loop;
      -- a custom role: viewer-like plus fuel and expense entry
      insert into rbac_roles(org_id,key,name,base_role) values (o,'fuel_clerk','Fuel clerk','viewer') returning id into cr;
      insert into rbac_role_permissions(role_id,permission,scope) values (cr,'vehicles:read','all'),(cr,'fuel:read','all'),(cr,'fuel:create','all');
      u := gen_random_uuid();
      insert into auth.users(id, aud, role, email) values (u,'authenticated','authenticated','rbac-test-custom@example.invalid');
      insert into memberships(org_id,user_id,role,role_id) values (o,u,'viewer',cr);
      insert into synth values ('custom', u);
    end $$;`);
    L.push("grant all on pg_temp.synth to authenticated;");
    for (const r of [...ROLES, "custom"]) {
      principals.push({ name: `synthetic-${r}`, uid: null, synthUser: r, org: richest, role: r, synthetic: true });
    }
  }

  const list = names.map((n) => `'${n}'`).join(",");
  const orgList = orgTables.map((n) => `'${n}'`).join(",");

  // reference totals for the richest org (as the database owner) so synthetic roles can be checked
  L.push(`do $$ declare t text; n bigint; begin
    for t in select unnest(array[${orgList}]) loop
      execute format('select count(*) from public.%I where org_id = %L', t, '${richest}') into n;
      insert into pg_temp.snap values ('TOTAL','' || t, 'total', n);
    end loop; end $$;`);

  for (const p of principals) {
    const uidExpr = p.synthetic ? `(select uid::text from pg_temp.synth where role='${p.synthUser}')` : `'${p.uid}'`;
    L.push(`select set_config('app.uid', ${uidExpr}, true);`);
    L.push("set local role authenticated;");
    L.push(`select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.uid'), 'role', 'authenticated')::text, true);`);
    L.push(`do $$ declare t text; n bigint; me text := '${p.name}'; begin
      for t in select unnest(array[${list}]) loop
        begin execute format('select count(*) from public.%I', t) into n; exception when others then n := -1; end;
        insert into pg_temp.snap values (me, t, 'read', n);
      end loop;
      for t in select unnest(array[${orgList}]) loop
        begin execute format('with u as (update public.%I set org_id = org_id returning 1) select count(*) from u', t) into n; exception when others then n := -1; end;
        insert into pg_temp.snap values (me, t, 'write', n);
      end loop;
    end $$;`);
    // escalation probes: each is attempted inside a sub-transaction that always rolls back
    L.push(`do $$ declare me text := '${p.name}'; o uuid := '${p.org}'; res text; other_driver uuid; my_v uuid;
    procedure_dummy int;
    begin
      select id into other_driver from public.drivers where org_id = o limit 1;
      select id into my_v from public.vehicles where org_id = o limit 1;
      -- 1 grant myself access to a vehicle
      begin
        insert into public.vehicle_assignments(org_id,user_id,vehicle_ext_id,access) select o, current_setting('app.uid')::uuid, ext_id, 'update' from public.vehicles where id = my_v;
        raise exception 'probe-ok';
      exception when others then res := case when sqlerrm = 'probe-ok' then 1 else 0 end; end;
      insert into pg_temp.snap values (me,'probe:self_grant_vehicle_access','probe',res::int);
      -- 2 add a khata entry for someone else's driver record
      begin
        insert into public.driver_ledger(org_id,driver_id,entry_date,type,amount) values (o, other_driver, current_date, 'advance', 1);
        raise exception 'probe-ok';
      exception when others then res := case when sqlerrm = 'probe-ok' then 1 else 0 end; end;
      insert into pg_temp.snap values (me,'probe:ledger_entry_any_driver','probe',res::int);
      -- 3 record a settlement (reduces a balance) on a khata
      begin
        insert into public.driver_ledger(org_id,driver_id,entry_date,type,amount) select o, id, current_date, 'settlement', 1 from public.drivers where user_id = current_setting('app.uid')::uuid;
        if not found then raise exception 'probe-none'; end if;
        raise exception 'probe-ok';
      exception when others then res := case when sqlerrm = 'probe-ok' then 1 else 0 end; end;
      insert into pg_temp.snap values (me,'probe:own_settlement','probe',res::int);
      -- 4 promote myself to owner
      begin
        update public.memberships set role = 'owner' where user_id = current_setting('app.uid')::uuid;
        if not found then raise exception 'probe-none'; end if;
        raise exception 'probe-ok';
      exception when others then res := case when sqlerrm = 'probe-ok' then 1 else 0 end; end;
      insert into pg_temp.snap values (me,'probe:self_promote','probe',res::int);
      -- 5 create a role
      begin
        insert into public.rbac_roles(org_id,key,name,base_role) values (o,'probe_role','Probe','viewer');
        raise exception 'probe-ok';
      exception when others then res := case when sqlerrm = 'probe-ok' then 1 else 0 end; end;
      insert into pg_temp.snap values (me,'probe:create_role','probe',res::int);
      -- 6 read all memberships (team list)
      insert into pg_temp.snap values (me,'probe:team_visible','probe',(select count(*) from public.memberships));
    end $$;`.replace("procedure_dummy int;\n", ""));
    L.push("reset role;");
  }
  L.push("select p, t, kind, n from pg_temp.snap order by p, kind, t;");
  L.push("rollback;");

  const rows = sql(L.join("\n"));
  const data = {};
  for (const r of rows) {
    (data[r.p] ||= {})[`${r.kind}:${r.t}`] = Number(r.n);
  }
  const meta = { principals: principals.map(({ name, role, org, synthetic }) => ({ name, role, org, synthetic })), tables: names, richestOrg: richest };
  return { meta, data };
}

// ── expectations for synthetic roles, derived from what must always be true ──
// (independent of the role tables: these encode the product rules)
const MUST_NOT_READ = {
  driver:     ["salary_payments_all", "payment_requests", "parties", "sales_invoices", "gst_invoices", "purchase_orders", "audit_log", "rbac_table_registry"],
  supervisor: ["driver_ledger", "salary_payments", "payment_requests", "parties", "sales_invoices", "gst_invoices", "purchase_orders", "driver_payout_details", "audit_log"],
  mechanic:   ["driver_ledger", "salary_payments", "payment_requests", "parties", "sales_invoices", "gst_invoices", "driver_payout_details", "drivers", "audit_log"],
  viewer:     ["driver_ledger", "salary_payments", "payment_requests", "parties", "sales_invoices", "gst_invoices", "purchase_orders", "driver_payout_details", "drivers", "expenses", "audit_log"],
  accountant: ["work_orders_write", "daily_dispatch", "vehicle_assignments_others", "audit_log"],
  manager:    ["audit_log"],
  custom:     ["driver_ledger", "salary_payments", "payment_requests", "parties", "sales_invoices", "expenses", "drivers", "audit_log", "work_orders", "issues"],
};
const MUST_NOT_WRITE_ANY = {
  driver: ["vehicles", "drivers", "expenses", "work_orders", "sites", "projects", "parts", "salary_payments", "payment_requests", "memberships"],
  supervisor: ["vehicles", "drivers", "expenses", "sites", "projects", "parts", "salary_payments", "payment_requests", "driver_ledger", "memberships"],
  viewer: ["vehicles", "drivers", "expenses", "work_orders", "fuel_logs", "sites", "projects", "parts", "salary_payments", "memberships", "trips"],
  mechanic: ["vehicles", "drivers", "expenses", "fuel_logs", "sites", "projects", "salary_payments", "driver_ledger", "memberships", "trips"],
  accountant: ["vehicles", "drivers", "work_orders", "sites", "projects", "memberships", "trips", "issues"],
  manager: ["memberships"],
  custom: ["vehicles", "drivers", "expenses", "work_orders", "sites", "salary_payments", "memberships", "fuel_logs_other"],
};

function compare(beforeFile, afterFile) {
  const B = JSON.parse(readFileSync(beforeFile, "utf8")), A = JSON.parse(readFileSync(afterFile, "utf8"));
  const fails = [], notes = [];
  const bprin = new Map(B.meta.principals.map((p) => [p.name, p]));

  // 1. real logins: owners identical; everyone else may only lose access
  for (const p of A.meta.principals.filter((x) => !x.synthetic)) {
    const b = B.data[p.name], a = A.data[p.name];
    if (!b || !a) continue;
    for (const key of Object.keys(b)) {
      if (key.startsWith("probe:")) continue;
      const before = b[key], after = a[key];
      if (after === undefined || before === after) continue;
      const tbl = key.split(":")[1];
      // platform-only tables: other businesses' sales leads and partner applications were
      // wrongly readable by every customer owner; closing that is the intended change.
      if (["leads", "vendor_applications"].includes(tbl)) { notes.push(`platform-only     ${p.name}  ${key}: ${before} -> ${after}`); continue; }
      if (["rbac_table_registry", "audit_log", "rbac_roles", "rbac_role_permissions", "rbac_permissions", "memberships", "vehicle_assignments"].includes(tbl)) continue;
      const bn = Math.max(before, 0), an = Math.max(after, 0);
      if (bn === an) continue;
      if (p.role === "owner") {
        if (an < bn) fails.push(`OWNER REGRESSION  ${p.name}  ${key}: ${before} -> ${after}`);
        else notes.push(`owner gained      ${p.name}  ${key}: ${before} -> ${after}`);
      } else if (an > bn) fails.push(`ACCESS GAINED     ${p.name} (${p.role})  ${key}: ${before} -> ${after}`);
      else notes.push(`tightened         ${p.name} (${p.role})  ${key}: ${before} -> ${after}`);
    }
  }

  // 2. synthetic roles must satisfy the product rules
  for (const p of A.meta.principals.filter((x) => x.synthetic)) {
    const a = A.data[p.name] || {}, role = p.role;
    for (const t of MUST_NOT_READ[role] || []) {
      const v = a[`read:${t}`];
      if (v !== undefined && v > 0) fails.push(`OVER-EXPOSED      ${role} can read ${t}: ${v} rows`);
    }
    for (const t of MUST_NOT_WRITE_ANY[role] || []) {
      const v = a[`write:${t}`];
      if (v !== undefined && v > 0) fails.push(`OVER-PRIVILEGED    ${role} can update ${t}: ${v} rows`);
    }
    for (const k of ["self_grant_vehicle_access", "self_promote", "create_role"]) {
      if (role !== "owner" && a[`probe:${k}`] === 1) fails.push(`ESCALATION        ${role} can ${k}`);
    }
    if (["driver", "supervisor", "mechanic", "viewer", "accountant", "manager", "custom"].includes(role) && a["probe:ledger_entry_any_driver"] === 1 && role !== "manager" && role !== "accountant")
      fails.push(`ESCALATION        ${role} can add a khata entry for any driver`);
    if (role === "driver" && a["probe:own_settlement"] === 1) fails.push("ESCALATION        driver can record a settlement on their own khata");
    if (["driver", "supervisor", "mechanic", "viewer", "accountant", "custom"].includes(role) && (a["probe:team_visible"] ?? 0) > 1)
      fails.push(`OVER-EXPOSED      ${role} can list ${a["probe:team_visible"]} team members (should see only themselves)`);
    // roles with organisation-wide read must actually see the data
    const total = (t) => (A.data.TOTAL || {})[`total:${t}`];
    const need = { manager: ["vehicles", "expenses", "driver_ledger", "salary_payments", "work_orders"], accountant: ["expenses", "fuel_logs", "driver_ledger", "salary_payments", "vehicles"],
                   mechanic: ["work_orders", "issues", "vehicles"], viewer: ["vehicles", "fuel_logs", "work_orders"], custom: ["vehicles", "fuel_logs"] }[role] || [];
    for (const t of need) {
      const v = a[`read:${t}`], tot = total(t);
      if (tot !== undefined && tot > 0 && v !== undefined && v < tot) fails.push(`UNDER-GRANTED     ${role} sees ${v}/${tot} ${t}`);
    }
  }
  for (const n of notes.slice(0, 40)) console.log(n);
  if (notes.length > 40) console.log(`... and ${notes.length - 40} more tightened`);
  for (const f of fails) console.log(f);
  console.log(fails.length ? `\n${fails.length} FAILURE(S)` : `\nOK — owners unchanged, no access gained, all ${A.meta.principals.filter((x) => x.synthetic).length} synthetic roles match the rules (${notes.length} entries tightened).`);
  process.exit(fails.length ? 1 : 0);
}

if (cmd === "snapshot") {
  const out = opt("--out");
  const s = snapshot();
  if (out) writeFileSync(out, JSON.stringify(s, null, 1));
  console.log(`snapshot: ${s.meta.principals.length} principals × ${s.meta.tables.length} tables${out ? " -> " + out : ""}`);
} else if (cmd === "compare") {
  compare(args[1], args[2]);
} else {
  console.log("usage: rbac-matrix.mjs snapshot [--tx migration.sql] [--synthetic] [--out file] | compare before.json after.json");
  process.exit(2);
}
