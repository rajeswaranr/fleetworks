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
    t.skip('Role-gate UI test skipped: no Chrome/Chromium executable found.');
    return null;
  }
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    t.skip('Role-gate UI test skipped: playwright is not installed.');
    return null;
  }
  return playwright.chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
}

function sessionFor(email, { metadata = {}, appMetadata = {}, id = 'user-1' } = {}) {
  return {
    access_token: 'access-' + email,
    refresh_token: 'refresh-' + email,
    token_type: 'bearer',
    user: { id, email, user_metadata: metadata, app_metadata: appMetadata },
  };
}

async function withPage(t, setup) {
  const browser = await launchBrowser(t);
  if (!browser) return null;
  const server = await startServer({ port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  t.after(() => browser.close());
  const context = await browser.newContext();
  t.after(() => context.close());
  if (setup) await setup(context);
  const page = await context.newPage();
  return { page, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function installSession(context, session) {
  await context.addInitScript((s) => {
    localStorage.clear();
    sessionStorage.clear();
    const key = 'fw_session:' + s.user.email;
    localStorage.setItem(key, JSON.stringify(s));
    localStorage.setItem('fw_session:active', key);
  }, session);
}

async function mockSupabase(context, options = {}) {
  await context.route('https://crdblxeufbhysglbbtxi.supabase.co/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const bodyText = request.postData() || '{}';
    const body = JSON.parse(bodyText || '{}');

    if (path.endsWith('/auth/v1/token') && url.search.includes('grant_type=password')) {
      const isAdmin = options.loginRole === 'admin';
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sessionFor(body.email || 'user@example.com', {
          id: 'login-user-1',
          appMetadata: isAdmin ? { role: 'admin' } : {},
          metadata: options.loginRole === 'partner' ? { fleetworks_role: 'partner' } : {},
        })),
      });
    }

    if (path.includes('/rest/v1/memberships')) {
      const rows = options.memberships || [];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
    }
    if (path.includes('/rest/v1/vendor_applications')) {
      const rows = options.vendorApplications || [];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
    }
    if (path.includes('/rest/v1/fleets')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    }
    if (path.includes('/rest/v1/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    }
    if (path.includes('/functions/v1/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });
}

async function waitForText(page, selector, pattern) {
  await page.waitForFunction(
    ({ selector: target, source, flags }) => {
      const el = document.querySelector(target);
      return !!el && !el.hidden && new RegExp(source, flags).test(el.textContent || '');
    },
    { selector, source: pattern.source, flags: pattern.flags },
  );
}

test('owner dashboard rejects partner and admin sessions', async (t) => {
  {
    const env = await withPage(t, async (context) => {
      await installSession(context, sessionFor('partner@example.com', {
        id: 'partner-user-1',
        metadata: { fleetworks_role: 'partner', role: 'partner', business_name: 'Partner Workshop' },
      }));
      await mockSupabase(context);
    });
    if (!env) return;
    await env.page.goto(`${env.baseUrl}/fleet.html#overview`, { waitUntil: 'domcontentloaded' });
    await waitForText(env.page, '#authErr', /workshop partner account/i);
    assert.equal(await env.page.locator('.app-shell').evaluate((el) => getComputedStyle(el).display), 'none');
    await env.page.context().close();
  }

  {
    const env = await withPage(t, async (context) => {
      await installSession(context, sessionFor('admin@example.com', {
        id: 'admin-user-1',
        appMetadata: { role: 'admin' },
      }));
      await mockSupabase(context);
    });
    if (!env) return;
    await env.page.goto(`${env.baseUrl}/fleet.html#overview`, { waitUntil: 'domcontentloaded' });
    await waitForText(env.page, '#authErr', /admin account/i);
    assert.equal(await env.page.locator('#authErr a').textContent(), 'Open Admin Console');
  }
});

test('vendor dashboards reject owner and admin sessions', async (t) => {
  const ownerMembership = [{ org_id: 'org-owner-1', role: 'owner' }];

  {
    const env = await withPage(t, async (context) => {
      await installSession(context, sessionFor('owner@example.com', {
        id: 'owner-user-1',
        metadata: { fleetworks_role: 'owner', transport_name: 'Owner Fleet' },
      }));
      await mockSupabase(context, { memberships: ownerMembership });
    });
    if (!env) return;
    await env.page.goto(`${env.baseUrl}/garage.html`, { waitUntil: 'domcontentloaded' });
    await waitForText(env.page, '#gLoginErr', /not a workshop partner account/i);
    assert.equal(await env.page.locator('#gShell').evaluate((el) => getComputedStyle(el).display), 'none');
    await env.page.context().close();
  }

  {
    const env = await withPage(t, async (context) => {
      await installSession(context, sessionFor('admin@example.com', {
        id: 'admin-user-1',
        appMetadata: { role: 'admin' },
      }));
      await mockSupabase(context);
    });
    if (!env) return;
    await env.page.goto(`${env.baseUrl}/garage.html`, { waitUntil: 'domcontentloaded' });
    await waitForText(env.page, '#gLoginErr', /not a workshop partner account/i);
    assert.equal(await env.page.locator('#gLoginErr a').textContent(), 'Open Admin Console');
    await env.page.context().close();
  }

  {
    const env = await withPage(t, async (context) => {
      await installSession(context, sessionFor('owner@example.com', {
        id: 'owner-user-1',
        metadata: { fleetworks_role: 'owner', transport_name: 'Owner Fleet' },
      }));
      await mockSupabase(context, { memberships: ownerMembership });
    });
    if (!env) return;
    await env.page.goto(`${env.baseUrl}/partner.html`, { waitUntil: 'domcontentloaded' });
    await waitForText(env.page, '#partnerLoginErr', /not a workshop partner account/i);
  }
});

test('admin console rejects non-admin login and opens for admin login', async (t) => {
  {
    const env = await withPage(t, async (context) => {
      await mockSupabase(context, { loginRole: 'owner' });
    });
    if (!env) return;
    await env.page.goto(`${env.baseUrl}/admin.html`, { waitUntil: 'domcontentloaded' });
    await env.page.fill('#loginForm input[name="email"]', 'owner@example.com');
    await env.page.fill('#loginForm input[name="password"]', 'secret-1');
    await env.page.locator('#loginForm').evaluate((form) => form.requestSubmit());
    await waitForText(env.page, '#loginError', /not a FleetWorks admin account/i);
    assert.equal(await env.page.locator('#consoleView').isHidden(), true);
    await env.page.context().close();
  }

  {
    const env = await withPage(t, async (context) => {
      await mockSupabase(context, { loginRole: 'admin' });
    });
    if (!env) return;
    await env.page.goto(`${env.baseUrl}/admin.html`, { waitUntil: 'domcontentloaded' });
    await env.page.fill('#loginForm input[name="email"]', 'admin@example.com');
    await env.page.fill('#loginForm input[name="password"]', 'secret-1');
    await env.page.locator('#loginForm').evaluate((form) => form.requestSubmit());
    await env.page.waitForSelector('#consoleView:not([hidden])');
    assert.equal(await env.page.locator('#loginView').isHidden(), true);
    assert.equal(await env.page.locator('#logoutBtn').isHidden(), false);
  }
});
