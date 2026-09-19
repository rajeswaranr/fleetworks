/**
 * 15-Day Trial Signup Manager
 * Manages trial account creation and activation
 */

const TrialSignup = {
  async registerTrial(formData) {
    try {
      // Validate inputs
      if (!formData.email || !formData.password || !formData.fullName || !formData.companyName) {
        return { success: false, error: 'All fields are required' };
      }

      // Create user account
      const signupResult = await SupabaseAuth.signup(
        formData.email,
        formData.password,
        formData.fullName,
        formData.companyName
      );

      if (!signupResult.success) {
        return signupResult;
      }

      // Create trial record in database
      const { data: trial, error: trialError } = await window.supabase
        .from('trial_accounts')
        .insert([
          {
            email: formData.email,
            full_name: formData.fullName,
            company_name: formData.companyName,
            mobile: formData.mobile,
            gst_pan: formData.gstPan,
            fleet_size: parseInt(formData.fleetSize) || 0,
            trial_start_date: new Date().toISOString(),
            trial_end_date: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
            status: 'active',
            demo_data_enabled: true
          }
        ]);

      if (trialError) throw trialError;

      // Create organization for user
      const { data: org, error: orgError } = await window.supabase
        .from('organizations')
        .insert([
          {
            name: formData.companyName,
            admin_email: formData.email,
            trial_enabled: true,
            trial_ends_at: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString()
          }
        ])
        .select()
        .single();

      if (orgError) throw orgError;

      // Send welcome email
      await this.sendWelcomeEmail(formData.email, formData.fullName);

      // Send SMS
      await this.sendWelcomeSMS(formData.mobile, formData.fullName);

      return {
        success: true,
        message: `Welcome ${formData.fullName}! Your 15-day trial has started.`,
        orgId: org.id,
        data: { trial, org }
      };
    } catch (error) {
      console.error('Trial signup error:', error);
      return { success: false, error: error.message };
    }
  },

  async sendWelcomeEmail(email, fullName) {
    try {
      const { data, error } = await window.supabase
        .functions.invoke('send-email', {
          body: {
            to: email,
            subject: 'Welcome to FleetWorks - 15-Day Free Trial',
            template: 'welcome_trial',
            data: {
              name: fullName,
              trial_days: 15,
              features: '70+ fleet management features',
              support: 'admin@fleetworks.in'
            }
          }
        });

      if (error) throw error;
      console.log('Welcome email sent to', email);
    } catch (error) {
      console.error('Email send error:', error);
    }
  },

  async sendWelcomeSMS(mobile, fullName) {
    try {
      // Normalize phone number
      const phone = mobile.replace(/\D/g, '');
      const phoneNumber = phone.startsWith('91') ? phone : '91' + phone;

      const { data, error } = await window.supabase
        .functions.invoke('send-sms', {
          body: {
            phone_number: phoneNumber,
            template: 'trial_welcome',
            variables: {
              name: fullName,
              trial_days: '15',
              link: 'https://fleetworks.in'
            }
          }
        });

      if (error) throw error;
      console.log('Welcome SMS sent to', mobile);
    } catch (error) {
      console.error('SMS send error:', error);
    }
  },

  // Check trial status
  async checkTrialStatus(email) {
    try {
      const { data: trial, error } = await window.supabase
        .from('trial_accounts')
        .select('*')
        .eq('email', email)
        .single();

      if (error) return { active: false };

      const now = new Date();
      const endDate = new Date(trial.trial_end_date);
      const daysRemaining = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));

      return {
        active: daysRemaining > 0,
        daysRemaining,
        trial
      };
    } catch (error) {
      return { active: false, error: error.message };
    }
  },

  // Get trial stats
  async getTrialStats(orgId) {
    try {
      // Vehicles
      const { count: vehicleCount } = await window.supabase
        .from('vehicles')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId);

      // Fuel entries
      const { count: tripCount } = await window.supabase
        .from('fuel_entries')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId);

      // Users
      const { count: userCount } = await window.supabase
        .from('team_members')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId);

      return {
        vehicles: vehicleCount || 0,
        trips: tripCount || 0,
        users: userCount || 0
      };
    } catch (error) {
      console.error('Stats error:', error);
      return { vehicles: 0, trips: 0, users: 0 };
    }
  }
};

window.TrialSignup = TrialSignup;
