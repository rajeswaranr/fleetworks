/* ============ FleetWorks — platform/hexagonal.js ============
   Small browser-native architecture runtime for the gradual move toward:
   Modular Monolith + Hexagonal Architecture + MVVM-style frontend modules.

   It does not replace existing FleetWorks globals. It gives new code a
   clean place to register ports, adapters, use cases, and view models while
   legacy files continue to run unchanged. */

(function () {
  "use strict";

  const PORTS = new Map();
  const ADAPTERS = new Map();
  const USE_CASES = new Map();
  const VIEW_MODELS = new Map();

  function assertName(name, kind) {
    if (!name || typeof name !== "string") throw new Error(kind + " name is required.");
  }

  function cloneMethods(methods) {
    return Array.isArray(methods) ? methods.slice() : [];
  }

  function missingMethods(adapter, methods) {
    return methods.filter(name => typeof adapter[name] !== "function");
  }

  const FWHex = {
    definePort(name, methods) {
      assertName(name, "Port");
      const port = { name, methods: cloneMethods(methods) };
      PORTS.set(name, port);
      return port;
    },

    port(name) {
      return PORTS.get(name) || null;
    },

    registerAdapter(portName, adapter, options) {
      assertName(portName, "Port");
      if (!adapter || typeof adapter !== "object") throw new Error("Adapter is required for " + portName + ".");
      const port = PORTS.get(portName);
      if (port) {
        const missing = missingMethods(adapter, port.methods);
        if (missing.length) throw new Error("Adapter for " + portName + " is missing: " + missing.join(", "));
      }
      const entry = {
        portName,
        adapter,
        name: options && options.name || adapter.name || portName + ".adapter",
        priority: options && Number.isFinite(options.priority) ? options.priority : 100,
      };
      if (!ADAPTERS.has(portName)) ADAPTERS.set(portName, []);
      ADAPTERS.get(portName).push(entry);
      ADAPTERS.get(portName).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
      return adapter;
    },

    adapter(portName) {
      const list = ADAPTERS.get(portName) || [];
      return list.length ? list[0].adapter : null;
    },

    adapters(portName) {
      return (ADAPTERS.get(portName) || []).map(entry => entry.adapter);
    },

    registerUseCase(name, fn) {
      assertName(name, "Use case");
      if (typeof fn !== "function") throw new Error("Use case must be a function: " + name);
      USE_CASES.set(name, fn);
      return fn;
    },

    useCase(name) {
      return USE_CASES.get(name) || null;
    },

    run(name, input, context) {
      const fn = USE_CASES.get(name);
      if (!fn) throw new Error("Use case not registered: " + name);
      return fn(input || {}, context || {});
    },

    registerViewModel(name, factory) {
      assertName(name, "View model");
      if (typeof factory !== "function") throw new Error("View model must be a factory function: " + name);
      VIEW_MODELS.set(name, factory);
      return factory;
    },

    viewModel(name, input, context) {
      const factory = VIEW_MODELS.get(name);
      if (!factory) throw new Error("View model not registered: " + name);
      return factory(input || {}, context || {});
    },

    inspect() {
      return {
        ports: Array.from(PORTS.keys()).sort(),
        adapters: Array.from(ADAPTERS.entries()).map(([portName, entries]) => ({
          portName,
          adapters: entries.map(entry => entry.name),
        })),
        useCases: Array.from(USE_CASES.keys()).sort(),
        viewModels: Array.from(VIEW_MODELS.keys()).sort(),
      };
    },
  };

  window.FWHex = window.FWHex || FWHex;
})();
