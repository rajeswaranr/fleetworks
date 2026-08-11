/* ============ FleetWorks — bulk-import/use-cases ============ */
(function () {
  "use strict";
  function repo() { return window.FWHex && FWHex.adapter("bulkImport.repository") || window.FWBulkImportRepository; }
  function state(input) { return input && input.state || repo().state(); }
  function register(name, fn) { if (window.FWHex) FWHex.registerUseCase(name, fn); return fn; }
  const useCases = {
    parseVehicleRows: register("bulkImport.parseVehicleRows", input => {
      const s = state(input);
      return FWBulkImportDomain.parseVehicleRows({ ...input, vehicles: s.vehicles || [] });
    }),
    parseDriverRows: register("bulkImport.parseDriverRows", input => {
      const s = state(input);
      return FWBulkImportDomain.parseDriverRows({ ...input, vehicles: s.vehicles || [], drivers: s.drivers || [] });
    }),
  };
  window.FWBulkImportUseCases = window.FWBulkImportUseCases || useCases;
})();
