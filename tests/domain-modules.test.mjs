import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(new URL('.', import.meta.url)));

function loadDomain(relativePath, globalName) {
  const source = readFileSync(resolve(__dirname, '..', relativePath), 'utf8');
  const sandbox = { window: {}, URLSearchParams, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: relativePath });
  return sandbox[globalName];
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('auth domain validates credentials and recovery links', () => {
  const auth = loadDomain('js/modules/auth/domain/auth.domain.js', 'FWAuthDomain');

  assert.equal(auth.normalizeEmail('  OWNER@Example.COM '), 'owner@example.com');
  assert.deepEqual(plain(auth.validateEmail('bad-email')), {
    ok: false,
    email: 'bad-email',
    message: 'Enter a valid email address.',
  });
  assert.deepEqual(plain(auth.validateNewPassword('secret1', 'secret2')), {
    ok: false,
    message: 'Passwords do not match.',
  });
  assert.equal(auth.recoveryRedirectUrl('https://app/reset.html', 'USER@EXAMPLE.COM'), 'https://app/reset.html?email=user%40example.com');
  assert.deepEqual(plain(auth.parseRecoveryParams('#access_token=a&type=recovery&refresh_token=r', '')), {
    type: 'recovery',
    accessToken: 'a',
    refreshToken: 'r',
    tokenType: 'bearer',
  });
  assert.equal(auth.isRecoveryLink({ type: 'recovery', accessToken: 'a' }), true);
  assert.match(auth.friendlyAuthErrorMessage({ message: 'Email rate limit exceeded' }), /rate limit/i);
});

test('bulk import domain parses vehicles, duplicates, driver links, and Excel dates', () => {
  const bulk = loadDomain('js/modules/bulk-import/domain/bulk-import.domain.js', 'FWBulkImportDomain');
  const vehicleCols = [
    ['Registration Number', 'name'],
    ['Vehicle Type', 'type'],
    ['Insurance', 'insurance', 'date'],
    ['Monthly KM', 'kmPerMonth'],
  ];

  assert.equal(bulk.excelDateToStr(45292), '2024-01-01');

  const vehicles = [{ id: 'v-existing', name: 'TN-01-AA-0001' }];
  const parsedVehicles = bulk.parseVehicleRows({
    cols: vehicleCols,
    vehicles,
    uidFn: () => 'new-id',
    rows: [
      { 'Registration Number': 'tn-01-aa-0001', 'Vehicle Type': 'Truck', Insurance: '2026-01-01', 'Monthly KM': '9000' },
      { 'Registration Number': 'KA-05-BB-2222', 'Vehicle Type': 'LCV', Insurance: 45292, 'Monthly KM': 3000 },
      { 'Registration Number': 'KA-05-BB-2222', 'Vehicle Type': 'LCV' },
      { 'Registration Number': '', 'Vehicle Type': 'Bus' },
    ],
  });

  assert.equal(parsedVehicles.dups.length, 1);
  assert.equal(parsedVehicles.news.length, 1);
  assert.equal(parsedVehicles.news[0].full.id, 'new-id');
  assert.equal(parsedVehicles.news[0].full.compliance.insurance, '2024-01-01');
  assert.equal(parsedVehicles.errors.length, 2);

  const parsedDrivers = bulk.parseDriverRows({
    cols: [
      ['Driver Name', 'name'],
      ['DL Number', 'dlNo'],
      ['Vehicle Name', 'vehicleName'],
      ['DL Expiry', 'dlExpiry', 'date'],
    ],
    vehicles: [{ id: 'v1', name: 'TN-99-TEST' }],
    drivers: [{ dlNo: 'DL-1' }],
    rows: [
      { 'Driver Name': 'Suresh', 'DL Number': 'DL-2', 'Vehicle Name': 'TN-99-TEST', 'DL Expiry': '2026-02-01' },
      { 'Driver Name': 'Existing', 'DL Number': 'DL-1' },
      { 'Driver Name': 'No Vehicle', 'DL Number': 'DL-3', 'Vehicle Name': 'MISSING' },
    ],
  });
  assert.equal(parsedDrivers.news.length, 2);
  assert.equal(parsedDrivers.news[0].fields.vehicleId, 'v1');
  assert.equal(parsedDrivers.dups.length, 1);
  assert.match(parsedDrivers.errors[0].msg, /not found/i);
});

test('fleet ops domain computes reminders, risks, health, and issue priority', () => {
  const ops = loadDomain('js/modules/fleet-ops/domain/fleet-ops.domain.js', 'FWFleetOpsDomain');
  const now = new Date('2026-08-15T00:00:00Z');
  const state = {
    vehicles: [{
      id: 'v1',
      name: 'TN-01-AA-0001',
      type: 'Truck (HCV)',
      kmPerMonth: 9000,
      compliance: { insurance: '2026-08-10', puc: '2026-08-25' },
    }],
    drivers: [{ id: 'd1', name: 'Driver One', dlExpiry: '2026-08-01' }],
    issues: [{ id: 'i1', vehicleId: 'v1', title: 'Brake problem', severity: 'High', status: 'Open', createdAt: '2026-08-01' }],
    reminders: [{ id: 'r1', vehicleId: 'v1', task: 'Oil service', everyMonths: 1, lastDate: '2026-06-01' }],
    tyreReadings: [{ vehicleId: 'v1', position: 'Front Left', treadDepth: 1.2, date: '2026-08-10' }],
    inspections: [{ vehicleId: 'v1', date: '2026-08-14', passed: false }],
    expenses: [{ vehicleId: 'v1', date: '2026-08-01', category: 'Brakes', amount: 1000 }],
    parts: [{ name: 'Air Filter', qty: 1, minQty: 2 }],
    documents: [],
    workOrders: [],
  };

  const reminders = ops.reminderStatus(state.reminders, { now });
  assert.equal(reminders[0].overdue, true);
  assert.equal(ops.prioritisedIssues(state.issues, state.vehicles, { now })[0].rank, 'P1');
  assert.equal(ops.radarItems(state, { now })[0].days < 0, true);
  assert.equal(ops.healthScore(state.vehicles[0], state, { now, minTread: 1.6 }) < 80, true);
  assert.equal(ops.computeInsights(state, {
    now,
    fmtDate: d => d,
    fmtINR: n => 'Rs ' + n,
    mileagePoints: () => [],
  }).some(item => /EXPIRED|overdue|worn|licence/i.test(item.title)), true);
});

test('fleet finance domain normalizes entries and totals money fields', () => {
  const fin = loadDomain('js/modules/fleet-fin/domain/fleet-fin.domain.js', 'FWFleetFinDomain');

  assert.deepEqual(plain(fin.normalizeExpense({ vehicleId: 'v1', category: '  tyres ', amount: '1250', gstin: 'gst123' })), {
    vehicleId: 'v1',
    date: fin.today(),
    category: 'tyres',
    amount: 1250,
    gstin: 'GST123',
  });
  assert.equal(fin.normalizeFuelLog({ litres: '10', amount: '900', odo: '12345' }).odo, 12345);
  assert.deepEqual(plain(fin.totals({
    expenses: [{ amount: 100 }, { amount: '50' }],
    fuelLogs: [{ amount: 900, litres: 10 }],
    trips: [{ freight: 2000 }],
    driverLedger: [{ type: 'advance', amount: 500 }, { type: 'settlement', amount: 200 }],
  })), {
    expenseSpend: 150,
    fuelSpend: 900,
    fuelLitres: 10,
    freight: 2000,
    driverAdvances: 500,
    driverSettlements: 200,
  });
});

test('fleet iq domain forecasts, flags anomalies, and projects what-if changes', () => {
  const iq = loadDomain('js/modules/fleet-iq/domain/fleet-iq.domain.js', 'FWFleetIQDomain');
  const series = iq.monthlySeries([
    { date: '2026-01-01', amount: 100 },
    { date: '2026-03-01', amount: 300 },
  ]);
  assert.deepEqual(plain(series), [
    { key: '2026-01', amount: 100 },
    { key: '2026-02', amount: 0 },
    { key: '2026-03', amount: 300 },
  ]);
  assert.equal(iq.forecastMonthly(series, 2).length, 2);

  const theft = iq.fuelTheftFlags({
    vehicles: [{ id: 'v1', name: 'Truck One' }],
    fuelLogs: [
      { vehicleId: 'v1', date: '2026-01-01', odo: 1000, litres: 100, amount: 9000 },
      { vehicleId: 'v1', date: '2026-01-02', odo: 1400, litres: 100, amount: 9000 },
      { vehicleId: 'v1', date: '2026-01-03', odo: 1800, litres: 100, amount: 9000 },
      { vehicleId: 'v1', date: '2026-01-04', odo: 1900, litres: 100, amount: 9000 },
    ],
  });
  assert.equal(theft.length, 1);
  assert.equal(iq.projectWhatIf({ maint: 1000, fuel: 5000, n: 2 }, { fuelPct: 0.1, kmPct: 0.2, addedVehicles: 1 }).increase, true);
});

test('maintenance domain builds normalized records and inspection faults', () => {
  const maintenance = loadDomain('js/modules/maintenance/domain/maintenance.domain.js', 'FWMaintenanceDomain');

  const inspection = maintenance.buildInspection({
    vehicleId: 'v1',
    date: '2026-08-15',
    results: [{ item: 'Brakes', ok: false }, { item: 'Lights', ok: true }],
  });
  assert.equal(inspection.passed, false);
  const faults = maintenance.inspectionFaults(inspection);
  assert.equal(faults.length, 1);
  assert.equal(faults[0].severity, 'High');
  assert.deepEqual(plain(maintenance.partRestockPatch({
    name: ' Air Filter ',
    partNumber: 'AF-1',
    qty: '3',
    minQty: '1',
    unitCost: '900',
  })), {
    name: 'Air Filter',
    partNumber: 'AF-1',
    unitCost: 900,
    qty: 3,
    minQty: 1,
  });
});

test('team access domain normalizes membership, assignment, and portal writes', () => {
  const team = loadDomain('js/modules/team-access/domain/team-access.domain.js', 'FWTeamAccessDomain');

  assert.equal(team.normalizeRole('OWNER'), 'owner');
  assert.equal(team.normalizeRole('vendor'), '');
  assert.equal(team.canUseTeamPortal({ role: 'driver' }), true);
  assert.deepEqual(plain(team.assignmentMap([{ vehicle_ext_id: 'v1', access: 'update' }, { vehicleExtId: 'v2' }])), {
    v1: 'update',
    v2: 'view',
  });
  assert.deepEqual(plain(team.normalizeFuelLog({ orgId: 'org1', vehicleId: 'veh1', litres: '12.5', amount: '1000', odo: '500' })), {
    org_id: 'org1',
    vehicle_id: 'veh1',
    log_date: team.today(),
    litres: 12.5,
    amount: 1000,
    odometer: 500,
  });
  assert.equal(team.normalizeExpenseRequest({ amount: '55', category: ' Fuel ' }).patch.category, 'Fuel');
  assert.equal(team.normalizeIssue({ title: '  Tyre puncture ' }).title, 'Tyre puncture');
});

test('garage ops domain advances jobs, estimates, stock, payouts, and ratings', () => {
  const garage = loadDomain('js/modules/garage-ops/domain/garage-ops.domain.js', 'FWGarageOpsDomain');
  const currentPeriod = garage.currentFortnight();
  const store = {
    jobs: [
      { id: 'j1', status: 'Planned', estimate: { total: 1000, status: 'Sent' }, rating: 5, completedAt: currentPeriod.start, finalAmount: 2000 },
      { id: 'j2', status: 'Planned', rating: 4 },
    ],
    stock: [],
    complaints: [{ id: 'c1', status: 'Open' }],
    profile: {},
  };

  assert.equal(garage.approveEstimate(store, 'j1').status, 'Approved');
  assert.equal(garage.completeJob(store, 'j2', 1500).finalAmount, 1500);
  assert.equal(garage.saveEstimate(store, 'j2', [{ desc: 'Labour', qty: 2, rate: 500 }]).estimate.total, 1000);
  assert.deepEqual(plain(garage.saveStockItem(store, { name: 'Filter', qty: 2, minQty: 1 }, () => 'p1')), {
    item: { id: 'p1', name: 'Filter', partNo: '', qty: 2, minQty: 1, unitCost: null },
    updated: false,
  });
  assert.equal(garage.resolveComplaint(store, 'c1').status, 'Resolved');
  const payout = garage.payoutSnapshot(store);
  assert.equal(payout.jobs >= 1, true);
  assert.equal(payout.commission, Math.round(payout.gross * garage.COMMISSION));
  assert.equal(garage.ratingSnapshot(store).rated, 2);
});

test('service workflow domain raises, advances, invoices, and maps cloud rows', () => {
  const workflow = loadDomain('js/modules/service-workflow/domain/service-workflow.domain.js', 'FWServiceWorkflowDomain');
  const mechanic = { name: 'Workshop One', rating: 4.8, km: 5, shop: 'Main Road' };
  const requests = [workflow.raise({ id: 'sr-fixed', vehicle: 'Truck', issue: 'Brake noise', mechanic })];

  assert.equal(requests[0].stage, 1);
  assert.equal(workflow.advance(requests, 'sr-fixed', 2, 'Owner', 'Accepted').stage, 2);
  requests[0].assessment = { total: 1000 };
  requests[0].stage = 6;
  const completed = workflow.advance(requests, 'sr-fixed', 7, 'Mechanic', 'Done');
  assert.equal(completed.stage, 8);
  assert.equal(completed.invoice.total, 1180);
  assert.equal(workflow.advance(requests, 'sr-fixed', 10, 'Owner'), null);

  const card = workflow.cloudRowToCard({
    row: { id: '00000000-0000-0000-0000-000000000001', stage: 'paid', issue: 'Cloud issue' },
    profile: { transport_name: 'Owner Org' },
  });
  assert.equal(card.stage, workflow.ENUM.indexOf('paid'));
  assert.equal(card.owner.name, 'Owner Org');
});

test('driver portal and map domains normalize entries and coordinates', () => {
  const driver = loadDomain('js/modules/driver-portal/domain/driver-portal.domain.js', 'FWDriverPortalDomain');
  const map = loadDomain('js/modules/driver-map/domain/driver-map.domain.js', 'FWDriverMapDomain');

  const ctx = driver.normalizeContext({ owner: 'owner1', token: 'tok', vehicle: 'TN-01', driver: 'Ravi' });
  assert.equal(driver.isValidContext(ctx), true);
  assert.deepEqual(plain(driver.entryRecord(ctx, 'fuel', driver.normalizeFuel({ litres: '10', amount: '950', odo: '1234', date: '2026-08-15' }))), {
    owner_id: 'owner1',
    token: 'tok',
    driver_name: 'Ravi',
    vehicle_name: 'TN-01',
    kind: 'fuel',
    payload: { litres: 10, amount: 950, odo: 1234, date: '2026-08-15' },
  });
  assert.equal(driver.normalizeInspection({ results: [{ ok: true }, { ok: false }] }).passed, false);

  assert.equal(map.hasCoordinates({ lat: '12.9', lng: '77.5' }), true);
  assert.deepEqual(plain(map.mapSummary([
    { lat: '12.9', lng: '77.5', source: 'telemetry' },
    { lat: '', lng: '', source: 'depot' },
  ])), { total: 2, plotted: 1, missing: 1, live: 1, staticDepot: 1 });
});

test('payment domain validates salary requests and UPI handles', () => {
  const payment = loadDomain('js/modules/payments/domain/payment.domain.js', 'FWPaymentDomain');

  assert.equal(payment.amount('-1'), 0);
  assert.equal(payment.validUpi('driver-01@upi'), true);
  assert.equal(payment.validUpi('bad upi'), false);
  assert.deepEqual(plain(payment.buildSalaryRequest({ driverExtId: 'd1', period: '2026-08', amount: '5000', note: '  advance ' })), {
    driverExtId: 'd1',
    period: '2026-08',
    amount: 5000,
    note: 'advance',
    method: 'upi',
  });
  assert.throws(() => payment.buildSalaryRequest({ period: '2026-08', amount: 5000 }), /Driver is required/);
  assert.deepEqual(plain(payment.railSummary({ id: 'cashfree', name: 'Cashfree', mode: 'api', movesMoneyInsideFleetWorks: 1 })), {
    id: 'cashfree',
    name: 'Cashfree',
    mode: 'api',
    movesMoneyInsideFleetWorks: true,
  });
});
