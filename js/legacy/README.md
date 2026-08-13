# Deprecated Legacy Controller Paths

These files are compatibility markers for controller paths that moved into `js/modules/*/controllers/`.
They are not loaded by the current HTML pages or service worker cache.

The active controllers now live in their modules:

- `js/modules/team-access/controllers/team.controller.js`
- `js/modules/driver-portal/controllers/driver.controller.js`
- `js/modules/bulk-import/controllers/bulkimport.controller.js`
- `js/modules/service-workflow/controllers/workflow.controller.js`
- `js/modules/garage-ops/controllers/garage.controller.js`
- `js/modules/payments/controllers/payroll.controller.js`
- `js/modules/driver-map/controllers/fleetmap.controller.js`
- `js/modules/llm-gateway/controllers/copilot.controller.js`
- `js/modules/fleet-iq/controllers/analytics.controller.js`
- `js/modules/fleet-ops/controllers/fleet.controller.js`

`js/legacy/team.js`, `js/legacy/driver.js`, `js/legacy/bulkimport.js`, `js/legacy/workflow.js`, `js/legacy/garage.js`, `js/legacy/payroll.js`, `js/legacy/fleetmap.js`, `js/legacy/copilot.js`, `js/legacy/analytics.js`, and `js/legacy/fleet.js` are deprecated compatibility markers only.

Do not add new business logic here. Add it to the relevant module domain/use-case/adapter layer and call the module API from the active controller.
