# FleetWorks AI-Assisted BDD Pipeline

This directory is the human-readable source of truth for AI-assisted BDD testing.
It contains specifications and execution records only; it does not contain a new
automation framework.

## Folder structure

```text
tests/bdd/
  README.md                         Pipeline rules and result definitions
  features/
    authentication/
      owner-login.feature           Owner-login BDD specification
  reports/
    2026-09-12-owner-login.md        Saved result from the sample execution
  evidence/
    <run-id>/                        Screenshots, traces, and logs when available
```

Future business areas should have their own directory under `features`, for
example `fleet`, `drivers`, `expenses`, and `maintenance`.

## AI-agent workflow

```text
Select scenarios by feature or tag
  -> verify environment and test-user prerequisites
  -> execute the Given/When/Then steps
  -> evaluate deterministic assertions
  -> collect evidence
  -> record scenario results
  -> publish run totals and failure analysis
```

The AI agent may select scenarios, operate the application, collect evidence,
and explain failures. It must not subjectively override an assertion result.

## Result statuses

- `PASSED`: every Then assertion was verified.
- `FAILED`: the application produced a result contrary to an assertion.
- `BLOCKED`: a prerequisite such as credentials, browser, or service was unavailable.
- `SKIPPED`: the scenario was deliberately excluded from the run.
- `ERROR`: the runner or agent failed before the application could be evaluated.
- `FLAKY`: an attempt failed but a retry passed; both attempts remain recorded.

Blocked, skipped, error, and flaky scenarios are never silently counted as passed.

## Required run summary

Every report records the run ID, environment, application version when known,
agent, timestamps, total scenarios, passed, failed, blocked, skipped, errors,
flaky scenarios, duration, assertion evidence, and any failed step.

## Test-user policy

Use dedicated non-production users and isolated test organizations. Credentials
must come from secure environment configuration and must never be written in a
feature, report, screenshot, prompt, or source-controlled file.

The initial sample uses mocked authentication and therefore validates the owner
login contract rather than a live production-style browser login. A live E2E
scenario requires a provisioned test owner and an available browser surface.
