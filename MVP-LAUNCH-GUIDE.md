# FleetWorks MVP Launch Guide (2-3 Days)

## 🎯 Goal
Launch production-ready MVP with 70+ features, authentication, GPS tracking, and 15-day trials.

---

## **DAY 1: Setup & Authentication**

### ✅ Supabase Configuration
```bash
# 1. Enable Email Auth in Supabase
   - Go to: Authentication → Providers → Email
   - Enable Confirm email
   - Set JWT expiration: 3600s

# 2. Configure Email Templates
   - Confirmation email
   - Reset password email
   - Welcome email

# 3. Create trial_accounts table
CREATE TABLE trial_accounts (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE,
  full_name TEXT,
  company_name TEXT,
  mobile TEXT,
  gst_pan TEXT,
  fleet_size INTEGER,
  trial_start_date TIMESTAMP,
  trial_end_date TIMESTAMP,
  status TEXT,
  demo_data_enabled BOOLEAN,
  created_at TIMESTAMP DEFAULT now()
);

# 4. Create organizations table (if not exists)
ALTER TABLE organizations ADD COLUMN trial_enabled BOOLEAN DEFAULT true;
ALTER TABLE organizations ADD COLUMN trial_ends_at TIMESTAMP;
```

### ✅ API Keys Required
- [ ] Supabase URL & API Key
- [ ] Google Maps API Key
- [ ] MSG91 API Key (already configured)
- [ ] SendGrid/AWS SES for emails

---

## **DAY 2: Google Maps & SMS Testing**

### ✅ Google Maps Setup
```javascript
// In fleet.html, initialize maps on page load:
GoogleMapsIntegration.init('YOUR_GOOGLE_MAPS_API_KEY', 'gpsMapContainer');

// Test with:
const mapContainer = document.getElementById('gpsMapContainer');
if (mapContainer) {
  GoogleMapsIntegration.init('YOUR_API_KEY');
}
```

### ✅ SMS Testing (MSG91)
```bash
# Test SMS function
curl -X POST https://YOUR_SUPABASE_URL/functions/v1/send-sms \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "phone_number": "919876543210",
    "template": "trial_welcome",
    "variables": {"name": "Test", "trial_days": "15"}
  }'

# Expected response: { "success": true, "message_id": "..." }
```

### ✅ Email Testing
```bash
# Test email function
curl -X POST https://YOUR_SUPABASE_URL/functions/v1/send-email \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "test@example.com",
    "subject": "Welcome to FleetWorks",
    "template": "welcome_trial",
    "data": {"name": "Test User"}
  }'
```

---

## **DAY 3: Deployment & Go-Live**

### ✅ Environment Variables
```env
# .env.local (DO NOT COMMIT)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_GOOGLE_MAPS_API_KEY=your-maps-key
VITE_MSG91_API_KEY=your-msg91-key
VITE_APP_URL=https://fleetworks.in
```

### ✅ Deploy to GitHub Pages
```bash
# 1. Build the project
npm run build

# 2. Deploy to GitHub Pages
git add dist/
git commit -m "Deploy MVP to production"
git push origin main

# 3. Enable GitHub Pages in repo settings
   - Source: gh-pages branch
   - Custom domain: fleetworks.in (if configured)
```

### ✅ Custom Domain Setup (fleetworks.in)
```bash
# 1. Update GoDaddy DNS (already configured, verify):
   A Record: 185.199.108.153 → fleetworks.in
   A Record: 185.199.109.153 → fleetworks.in
   A Record: 185.199.110.153 → fleetworks.in
   A Record: 185.199.111.153 → fleetworks.in

# 2. Create CNAME in repo:
   echo "fleetworks.in" > CNAME
   git add CNAME
   git commit -m "Configure custom domain"
   git push
```

---

## **✅ Pre-Launch Checklist**

### Authentication
- [ ] Supabase Auth enabled
- [ ] Email templates configured
- [ ] Password reset working
- [ ] Sign-up form functional
- [ ] Login redirects to dashboard

### GPS & Mapping
- [ ] Google Maps API key added
- [ ] Map loads on dashboard
- [ ] Vehicle markers show
- [ ] Real-time tracking works
- [ ] Zoom/pan functional

### SMS & Emails
- [ ] MSG91 SMS sends successfully
- [ ] Welcome SMS received
- [ ] Trial signup email sent
- [ ] 15-day timer working
- [ ] End-of-trial warning email

### Trial System
- [ ] Trial account creation works
- [ ] Demo data auto-populated
- [ ] 15-day countdown shows
- [ ] Trial expiry notifications send
- [ ] Data accessible during trial

### Platform Features
- [ ] All 70+ features accessible
- [ ] Export system working (CSV, Excel, PDF)
- [ ] Virtual Assistant chatbot live
- [ ] Demo dashboard shows live data
- [ ] Real-time vehicle simulator runs

---

## **🚀 Launch Steps**

### Step 1: Verify Supabase
```bash
# Test API connection
curl https://YOUR_SUPABASE_URL/rest/v1/trial_accounts \
  -H "apikey: YOUR_ANON_KEY" | jq

# Should return: { "count": 0, "data": [] }
```

### Step 2: Deploy Code
```bash
git add -A
git commit -m "MVP Launch: Auth, Maps, SMS, Trials ready"
git push origin main
```

### Step 3: Test End-to-End
```bash
# 1. Open https://fleetworks.in
# 2. Sign up with test account
# 3. Verify welcome email received
# 4. Verify welcome SMS received
# 5. Login with credentials
# 6. Check GPS map displays vehicles
# 7. Verify 15-day trial counter shows
# 8. Test export functionality
# 9. Ask Virtual Assistant a question
# 10. View demo dashboard
```

### Step 4: Monitor
```bash
# Monitor Supabase logs
- Check Auth Logs for sign-up success
- Check Function Logs for SMS/Email
- Check Database for new trial accounts
```

---

## **📊 Success Metrics (Day 1-7)**

| Metric | Target | Actual |
|--------|--------|--------|
| Sign-ups | 10+ | _ |
| SMS Delivery Rate | 99%+ | _ |
| Email Delivery | 95%+ | _ |
| App Uptime | 99.9%+ | _ |
| Map Load Time | <2s | _ |
| Trial Activation | 80%+ | _ |

---

## **🆘 Troubleshooting**

### Email not sending
```
Check: 1. SendGrid/SES configured in Supabase
       2. Email template exists
       3. Function has correct domain
```

### SMS not arriving
```
Check: 1. MSG91 API key correct
       2. Phone number format: 91 + 10 digits
       3. DLT template approved
       4. Account has SMS balance
```

### Maps not loading
```
Check: 1. Google Maps API key valid
       2. API key has Maps JavaScript API enabled
       3. No georestriction on key
       4. Container div exists: id="gpsMapContainer"
```

### Trial not created
```
Check: 1. trial_accounts table exists
       2. Org created after user signup
       3. RLS policies allow inserts
       4. No constraint violations
```

---

## **📱 Post-Launch (Week 2)**

- [ ] Gather user feedback
- [ ] Monitor error logs
- [ ] Fix critical bugs (24hr SLA)
- [ ] Optimize performance
- [ ] Plan Feature Phase 2
  - Payment integration
  - Android APK
  - Advanced analytics

---

## **🎉 Launch Commands**

```bash
# Final launch sequence
git checkout main
git pull origin main
npm install
npm run build
git add dist/ CNAME
git commit -m "🚀 MVP Launch: FleetWorks Live"
git push origin main

# Verify deployment
curl -s https://fleetworks.in | grep "<title>" 
# Should show: FleetWorks Fleet Manager
```

---

**Estimated Timeline: 48-72 hours**
**Go-Live Target: This Week**
**Support Email: admin@fleetworks.in**
