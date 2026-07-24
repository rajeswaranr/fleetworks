# FleetWorks Copilot — LLM edge function

Turns the rule-based Copilot into a real LLM assistant (Claude Opus 4.8) that
answers free-form questions about the signed-in owner's fleet. The Anthropic
API key lives **only** in Supabase (never in the public site); the browser POSTs
a compact fleet summary and gets back plain-English answers.

## Architecture
`js/copilot.js` → `POST <project>.supabase.co/functions/v1/copilot` → Claude.
If the function is unreachable or unset, the app silently falls back to the
built-in rule-based Copilot, so this is always an upgrade, never a dependency.

## Deploy (~5 min, one time)

Prereq: the [Supabase CLI](https://supabase.com/docs/guides/cli) and an
Anthropic API key (console.anthropic.com).

```bash
# from the repo root
supabase login
supabase link --project-ref crdblxeufbhysglbbtxi
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy copilot --no-verify-jwt
```

`--no-verify-jwt` lets demo/offline owners use it too — the function needs no DB
access or auth because the client sends the fleet summary. CORS is locked to
fleetworks.in + localhost inside `index.ts`.

The URL is already wired in `js/backend.js` (`FW_BACKEND.copilotUrl`). Test:

```bash
curl -X POST https://crdblxeufbhysglbbtxi.supabase.co/functions/v1/copilot \
  -H "content-type: application/json" \
  -d '{"question":"which vehicle is costliest?","fleet":{"vehicles":[{"name":"TN-01","type":"Truck (HCV)"}]}}'
```

Cost: ~₹0.5–2 per question at Opus 4.8 pricing. Switch `MODEL` in `index.ts` to
`claude-sonnet-5` to cut that ~5× if volume grows.
