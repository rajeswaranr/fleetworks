# Owner Login BDD Execution Report

## Run summary

| Field | Result |
|---|---|
| Run ID | `BDD-OWNER-LOGIN-20260912-001` |
| Executed by | AI testing agent |
| Environment | Local isolated test environment |
| Authentication | Mocked test response; no real credentials |
| Scope | Owner-login contract plus owner role-isolation checks |
| Status | `PASSED` |
| Scenarios | 1 |
| Passed | 1 |
| Failed | 0 |
| Blocked | 0 |
| Skipped | 0 |
| Errors | 0 |
| Flaky | 0 |

## Scenario result

**Scenario:** Registered owner establishes a session with valid credentials  
**Result:** `PASSED`

Verified assertions:

- An owner login creates an authenticated session.
- Login does not pull owner fleet business data.
- Owner-facing pages reject partner and administrator sessions.
- Vendor-facing pages reject owner and administrator sessions.

## Execution output

```text
PASS login only creates a session and does not pull owner fleet data (2.88801 ms)
PASS owner dashboard rejects partner and admin sessions (1923.859171 ms)
PASS vendor dashboards reject owner and admin sessions (2007.227446 ms)

Supporting checks: 3
Passed: 3
Failed: 0
Cancelled: 0
Skipped: 0
Duration: 4026.652532 ms
```

## Execution boundary

This result proves the isolated authentication/session contract and relevant role
gates. It does not prove that a real Supabase owner can complete the visible login
form and reach the fleet application. That separate E2E test remains dependent on
a dedicated non-production owner account and a supported interactive browser.
