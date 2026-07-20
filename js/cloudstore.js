/* ============ FleetWorks — cloudstore.js ============
   Fleet cloud sync: Supabase email/password accounts + per-user storage
   of the ff_fleet data in the `fleets` table (RLS: owner-only).
   Include AFTER backend.js. Pages call fwCloud.push(db) after saves;
   on sign-in the cloud copy is pulled into localStorage and the page
   reloads so every module sees the synced data. */

(function () {
  "use strict";

  const SKEY = "fw_session";
  const debounceMs = 1500;
  let timer = null;

  function cfg() { return window.FW_BACKEND || { url: "", anonKey: "" }; }
  function session() {
    try { return JSON.parse(localStorage.getItem(SKEY) || "null"); } catch { return null; }
  }
  function setSession(s) {
    if (s) localStorage.setItem(SKEY, JSON.stringify(s));
    else localStorage.removeItem(SKEY);
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

  const fwCloud = {
    user() { const s = session(); return s && s.user ? s.user.email : null; },

    async signup(email, password) {
      const r = await fetch(cfg().url + "/auth/v1/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": cfg().anonKey },
        body: JSON.stringify({ email, password })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.msg || j.error_description || "Sign up failed");
      if (j.access_token) { setSession(j); return "ready"; }
      return "confirm_email"; // confirmations enabled in Supabase
    },

    async login(email, password) {
      const r = await fetch(cfg().url + "/auth/v1/token?grant_type=password", {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": cfg().anonKey },
        body: JSON.stringify({ email, password })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error_description || j.msg || "Login failed");
      setSession(j);
      await fwCloud.pull();
      return true;
    },

    logout() { setSession(null); location.reload(); },

    /* Pull cloud fleet -> localStorage (cloud wins if it has data). */
    async pull() {
      const r = await authFetch("/rest/v1/fleets?select=data&limit=1", {});
      if (!r.ok) return false;
      const rows = await r.json();
      if (rows.length && rows[0].data && (rows[0].data.vehicles || []).length) {
        localStorage.setItem("ff_fleet", JSON.stringify(rows[0].data));
        return true;
      }
      // no cloud data yet: push local up if present
      const local = localStorage.getItem("ff_fleet");
      if (local) await fwCloud.pushNow(JSON.parse(local));
      return false;
    },

    /* Debounced push — call after every local save. */
    push(dbObj) {
      if (!session()) return;
      clearTimeout(timer);
      timer = setTimeout(() => fwCloud.pushNow(dbObj).catch(() => {}), debounceMs);
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
    pill.innerHTML = u
      ? `<span class="dot" style="background:#0ca30c"></span> Synced · ${u.split("@")[0]}`
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
