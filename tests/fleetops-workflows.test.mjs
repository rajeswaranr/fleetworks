import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { startServer } from '../server/static-server.mjs';

const chromeCandidates = [
  process.env.PLAYWRIGHT_CHROME,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

function chromeExecutable() {
  return chromeCandidates.find((path) => existsSync(path));
}

async function launchBrowser(t) {
  const executablePath = chromeExecutable();
  if (!executablePath) {
    t.skip('Playwright UI workflow test skipped: no Chrome/Chromium executable found.');
    return null;
  }
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    t.skip('Playwright UI workflow test skipped: playwright is not installed.');
    return null;
  }
  return playwright.chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
}

async function activate(page, tab) {
  await page.evaluate((name) => window.activateTab(name), tab);
  await page.waitForSelector(`#tab-${tab}.active`);
}

async function submitForm(page, selector) {
  await page.locator(selector).evaluate((form) => form.requestSubmit());
}

async function revealEntryForm(page, tab, formSelector) {
  const collapsed = await page.locator(formSelector).evaluate((form) => !!form.closest('.collapsed'));
  if (collapsed) await page.locator(`#tab-${tab} .lt-add`).first().click();
}

async function waitForDbCount(page, table, count) {
  await page.waitForFunction(
    ({ table: tableName, count: expected }) => window.__businessDb?.[tableName]?.length === expected,
    { table, count },
  );
}

async function expectUiText(page, selector, pattern) {
  await page.waitForFunction(
    ({ selector: target, source, flags }) => {
      const el = document.querySelector(target);
      return !!el && new RegExp(source, flags).test(el.textContent || '');
    },
    { selector, source: pattern.source, flags: pattern.flags },
  );
}

async function installFakeBusinessDb(page) {
  await page.evaluate(() => {
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const businessDb = {
      vehicles: [],
      drivers: [],
      fuel_logs: [],
      expenses: [],
      issues: [],
      work_orders: [],
      reminders: [],
      inspections: [],
      parts: [],
      documents: [],
      tyre_readings: [],
      trips: [],
      driver_ledger: [],
      service_requests: [],
      calls: [],
    };
    let seq = 0;
    const nextId = (prefix) => `${prefix}-${++seq}`;
    const record = (kind, payload) => businessDb.calls.push({ kind, payload: clone(payload) });
    const byExtId = (rows, extId) => rows.find((row) => row.id === extId || row.extId === extId);
    const patchRow = (rows, id, patch) => {
      const row = byExtId(rows, id) || rows.find((item) => item.dbId === id || item.id === id);
      if (row) Object.assign(row, clone(patch));
      return true;
    };
    const create = (table, prefix, payload) => {
      record(`create:${table}`, payload);
      const saved = { id: nextId(prefix), ...clone(payload) };
      businessDb[table].push(saved);
      return clone(saved);
    };

    window.__businessDb = businessDb;
    window.coreDbBacked = () => true;
    window.fwCloud = {
      user: () => 'owner@example.com',
      uid: () => 'owner-user-1',
      profile: () => ({ full_name: 'Test Owner', transport_name: 'Annotation Fleet Tests' }),
      push: async () => true,
      pull: async () => null,
      logout: () => {},
      authGet: async (table) => {
        if (table === 'organizations') return [{ id: 'org-test-1' }];
        if (table === 'memberships') return [{ org_id: 'org-test-1', role: 'owner' }];
        if (table === 'vehicles') return businessDb.vehicles.map((v) => ({ id: v.dbId, name: v.name }));
        if (table === 'expense_change_requests') return [];
        if (table === 'service_requests') return [];
        if (table === 'invoices') return [];
        return businessDb[table] ? clone(businessDb[table]) : [];
      },
      authInsertRet: async (table, row) => {
        record(`cloud-insert:${table}`, row);
        const saved = { id: nextId(`${table}-db`), ...clone(row) };
        if (!businessDb[table]) businessDb[table] = [];
        businessDb[table].push(saved);
        return clone(saved);
      },
      authInsert: async (table, row) => {
        record(`cloud-insert:${table}`, row);
        if (!businessDb[table]) businessDb[table] = [];
        businessDb[table].push({ id: nextId(`${table}-db`), ...clone(row) });
        return true;
      },
      authPatch: async (target, patch) => {
        record(`cloud-patch:${target}`, patch);
        return true;
      },
      authDelete: async () => true,
      authRpc: async (name) => (name === 'team_roster' ? [] : 'org-test-1'),
      callFunction: async () => ({}),
    };

    window.dbCreateVehicle = async (vehicle) => {
      record('dbCreateVehicle', vehicle);
      const saved = { ...clone(vehicle), dbId: nextId('vehicle-db') };
      businessDb.vehicles.push(saved);
      return clone(saved);
    };
    window.dbUpdateVehicleCompliance = async (extId, doc, value) => {
      record('dbUpdateVehicleCompliance', { extId, doc, value });
      const vehicle = byExtId(businessDb.vehicles, extId);
      if (vehicle) vehicle.compliance = { ...(vehicle.compliance || {}), [doc]: value };
      return true;
    };
    window.dbUpdateVehicleFields = async (extId, patch) => {
      record('dbUpdateVehicleFields', { extId, patch });
      return patchRow(businessDb.vehicles, extId, patch);
    };
    window.dbCreateDriver = async (driver) => {
      record('dbCreateDriver', driver);
      const saved = { ...clone(driver), dbId: nextId('driver-db') };
      businessDb.drivers.push(saved);
      return clone(saved);
    };
    window.dbUpdateDriver = async (extId, patch) => {
      record('dbUpdateDriver', { extId, patch });
      return patchRow(businessDb.drivers, extId, patch);
    };
    window.dbAssignVehicleToDriver = async (driverDbId, vehicleDbId) => {
      record('dbAssignVehicleToDriver', { driverDbId, vehicleDbId });
      return true;
    };
    window.dbCreateFuelLog = async (fuelLog) => {
      record('dbCreateFuelLog', fuelLog);
      return create('fuel_logs', 'fuel-db', fuelLog);
    };
    window.dbCreateExpense = async (expense) => {
      record('dbCreateExpense', expense);
      return create('expenses', 'expense-db', expense);
    };
    window.dbCreateIssue = async (issue) => {
      record('dbCreateIssue', issue);
      return create('issues', 'issue-db', issue);
    };
    window.dbUpdateIssue = async (extId, patch) => {
      record('dbUpdateIssue', { extId, patch });
      return patchRow(businessDb.issues, extId, patch);
    };
    window.dbCreateWorkOrder = async (workOrder) => {
      record('dbCreateWorkOrder', workOrder);
      return create('work_orders', 'workorder-db', workOrder);
    };
    window.dbUpdateWorkOrder = async (id, patch) => {
      record('dbUpdateWorkOrder', { id, patch });
      return patchRow(businessDb.work_orders, id, patch);
    };
    window.dbCreateReminder = async (reminder) => {
      record('dbCreateReminder', reminder);
      return create('reminders', 'reminder-db', reminder);
    };
    window.dbCreateInspection = async (inspection) => {
      record('dbCreateInspection', inspection);
      return create('inspections', 'inspection-db', inspection);
    };
    window.dbCreatePart = async (part) => {
      record('dbCreatePart', part);
      return create('parts', 'part-db', part);
    };
    window.dbUpdatePart = async (id, patch) => {
      record('dbUpdatePart', { id, patch });
      return patchRow(businessDb.parts, id, patch);
    };
    window.dbCreateDocument = async (documentRow) => {
      record('dbCreateDocument', documentRow);
      return create('documents', 'document-db', documentRow);
    };
    window.dbCreateTyreReading = async (tyreReading) => {
      record('dbCreateTyreReading', tyreReading);
      return create('tyre_readings', 'tyre-db', tyreReading);
    };
    window.dbCreateTrip = async (trip) => {
      record('dbCreateTrip', trip);
      return create('trips', 'trip-db', trip);
    };
    window.dbCreateLedgerEntry = async (ledgerEntry) => {
      record('dbCreateLedgerEntry', ledgerEntry);
      return create('driver_ledger', 'ledger-db', ledgerEntry);
    };
    window.renderAuthState?.();
  });
}

test('FleetOps workflow pages save test data through the business DB layer and reflect it in the UI', async (t) => {
  const browser = await launchBrowser(t);
  if (!browser) return;

  const server = await startServer({ port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  t.after(() => browser.close());

  const address = server.address();
  const context = await browser.newContext();
  await context.addInitScript(() => {
    localStorage.clear();
    sessionStorage.setItem('fwDemo', '1');
  });
  const page = await context.newPage();
  page.on('dialog', async (dialog) => {
    const message = dialog.message();
    if (dialog.type() === 'prompt') {
      if (/Workshop|mechanic/i.test(message)) await dialog.accept('FleetWorks Test Workshop');
      else if (/Estimated cost/i.test(message)) await dialog.accept('12500');
      else if (/Final bill amount/i.test(message)) await dialog.accept('11800');
      else if (/Expense category/i.test(message)) await dialog.accept('Brake Inspection');
      else await dialog.accept('UI test note');
      return;
    }
    await dialog.accept();
  });

  await page.goto(`http://127.0.0.1:${address.port}/fleet.html#addvehicle`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.activateTab === 'function' && typeof window.dbCreateVehicle === 'function');
  await installFakeBusinessDb(page);

  await activate(page, 'addvehicle');
  await page.fill('#addVehForm [name="name"]', 'TN-88-AA-1001');
  await page.selectOption('#addVehForm [name="type"]', { label: 'Truck (HCV)' });
  await page.fill('#addVehForm [name="make"]', 'Tata');
  await page.fill('#addVehForm [name="model"]', 'Prima Test');
  await page.fill('#addVehForm [name="kmPerMonth"]', '8200');
  await page.fill('#addVehForm [name="odo"]', '51000');
  await page.fill('#addVehForm [name="depot"]', 'Coimbatore');
  await page.fill('#addVehForm [name="insurance"]', '2026-09-15');
  await page.fill('#addVehForm [name="puc"]', '2026-09-20');
  await submitForm(page, '#addVehForm');
  await waitForDbCount(page, 'vehicles', 1);
  await waitForDbCount(page, 'fuel_logs', 1);
  await expectUiText(page, '#vehicleComplianceTable', /TN-88-AA-1001/);

  const vehicleId = await page.locator('#compVehicle option').first().getAttribute('value');
  assert.ok(vehicleId, 'vehicle select should contain the saved vehicle');

  await activate(page, 'vehicles');
  await revealEntryForm(page, 'vehicles', '#complianceForm');
  await page.selectOption('#compVehicle', vehicleId);
  await page.selectOption('#complianceForm [name="doc"]', 'fitness');
  await page.fill('#complianceForm [name="validTill"]', '2026-10-10');
  await submitForm(page, '#complianceForm');
  await page.waitForFunction(() => window.__businessDb.calls.some((call) => call.kind === 'dbUpdateVehicleCompliance'));

  await activate(page, 'drivers');
  await revealEntryForm(page, 'drivers', '#driverForm');
  await page.fill('#driverForm [name="name"]', 'Annotation Test Driver');
  await page.fill('#driverForm [name="phone"]', '9876543210');
  await page.fill('#driverForm [name="dlNo"]', 'TN88 20260010001');
  await page.fill('#driverForm [name="dlExpiry"]', '2026-11-01');
  await page.selectOption('#driverVehicle', vehicleId);
  await page.fill('#driverForm [name="upiId"]', 'driver@testupi');
  await submitForm(page, '#driverForm');
  await waitForDbCount(page, 'drivers', 1);
  await expectUiText(page, '#driversTable', /Annotation Test Driver/);

  await activate(page, 'assignments');
  await expectUiText(page, '#assignTable', /Annotation Test Driver/);

  await activate(page, 'fuel');
  await revealEntryForm(page, 'fuel', '#fuelForm');
  await page.selectOption('#fuelVehicle', vehicleId);
  await page.fill('#fuelForm [name="date"]', '2026-08-01');
  await page.fill('#fuelForm [name="litres"]', '150');
  await page.fill('#fuelForm [name="amount"]', '14250');
  await page.fill('#fuelForm [name="odo"]', '51500');
  await submitForm(page, '#fuelForm');
  await waitForDbCount(page, 'fuel_logs', 2);
  await expectUiText(page, '#fuelTable', /150|51,500|14\.3K/);

  await activate(page, 'meters');
  await expectUiText(page, '#meterTable', /TN-88-AA-1001/);

  await activate(page, 'trips');
  await page.getByRole('button', { name: /Quick Log/i }).click();
  await page.selectOption('#tripVehicleSelect', vehicleId);
  await page.fill('#tripForm [name="date"]', '2026-08-02');
  await page.fill('#tripForm [name="from"]', 'Coimbatore');
  await page.fill('#tripForm [name="to"]', 'Chennai');
  await page.fill('#tripForm [name="freight"]', '68000');
  await page.fill('#tripForm [name="km"]', '510');
  await submitForm(page, '#tripForm');
  await waitForDbCount(page, 'trips', 1);
  await expectUiText(page, '#tripsTable', /Coimbatore.*Chennai/s);

  await activate(page, 'issues');
  await revealEntryForm(page, 'issues', '#issueForm');
  await page.selectOption('#issueVehicle', vehicleId);
  await page.selectOption('#issueForm [name="severity"]', { label: 'High' });
  await page.fill('#issueForm [name="title"]', 'Brake pedal validation issue');
  await submitForm(page, '#issueForm');
  await waitForDbCount(page, 'issues', 1);
  await expectUiText(page, '#issuesList', /Brake pedal validation issue/);

  await page.getByRole('button', { name: /Open Job Card/i }).first().click();
  await waitForDbCount(page, 'work_orders', 1);
  await activate(page, 'workorders');
  await expectUiText(page, '#workOrdersList', /FleetWorks Test Workshop/);
  await page.getByRole('button', { name: /Complete & Bill/i }).first().click();
  await page.fill('#billLines [data-bill="description"][data-i="0"]', 'Brake inspection and repair');
  await page.fill('#billLines [data-bill="amount"][data-i="0"]', '11800');
  await page.fill('#billCategory', 'Brake Inspection');
  await page.click('#billCloseJobBtn');
  await waitForDbCount(page, 'expenses', 1);
  await page.waitForFunction(() => window.__businessDb.calls.some((call) => call.kind === 'dbUpdateWorkOrder'));

  await activate(page, 'servicehistory');
  await expectUiText(page, '#svcHistTable', /Brake Inspection/);

  await activate(page, 'inspections');
  await page.selectOption('#inspVehicle', vehicleId);
  await page.check('#inspectionForm input[name="item1"][value="fail"]', { force: true });
  await submitForm(page, '#inspectionForm');
  await waitForDbCount(page, 'inspections', 1);
  await waitForDbCount(page, 'issues', 2);
  await expectUiText(page, '#inspectionHistory', /fault/);

  await activate(page, 'forms');
  await expectUiText(page, '#formsList', /Daily 10-Point Check/);

  await activate(page, 'reminders');
  await revealEntryForm(page, 'reminders', '#reminderForm');
  await page.selectOption('#remVehicle', vehicleId);
  await page.selectOption('#reminderForm [name="task"]', { label: 'Engine Oil & Filters' });
  await page.fill('#reminderForm [name="everyMonths"]', '3');
  await page.fill('#reminderForm [name="lastDate"]', '2026-07-01');
  await submitForm(page, '#reminderForm');
  await waitForDbCount(page, 'reminders', 1);
  await expectUiText(page, '#remindersList', /Engine Oil/);

  await activate(page, 'parts');
  await revealEntryForm(page, 'parts', '#partForm');
  await page.fill('#partForm [name="name"]', 'Annotation Air Filter');
  await page.fill('#partForm [name="partNumber"]', 'AF-TEST-001');
  await page.selectOption('#partForm [name="category"]', { label: 'Filters' });
  await page.fill('#partForm [name="vendor"]', 'Annotation Spares Vendor');
  await page.fill('#partForm [name="vendorContact"]', '9123456780');
  await page.fill('#partForm [name="unitCost"]', '1250');
  await page.fill('#partForm [name="qty"]', '2');
  await page.fill('#partForm [name="minQty"]', '5');
  await page.fill('#partForm [name="warrantyExpiry"]', '2026-12-31');
  await submitForm(page, '#partForm');
  await waitForDbCount(page, 'parts', 1);
  await expectUiText(page, '#partsTable', /Annotation Air Filter/);

  await activate(page, 'vendors');
  await expectUiText(page, '#vendorTable', /Annotation Spares Vendor/);

  await activate(page, 'documents');
  await revealEntryForm(page, 'documents', '#documentForm');
  await page.selectOption('#docEntityType', 'vehicle');
  await page.selectOption('#docEntitySelect', vehicleId);
  await page.selectOption('#docTypeSelect', { label: 'Insurance Policy' });
  await page.fill('#documentForm [name="number"]', 'POLICY-TEST-001');
  await page.fill('#documentForm [name="issueDate"]', '2026-07-15');
  await page.fill('#documentForm [name="expiryDate"]', '2026-09-30');
  await page.fill('#documentForm [name="note"]', 'Annotation policy');
  await submitForm(page, '#documentForm');
  await waitForDbCount(page, 'documents', 1);
  await expectUiText(page, '#documentsTable', /POLICY-TEST-001/);

  await activate(page, 'radar');
  await expectUiText(page, '#radarTable', /Insurance|Engine Oil|Annotation Air Filter/);

  await activate(page, 'tyres');
  await page.evaluate(() => openLogReadingCard());
  await page.waitForSelector('#tyreLogCard:not([hidden])');
  await page.selectOption('#tyreFormVehicle', vehicleId);
  await page.selectOption('#tyrePosition', { label: 'Front Left' });
  await page.fill('#tyreForm [name="treadDepth"]', '1.2');
  await page.fill('#tyreForm [name="pressure"]', '92');
  await page.fill('#tyreForm [name="odo"]', '51600');
  await page.fill('#tyreForm [name="date"]', '2026-08-03');
  await submitForm(page, '#tyreForm');
  await waitForDbCount(page, 'tyre_readings', 1);
  await expectUiText(page, '#tyreAxleDiagram', /Left.*1\.2mm/s);

  await activate(page, 'servicereq');
  await page.selectOption('#svcVehicle', vehicleId);
  await page.selectOption('#svcReqForm [name="severity"]', { label: 'High' });
  await page.fill('#svcReqForm [name="issue"]', 'Air leak service workflow test');
  await submitForm(page, '#svcReqForm');
  await waitForDbCount(page, 'service_requests', 1);
  await expectUiText(page, '#svcReqList', /Air leak service workflow test/);

  await activate(page, 'account');
  await page.waitForSelector('#portalView:not([hidden])');
  await page.fill('#qeFuelForm [name="litres"]', '80');
  await page.fill('#qeFuelForm [name="amount"]', '7600');
  await page.fill('#qeFuelForm [name="odo"]', '51800');
  await page.fill('#qeFuelForm [name="date"]', '2026-08-04');
  await submitForm(page, '#qeFuelForm');
  await waitForDbCount(page, 'fuel_logs', 3);
  await page.click('#entryTabs [data-tab="expense"]');
  await page.fill('#qeExpForm [name="category"]', 'Owner Portal Expense');
  await page.fill('#qeExpForm [name="amount"]', '900');
  await page.fill('#qeExpForm [name="date"]', '2026-08-04');
  await page.fill('#qeExpForm [name="odo"]', '51820');
  await submitForm(page, '#qeExpForm');
  await waitForDbCount(page, 'expenses', 2);
  await page.click('#entryTabs [data-tab="issue"]');
  await page.fill('#qeIssForm [name="title"]', 'Owner portal quick problem');
  await page.selectOption('#qeIssForm [name="severity"]', { label: 'Medium' });
  await submitForm(page, '#qeIssForm');
  await waitForDbCount(page, 'issues', 3);
  await expectUiText(page, '#recentList', /Owner portal quick problem|Owner Portal Expense/);

  await activate(page, 'overview');
  await expectUiText(page, '#dashGrid', /TN-88-AA-1001|Annotation Test Driver|Brake/);

  const dbSnapshot = await page.evaluate(() => ({
    vehicles: window.__businessDb.vehicles.length,
    drivers: window.__businessDb.drivers.length,
    fuelLogs: window.__businessDb.fuel_logs.length,
    expenses: window.__businessDb.expenses.length,
    issues: window.__businessDb.issues.length,
    workOrders: window.__businessDb.work_orders.length,
    reminders: window.__businessDb.reminders.length,
    inspections: window.__businessDb.inspections.length,
    parts: window.__businessDb.parts.length,
    documents: window.__businessDb.documents.length,
    tyreReadings: window.__businessDb.tyre_readings.length,
    trips: window.__businessDb.trips.length,
    serviceRequests: window.__businessDb.service_requests.length,
    callKinds: window.__businessDb.calls.map((call) => call.kind),
  }));

  assert.deepEqual(
    {
      vehicles: dbSnapshot.vehicles,
      drivers: dbSnapshot.drivers,
      fuelLogs: dbSnapshot.fuelLogs,
      expenses: dbSnapshot.expenses,
      issues: dbSnapshot.issues,
      workOrders: dbSnapshot.workOrders,
      reminders: dbSnapshot.reminders,
      inspections: dbSnapshot.inspections,
      parts: dbSnapshot.parts,
      documents: dbSnapshot.documents,
      tyreReadings: dbSnapshot.tyreReadings,
      trips: dbSnapshot.trips,
      serviceRequests: dbSnapshot.serviceRequests,
    },
    {
      vehicles: 1,
      drivers: 1,
      fuelLogs: 3,
      expenses: 2,
      issues: 3,
      workOrders: 1,
      reminders: 1,
      inspections: 1,
      parts: 1,
      documents: 1,
      tyreReadings: 1,
      trips: 1,
      serviceRequests: 1,
    },
  );
  for (const expectedCall of [
    'dbCreateVehicle',
    'dbCreateDriver',
    'dbCreateFuelLog',
    'dbCreateExpense',
    'dbCreateIssue',
    'dbCreateWorkOrder',
    'dbCreateReminder',
    'dbCreateInspection',
    'dbCreatePart',
    'dbCreateDocument',
    'dbCreateTyreReading',
    'dbCreateTrip',
    'cloud-insert:service_requests',
  ]) {
    assert.ok(dbSnapshot.callKinds.includes(expectedCall), `${expectedCall} should be called`);
  }
});

test('FleetFin and FleetIQ seed data persists through the business DB layer and populates each UI page', async (t) => {
  const browser = await launchBrowser(t);
  if (!browser) return;

  const server = await startServer({ port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  t.after(() => browser.close());

  const address = server.address();
  const context = await browser.newContext();
  await context.addInitScript(() => {
    localStorage.clear();
    sessionStorage.setItem('fwDemo', '1');
  });
  const page = await context.newPage();
  page.on('dialog', async (dialog) => dialog.accept());

  await page.goto(`http://127.0.0.1:${address.port}/fleet.html#account`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.activateTab === 'function' && typeof window.dbCreateVehicle === 'function');
  await installFakeBusinessDb(page);
  await page.waitForFunction(() => typeof window.seedFleetFinIqTestData === 'function');

  await activate(page, 'account');
  await page.waitForSelector('#testDataCard:not([hidden])');
  await page.click('#seedFinIqBtn');
  await waitForDbCount(page, 'vehicles', 10);
  await waitForDbCount(page, 'drivers', 10);
  await waitForDbCount(page, 'fuel_logs', 120);
  await waitForDbCount(page, 'expenses', 60);
  await waitForDbCount(page, 'trips', 60);
  await waitForDbCount(page, 'inspections', 10);
  await waitForDbCount(page, 'issues', 10);
  await waitForDbCount(page, 'work_orders', 10);
  await waitForDbCount(page, 'reminders', 10);
  await waitForDbCount(page, 'parts', 5);
  await waitForDbCount(page, 'documents', 10);
  await waitForDbCount(page, 'tyre_readings', 40);
  await waitForDbCount(page, 'driver_ledger', 20);
  await expectUiText(page, '#ownerStats', /My vehicles\s*10/);
  await expectUiText(page, '#recentList', /TN-88-AA/);

  await activate(page, 'fin');
  await expectUiText(page, '#finStatRow', /Total expenses this month|Fleet cost per km/);
  await expectUiText(page, '#monthlyTable', /Spend|actual/i);
  await expectUiText(page, '#vehicleTable', /TN-88-AA-1001/);
  await expectUiText(page, '#partTable', /Brakes|Tyres|Engine Oil/);
  await expectUiText(page, '#fuelWatch', /unaccounted|Mileage steady/i);

  await activate(page, 'khata');
  await expectUiText(page, '#khataBalances', /Suresh Kumar|Manoj Yadav/);
  await expectUiText(page, '#khataTable', /FleetFin seed trip advance|FleetFin seed route expense/);

  await activate(page, 'payroll');
  await expectUiText(page, '#manualSalaryDriver', /Suresh Kumar/);
  await expectUiText(page, '#payrollHistory', /FleetFin seed salary payment|FWSEED/);

  await activate(page, 'expensehistory');
  await expectUiText(page, '#expHistTable', /Seed .* bill|FW-SEED/i);

  await activate(page, 'gstbills');
  await expectUiText(page, '#gstTiles', /ITC this quarter|GST bills captured/);
  await expectUiText(page, '#gstBillsTable', /FW-SEED|33ABCDE1234F1Z5/);

  await activate(page, 'accounts');
  await expectUiText(page, '#accountsSummary', /Maintenance|Diesel|Total/);

  await activate(page, 'reports');
  await expectUiText(page, '#reportGrid', /Compliance Report|Expense Report|Full Backup/);

  await activate(page, 'analytics');
  await expectUiText(page, '#iqStatRow', /Forecast, next 3 months|AI signals active/);
  await expectUiText(page, '#iqMonthlyTable', /forecast/i);
  await expectUiText(page, '#predictions', /Plan ahead|Due soon|Overdue|Healthy/);
  await expectUiText(page, '#insightsFeed', /Compliance|Fuel anomaly|Issue|Warranty|AI/);

  await activate(page, 'recurrent');
  await expectUiText(page, '#recurTable', /Repeat repair|Repeat issue/);

  await activate(page, 'deviation');
  await expectUiText(page, '#devTable', /costlier|cheaper|Within band/i);

  await activate(page, 'benchmark');
  await expectUiText(page, '#benchTables', /Maintenance cost per km|Diesel mileage|Part cost per job/);

  await activate(page, 'whatif');
  await expectUiText(page, '#wiOut', /Projected \/ month|Yearly impact/);

  await activate(page, 'forecasting');
  await expectUiText(page, '#fcastTable', /forecast/i);

  await activate(page, 'anomaly');
  await expectUiText(page, '#anomTable', /Billed|normal|No anomalies/i);

  await activate(page, 'replacement');
  await expectUiText(page, '#replTable', /Cost \/ km|Healthy|Review|Watch/);

  await activate(page, 'itemfailures');
  await expectUiText(page, '#failTable', /Failed Item|Tyres|Brakes|Lights|Horn/i);

  await activate(page, 'recommend');
  await expectUiText(page, '#recoList', /Plan|Audit|EXPIRED|All clear|Deviation/i);

  const dbSnapshot = await page.evaluate(() => ({
    callKinds: window.__businessDb.calls.map((call) => call.kind),
    salaryRows: window.__businessDb.salary_payments?.length || 0,
    paymentRequests: window.__businessDb.payment_requests?.length || 0,
  }));

  for (const expectedCall of [
    'dbCreateVehicle',
    'dbCreateDriver',
    'dbCreateFuelLog',
    'dbCreateExpense',
    'dbCreateIssue',
    'dbCreateWorkOrder',
    'dbCreateReminder',
    'dbCreateInspection',
    'dbCreatePart',
    'dbCreateDocument',
    'dbCreateTyreReading',
    'dbCreateTrip',
    'dbCreateLedgerEntry',
    'cloud-insert:salary_payments',
    'cloud-insert:payment_requests',
  ]) {
    assert.ok(dbSnapshot.callKinds.includes(expectedCall), `${expectedCall} should be called`);
  }
  assert.equal(dbSnapshot.salaryRows, 4);
  assert.equal(dbSnapshot.paymentRequests, 4);
});

test('create free owner account link opens the owner registration form', async (t) => {
  const browser = await launchBrowser(t);
  if (!browser) return;

  const server = await startServer({ port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  t.after(() => browser.close());

  const address = server.address();
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.clear());
  const page = await context.newPage();

  await page.goto(`http://127.0.0.1:${address.port}/signin.html`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: /Create a free owner account/i }).click();
  await page.waitForURL(/fleet\.html\?auth=signup#account$/);
  await page.waitForSelector('#authGate:not([hidden])');

  await expectUiText(page, '#authTitle', /Create Owner Account/);
  await expectUiText(page, '#authSubmit', /Create Free Account/);
  assert.equal(await page.locator('#signupOnlyFields').evaluate((el) => el.hidden), false);
  await expectUiText(page, '#signupOnlyFields', /Transport \/ Company Name|GST Number or PAN|Mobile Number/);
});
