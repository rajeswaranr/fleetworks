/* ============ FleetWorks — platform/module-registry.js ============
   Lightweight platform foundation for future plug-in / plug-out modules.
   This file is deliberately additive: existing pages keep their current
   script order, global functions, and render flow. Modules can register
   metadata, lifecycle hooks, navigation hints, permissions, capabilities,
   and service adapters without taking over the UI yet. */

(function () {
  "use strict";

  const MODULES = new Map();
  const CAPABILITIES = new Map();
  const LISTENERS = {};
  const DISABLED_KEY = "fw_modules:disabled";

  function log(level, msg, data) {
    const c = window.console;
    if (!c || !c[level]) return;
    if (data !== undefined) c[level]("[FleetWorks Platform] " + msg, data);
    else c[level]("[FleetWorks Platform] " + msg);
  }

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || ""); }
    catch { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { /* localStorage can be unavailable in very restricted contexts */ }
  }

  function disabledIds() {
    const ids = readJson(DISABLED_KEY, []);
    return Array.isArray(ids) ? ids : [];
  }

  function moduleFlag(id) {
    const flags = window.FW_MODULE_FLAGS || {};
    return Object.prototype.hasOwnProperty.call(flags, id) ? flags[id] : undefined;
  }

  function currentDb() {
    try { if (typeof db !== "undefined") return db; } catch { /* lexical global not present */ }
    return window.db || null;
  }

  function normalizeModule(def) {
    if (!def || !def.id) throw new Error("Module id is required.");
    return {
      id: String(def.id),
      name: def.name || def.id,
      version: def.version || "0.1.0",
      description: def.description || "",
      layer: def.layer || "feature",
      order: Number.isFinite(def.order) ? def.order : 100,
      status: def.status || "active",
      enabledByDefault: def.enabledByDefault !== false,
      dependencies: def.dependencies || [],
      permissions: def.permissions || [],
      tables: def.tables || [],
      endpoints: def.endpoints || [],
      edgeFunctions: def.edgeFunctions || [],
      navigation: def.navigation || [],
      capabilities: def.capabilities || [],
      adapters: def.adapters || {},
      init: typeof def.init === "function" ? def.init : null,
      destroy: typeof def.destroy === "function" ? def.destroy : null,
      runtime: { booted: false, error: null },
      meta: def.meta || {},
    };
  }

  function context(extra) {
    return {
      db: currentDb(),
      api: window.FWApi || null,
      hex: window.FWHex || null,
      cloud: window.fwCloud || null,
      platform: window.FWPlatform,
      user: window.fwCloud && fwCloud.user ? fwCloud.user() : null,
      uid: window.fwCloud && fwCloud.uid ? fwCloud.uid() : null,
      ...extra,
    };
  }

  function emit(name, payload) {
    (LISTENERS[name] || []).slice().forEach(fn => {
      try { fn(payload); } catch (err) { log("error", "Event listener failed for " + name, err); }
    });
  }

  const platform = {
    version: "0.1.0",

    registerModule(def) {
      const mod = normalizeModule(def);
      if (MODULES.has(mod.id)) {
        log("warn", "Replacing existing module registration: " + mod.id);
      }
      MODULES.set(mod.id, mod);
      emit("module:registered", mod);
      return mod;
    },

    getModule(id) {
      return MODULES.get(id) || null;
    },

    listModules(options) {
      const list = Array.from(MODULES.values()).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      if (options && options.enabledOnly) return list.filter(m => platform.isModuleEnabled(m.id));
      return list;
    },

    isModuleEnabled(id) {
      const mod = MODULES.get(id);
      if (!mod) return false;
      const flag = moduleFlag(id);
      if (flag === true || flag === false) return flag;
      if (disabledIds().includes(id)) return false;
      return mod.enabledByDefault;
    },

    enableModule(id) {
      const next = disabledIds().filter(x => x !== id);
      writeJson(DISABLED_KEY, next);
      emit("module:enabled", platform.getModule(id));
    },

    disableModule(id) {
      const ids = disabledIds();
      if (!ids.includes(id)) ids.push(id);
      writeJson(DISABLED_KEY, ids);
      emit("module:disabled", platform.getModule(id));
    },

    registerCapability(name, provider) {
      if (!name) throw new Error("Capability name is required.");
      CAPABILITIES.set(String(name), provider);
      emit("capability:registered", { name, provider });
      return provider;
    },

    capability(name) {
      return CAPABILITIES.get(name) || null;
    },

    listCapabilities() {
      return Array.from(CAPABILITIES.keys()).sort();
    },

    navigationEntries(options) {
      return platform.listModules({ enabledOnly: !(options && options.includeDisabled) })
        .flatMap(mod => (mod.navigation || []).map(item => ({ moduleId: mod.id, ...item })));
    },

    on(name, fn) {
      if (!LISTENERS[name]) LISTENERS[name] = [];
      LISTENERS[name].push(fn);
      return () => {
        LISTENERS[name] = (LISTENERS[name] || []).filter(x => x !== fn);
      };
    },

    emit,

    async boot(extraContext) {
      for (const mod of platform.listModules({ enabledOnly: true })) {
        if (mod.runtime.booted || !mod.init) continue;
        try {
          await mod.init(context(extraContext));
          mod.runtime.booted = true;
          mod.runtime.error = null;
          emit("module:booted", mod);
        } catch (err) {
          mod.runtime.error = err && err.message ? err.message : String(err);
          log("error", "Module boot failed: " + mod.id, err);
          emit("module:error", { module: mod, error: err });
        }
      }
      emit("platform:booted", { modules: platform.listModules({ enabledOnly: true }) });
    },
  };

  window.FWPlatform = window.FWPlatform || platform;
})();
