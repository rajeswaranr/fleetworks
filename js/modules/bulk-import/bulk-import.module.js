/* ============ FleetWorks — modules/bulk-import ============ */
(function () {
  "use strict";
  const BulkImport = {
    excelDateToStr: FWBulkImportDomain.excelDateToStr,
    buildGetter: FWBulkImportDomain.buildGetter,
    parseVehicleRows(input) { return FWBulkImportUseCases.parseVehicleRows(input || {}); },
    parseDriverRows(input) { return FWBulkImportUseCases.parseDriverRows(input || {}); },
    summary(input) { return FWBulkImportViewModel.summary(input || {}); },
  };
  window.FWBulkImport = window.FWBulkImport || BulkImport;
  function registerHex() {
    if (!window.FWHex) return false;
    if (!FWHex.port("bulkImport.repository")) FWHex.definePort("bulkImport.repository", FWBulkImportPort.methods);
    if (!FWHex.adapter("bulkImport.repository")) FWHex.registerAdapter("bulkImport.repository", FWBulkImportRepository, { priority: 10 });
    Object.entries(FWBulkImportUseCases).forEach(([key, fn]) => FWHex.registerUseCase("bulkImport." + key, fn));
    FWHex.registerViewModel("bulkImport.summary", FWBulkImportViewModel.summary);
    return true;
  }
  function registerPlatformModule() {
    if (!window.FWPlatform) return false;
    if (FWPlatform.getModule && FWPlatform.getModule("bulk_import")) return true;
    FWPlatform.registerModule({
      id: "bulk_import", name: "Bulk Import", version: "0.1.0", layer: "feature", order: 55,
      description: "Excel template parsing and duplicate-safe vehicle/driver imports.",
      dependencies: ["fleet_core"], permissions: ["fleet.import"], tables: ["vehicles", "drivers"],
      capabilities: ["bulk_import.parse"],
      init(ctx) { ctx.platform.registerCapability("bulk_import.parse", BulkImport); },
    });
    return true;
  }
  if (!registerHex()) setTimeout(registerHex, 0);
  if (!registerPlatformModule()) setTimeout(registerPlatformModule, 0);
})();
