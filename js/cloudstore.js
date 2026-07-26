/* ============ FleetWorks — cloudstore.js ============
   Fleet cloud sync: Supabase email/password accounts + per-user storage
   of the ff_fleet data in the `fleets` table (RLS: owner-only).
   Include AFTER backend.js. Pages call fwCloud.push(db) after saves;
   on sign-in the cloud copy is pulled into localStorage and the page
   reloads so every module sees the synced data. */

(function () {
  "use strict";

  const SKEY = "fw_session";
  const ACTIVE_SKEY = "fw_session:active";
  const LEGACY_FLEET_KEY = "ff_fleet";
  const debounceMs = 1500;
  let timer = null;
  let pendingPush = null; // last db object queued for the debounced push, flushed on logout

  function cfg() { return window.FW_BACKEND || { url: "", anonKey: "" }; }
  function sessionKeyFor(s) {
    const user = s && s.user ? s.user : s;
    const uid = user && (user.email || user.id || s && s.email || s && s.id);
    return uid ? "fw_session:" + String(uid) : SKEY;
  }
  function readSession(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
  }
  function session() {
    const activeKey = localStorage.getItem(ACTIVE_SKEY);
    if (activeKey) {
      const s = readSession(activeKey);
      if (s) return s;
    }
    return null;
  }
  function setSession(s) {
    if (s) {
      const key = sessionKeyFor(s);
      localStorage.setItem(key, JSON.stringify(s));
      localStorage.setItem(ACTIVE_SKEY, key);
      localStorage.removeItem(SKEY);
    } else {
      const activeKey = localStorage.getItem(ACTIVE_SKEY);
      if (activeKey) localStorage.removeItem(activeKey);
      localStorage.removeItem(ACTIVE_SKEY);
      localStorage.removeItem(SKEY);
      localStorage.removeItem(LEGACY_FLEET_KEY);
    }
  }
  function sessionUserId(s) {
    const user = s && s.user ? s.user : s;
    return (user && (user.email || user.id || s && s.email || s && s.id)) || "";
  }
  function fleetDataKeyFor(s) {
    const uid = sessionUserId(s);
    return uid ? "ff_fleet:" + uid : LEGACY_FLEET_KEY;
  }
  function persistFleetData(s, data) {
    const key = fleetDataKeyFor(s);
    if (data === null) {
      localStorage.removeItem(key);
      localStorage.removeItem(LEGACY_FLEET_KEY);
      return;
    }
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    localStorage.setItem(key, payload);
    localStorage.setItem(LEGACY_FLEET_KEY, payload);
  }
  function readFleetData() {
    const active = session();
    const key = fleetDataKeyFor(active);
    const raw = localStorage.getItem(key);
    if (raw != null) {
      localStorage.setItem(LEGACY_FLEET_KEY, raw);
      return JSON.parse(raw);
    }
    const legacy = localStorage.getItem(LEGACY_FLEET_KEY);
    if (legacy != null) {
      try { return JSON.parse(legacy); } catch { return null; }
    }
    return null;
  }

  async function authFetch(path, opts) {
    const s = session();
    if (!s) throw new Error("Not signed in");
    const r = await fetch(cfg().url + path, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        "apikey": cfg().anonKey,
        "Authorization": "Bearer " + s.access_token,
        ...(opts && opts.headers || {})
      }
    });
    if (r.status === 401) {
      const ok = await refresh();
      if (ok) return authFetch(path, opts);
      setSession(null);
      throw new Error("Session expired — sign in again");
    }
    return r;
  }

  async function refresh() {
    const s = session();
    if (!s || !s.refresh_token) return false;
    const r = await fetch(cfg().url + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": cfg().anonKey },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    });
    if (!r.ok) return false;
    setSession(await r.json());
    return true;
  }

  /* When a DB write fails, surface the server's ACTUAL reason (missing
     table, missing column, RLS rejection...) instead of leaving the user
     with a generic "could not save" — one toast here turns any user report
     into an actionable message. Also kept on fwCloud.lastError() and logged
     to the console for remote debugging. */
  async function reportDbError(what, r) {
    let detail = "HTTP " + r.status;
    try {
      const j = await r.json();
      detail = j.message || j.error_description || j.error || detail;
      if (j.code === "PGRST205") detail = "table missing — run the latest db/*.sql in Supabase";
    } catch { }
    fwCloud._lastErr = "Could not " + what + ": " + detail;
    console.error("[FleetWorks]", fwCloud._lastErr);
    if (typeof window.toast === "function") window.toast(fwCloud._lastErr.slice(0, 160), "err");
  }

  const fwCloud = {
    lastError() { return fwCloud._lastErr || null; },
    user() { const s = session(); return s && s.user ? s.user.email : null; },

    /* Profile fields captured at signup (name, transport name, mobile,
       fleet size) — stored as Supabase user_metadata, no extra table. */
    profile() { const s = session(); return (s && s.user && s.user.user_metadata) || {}; },

    async signup(email, password, profile) {
      const r = await fetch(cfg().url + "/auth/v1/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": cfg().anonKey },
        body: JSON.stringify({ email, password, data: profile || {} })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.msg || j.error_description || "Sign up failed");
      if (j.access_token) { setSession(j); return "ready"; }
      return "confirm_email"; // confirmations enabled in Supabase
    },

    /* Re-send the sign-up confirmation email (Supabase resend endpoint). */
    async resend(email) {
      const r = await fetch(cfg().url + "/auth/v1/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": cfg().anonKey },
        body: JSON.stringify({ type: "signup", email })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.msg || j.error_description || "Could not resend — please wait a minute and try again.");
      }
      return true;
    },

    async login(email, password) {
      const r = await fetch(cfg().url + "/auth/v1/token?grant_type=password", {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": cfg().anonKey },
        body: JSON.stringify({ email, password })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error_description || j.msg || "Login failed");
      const sessionPayload = { ...j, user: { ...(j.user || {}), email } };
      setSession(sessionPayload);
      await fwCloud.pull();
      return true;
    },

    // Flushes any pending debounced push first (otherwise the last save
    // before logout can be silently lost — the reload tears down the JS
    // context before the 1.5s debounce timer ever fires), THEN wipes the
    // local blob (otherwise stale real data from this account survives in
    // localStorage after sign-out — visible e.g. via "View Demo", which
    // only loads fresh demo data when db.vehicles is empty, so it was
    // showing the previous owner's real data mislabeled as a demo).
    async logout() {
      clearTimeout(timer);
      if (pendingPush) { const d = pendingPush; pendingPush = null; try { await fwCloud.pushNow(d); } catch { } }
      const activeKey = localStorage.getItem(ACTIVE_SKEY);
      const activeSession = activeKey ? readSession(activeKey) : null;
      setSession(null);
      if (activeSession) {
        const fallbackKey = sessionKeyFor(activeSession);
        localStorage.removeItem(fallbackKey);
      }
      pendingPush = null;
      location.reload();
    },

    /* Signed-in user's uuid (null when signed out) — used to build
       owner-scoped rows like driver_entries. */
    uid() { const s = session(); return (s && s.user && s.user.id) || null; },

    /* Authenticated PATCH — path is table + PostgREST filter,
       e.g. "driver_entries?id=eq.<uuid>". */
    async authPatch(path, body) {
      const r = await authFetch("/rest/v1/" + path, {
        method: "PATCH",
        headers: { "Prefer": "return=minimal" },
        body: JSON.stringify(body)
      });
      if (!r.ok) await reportDbError("update " + path.split("?")[0], r);
      return r.ok;
    },

    /* Supabase Storage: upload a bill photo/PDF into the private "bills"
       bucket (path must start with the user's uid — enforced by RLS). */
    async uploadFile(bucket, path, file) {
      const r = await authFetch("/storage/v1/object/" + bucket + "/" + path, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file
      });
      return r.ok;
    },
    async signUrl(bucket, path, expiresIn) {
      const r = await authFetch("/storage/v1/object/sign/" + bucket + "/" + path, {
        method: "POST",
        body: JSON.stringify({ expiresIn: expiresIn || 3600 })
      });
      if (!r.ok) return null;
      const j = await r.json();
      return j.signedURL ? cfg().url + "/storage/v1" + j.signedURL : null;
    },

    /* Call a Supabase Edge Function as the signed-in user (their JWT is
       forwarded — the function verifies it server-side; e.g. team-invite). */
    async callFunction(name, body) {
      const r = await authFetch("/functions/v1/" + name, { method: "POST", body: JSON.stringify(body || {}) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Request failed (" + r.status + ")");
      return j;
    },

    /* Call a Postgres function (RLS/security-definer applies as normal). */
    async authRpc(fn, args) {
      const r = await authFetch("/rest/v1/rpc/" + fn, { method: "POST", body: JSON.stringify(args || {}) });
      if (!r.ok) return null;
      return r.json();
    },

    /* Authenticated delete — query is a PostgREST filter, e.g. "id=eq.<uuid>". */
    async authDelete(table, query) {
      const r = await authFetch("/rest/v1/" + table + "?" + query, { method: "DELETE" });
      if (!r.ok) await reportDbError("delete from " + table, r);
      return r.ok;
    },

    /* Authenticated insert that returns the created row(s) — used by the
       service workflow to capture server-generated uuids. */
    async authInsertRet(table, row) {
      const r = await authFetch("/rest/v1/" + table, {
        method: "POST",
        headers: { "Prefer": "return=representation" },
        body: JSON.stringify(row)
      });
      if (!r.ok) { await reportDbError("save " + table, r); return null; }
      const rows = await r.json();
      return rows && rows[0];
    },

    /* Generic authenticated read, scoped by RLS to whatever the signed-in
       account is allowed to see (e.g. a partner's own vendor_applications
       row). query is a raw PostgREST query string, e.g. "select=*&limit=1". */
    async authGet(table, query) {
      const r = await authFetch("/rest/v1/" + table + "?" + (query || "select=*"), {});
      if (!r.ok) return null;
      return r.json();
    },

    /* Authenticated insert -- runs as the signed-in user (not the anon
       role), so RLS "with check (auth.uid() = owner_id)" style policies
       can enforce a row can only ever be claimed by its real owner. */
    async authInsert(table, row) {
      const r = await authFetch("/rest/v1/" + table, {
        method: "POST",
        headers: { "Prefer": "return=minimal" },
        body: JSON.stringify(row)
      });
      if (!r.ok) await reportDbError("save " + table, r);
      return r.ok;
    },

    /* Pull cloud fleet -> localStorage (cloud wins whenever a row exists at
       all — checking rows.length here, NOT rows[0].data.vehicles.length:
       a real account with an existing-but-currently-empty cloud row (no
       vehicles added yet, or just wiped by clearDemoForOwner) was being
       misread as "no cloud data", which pushed whatever stale/demo blob
       was sitting in local storage up over the correct empty cloud state. */
    async pull() {
      const s = session();
      const r = await authFetch("/rest/v1/fleets?select=data&limit=1", {});
      if (!r.ok) return false;
      const rows = await r.json();
      if (rows.length && rows[0].data) {
        persistFleetData(s, rows[0].data);
        return true;
      }
      // Genuinely no cloud row yet (brand new account): push local up if
      // present — but NEVER a demo blob. A demo fleet loaded while signed
      // out must not leak into a real account's cloud data (this was
      // exactly how demo vehicles/drivers ended up in real accounts).
      const local = readFleetData();
      if (local) {
        try {
          const d = typeof local === "string" ? JSON.parse(local) : local;
          const isDemo = d.demo === true || (d.vehicles && d.vehicles[0] && d.vehicles[0].id === "v1");
          if (isDemo) persistFleetData(s, null);
          else await fwCloud.pushNow(d);
        } catch { persistFleetData(s, null); }
      }
      return false;
    },

    /* Debounced push — call after every local save. */
    push(dbObj) {
      if (!session()) return;
      pendingPush = dbObj;
      clearTimeout(timer);
      timer = setTimeout(() => { pendingPush = null; fwCloud.pushNow(dbObj).catch(() => {}); }, debounceMs);
    },

    async pushNow(dbObj) {
      const s = session();
      if (!s) return false;
      const r = await authFetch("/rest/v1/fleets", {
        method: "POST",
        headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          owner_id: s.user.id,
          data: dbObj,
          updated_at: new Date().toISOString()
        })
      });
      if (r.ok) persistFleetData(s, dbObj);
      return r.ok;
    }
  };

  window.fwCloud = fwCloud;

  /* ---------- Sync UI (floating pill, bottom-left) ---------- */
  const css = `
    #fwSyncPill { position: fixed; bottom: 22px; left: 22px; z-index: 240;
      display: flex; align-items: center; gap: 8px;
      background: #fff; border: 1.5px solid #e2e8f0; border-radius: 100px;
      padding: 9px 16px; font-family: inherit; font-size: 0.82rem; font-weight: 600;
      color: #0f1e33; cursor: pointer; box-shadow: 0 10px 30px rgba(15,30,51,0.12); }
    #fwSyncPill .dot { width: 9px; height: 9px; border-radius: 50%; }
    #fwAuthModal { position: fixed; inset: 0; background: rgba(11,22,38,0.65);
      display: flex; align-items: center; justify-content: center; z-index: 300; padding: 20px; }
    #fwAuthModal .box { background: #fff; border-radius: 16px; padding: 28px; width: 100%;
      max-width: 400px; font-family: inherit; }
    #fwAuthModal h3 { color: #0f1e33; margin-bottom: 4px; }
    #fwAuthModal p { color: #64748b; font-size: 0.85rem; margin-bottom: 16px; }
    #fwAuthModal input { width: 100%; padding: 11px 14px; border: 1.5px solid #e2e8f0;
      border-radius: 10px; font-family: inherit; font-size: 0.92rem; margin-bottom: 12px; }
    #fwAuthModal .btnrow { display: flex; gap: 10px; }
    #fwAuthModal button { flex: 1; padding: 12px; border-radius: 10px; border: none;
      font-family: inherit; font-weight: 700; cursor: pointer; }
    #fwAuthModal .primary { background: #f5a623; color: #0f1e33; }
    #fwAuthModal .ghost { background: #f4f7fb; color: #0f1e33; }
    #fwAuthModal .err { color: #dc2626; font-size: 0.8rem; margin-top: 10px; }`;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const pill = document.createElement("button");
  pill.id = "fwSyncPill";
  document.body.appendChild(pill);

  function renderPill() {
    const u = fwCloud.user();
    const escLocal = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    pill.innerHTML = u
      ? `<span class="dot" style="background:#0ca30c"></span> Synced · ${escLocal(u.split("@")[0])}`
      : `<span class="dot" style="background:#94a3b8"></span> Sign in to sync`;
    pill.title = u ? "Fleet data syncing to your FleetWorks cloud account. Click to sign out." : "Create a free account to back up and sync your fleet across devices";
  }
  renderPill();

  pill.addEventListener("click", () => {
    if (fwCloud.user()) {
      if (confirm("Sign out of FleetWorks cloud sync? Local data stays on this device.")) fwCloud.logout();
      return;
    }
    openModal();
  });

  function openModal() {
    const wrap = document.createElement("div");
    wrap.id = "fwAuthModal";
    wrap.innerHTML = `
      <div class="box">
        <h3>FleetWorks Cloud Account</h3>
        <p>Back up your fleet and access it from any device. Free.</p>
        <input type="email" id="fwEmail" placeholder="Email" autocomplete="username" />
        <input type="password" id="fwPass" placeholder="Password (min 6 characters)" autocomplete="current-password" />
        <div class="btnrow">
          <button class="primary" id="fwLoginBtn">Sign In</button>
          <button class="ghost" id="fwSignupBtn">Create Account</button>
        </div>
        <div class="err" id="fwAuthErr" hidden></div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click", e => { if (e.target === wrap) wrap.remove(); });
    const err = m => { const el = wrap.querySelector("#fwAuthErr"); el.textContent = m; el.hidden = false; };
    const vals = () => [wrap.querySelector("#fwEmail").value.trim(), wrap.querySelector("#fwPass").value];

    wrap.querySelector("#fwLoginBtn").addEventListener("click", async () => {
      const [e, p] = vals();
      if (!e || !p) return err("Enter email and password.");
      try { await fwCloud.login(e, p); location.reload(); }
      catch (ex) { err(ex.message); }
    });
    wrap.querySelector("#fwSignupBtn").addEventListener("click", async () => {
      const [e, p] = vals();
      if (!e || p.length < 6) return err("Enter email and a password of at least 6 characters.");
      try {
        const res = await fwCloud.signup(e, p);
        if (res === "ready") { await fwCloud.pull(); location.reload(); }
        else err("Account created — check your email to confirm, then sign in.");
      } catch (ex) { err(ex.message); }
    });
  }
})();
