# Auth Email Delivery Mitigation

Prepared on: 2026-08-15

## Problem

FleetWorks currently uses Supabase Auth for email/password login, signup, and password reset.

The painful failure point is email delivery:

- Signup confirmation emails may not arrive.
- Password reset emails may not arrive.
- Supabase default auth email delivery has low limits and is not intended as the production delivery path.
- Redirect URLs and email template/link scanning can also break recovery links.

## Immediate Code-Side Mitigations Added

### 1. Friendlier Auth Errors

Frontend auth errors now map common Supabase email failures into actionable messages:

```text
Email address not authorized
Rate limit / too many requests
SMTP / mail send failures
Email not confirmed
```

Updated files:

```text
js/modules/auth/domain/auth.domain.js
js/modules/auth/adapters/supabase-auth.repository.js
js/cloudstore.js
js/auth-reset.js
```

### 2. Optional Server-Side Owner Signup

A new Edge Function can create owner accounts without depending on Supabase confirmation emails:

```text
supabase/functions/owner-signup/index.ts
```

It uses the Supabase service-role key inside the Edge Function to:

```text
create confirmed auth user
create organization
create owner membership
```

The browser never receives the service-role key.

### 3. Local CORS Fixes

The existing team invite Edge Function now allows common local dev ports:

```text
http://localhost:8080
http://localhost:8090
http://localhost:8642
```

Updated file:

```text
supabase/functions/team-invite/index.ts
```

## Deploy Owner Signup Function

Deploy:

```bash
supabase functions deploy owner-signup --no-verify-jwt
```

Then update:

```text
js/backend.js
```

Set:

```js
ownerSignupUrl: "https://<project-ref>.supabase.co/functions/v1/owner-signup"
```

After this is configured, owner signup flow becomes:

```text
fleet.html signup
  -> owner-signup Edge Function
      -> admin.createUser(email_confirm: true)
      -> organizations insert
      -> memberships insert role owner
  -> browser logs in with email/password
```

This bypasses the Supabase confirmation email dependency for owner signup.

## Still Required In Supabase Dashboard

For password reset emails, the fastest production fix is still:

```text
Supabase Dashboard
  -> Authentication
  -> Emails / SMTP Settings
  -> configure custom SMTP
```

Use a transactional provider such as:

```text
Resend
AWS SES
Postmark
SendGrid
ZeptoMail
Brevo
```

Also configure:

```text
SPF
DKIM
DMARC
Auth redirect URLs
Auth email templates
```

## Recommended Next Server-Side Reset Flow

The next deeper fix is to stop depending on Supabase recovery emails for forgot-password:

```text
auth-reset-request
  -> generate one-time token/OTP
  -> save token hash
  -> send via chosen provider

auth-reset-confirm
  -> verify token/OTP
  -> admin.updateUserById(user_id, { password })
  -> mark token used
```

This requires a new table:

```text
password_reset_requests
```

Suggested fields:

```text
id
user_id
email
token_hash
expires_at
used_at
attempt_count
created_at
created_ip
```

## Security Rules

- Never place `SUPABASE_SERVICE_ROLE_KEY` in browser JavaScript.
- Do not allow `email + new password` reset without proving ownership through a secure token/OTP.
- Always return generic reset-request responses so attackers cannot discover which emails exist.
- Rate-limit reset requests.
- Store reset token hashes, not raw tokens.
- Expire reset tokens quickly.
