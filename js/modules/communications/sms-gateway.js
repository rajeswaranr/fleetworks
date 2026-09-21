/**
 * SMS Gateway - MSG91 Integration
 * Sends transactional SMS via MSG91 (Indian SMS provider)
 * Uses pre-approved DLT templates for alerts and notifications
 */

class SMSGateway {
  constructor() {
    this.provider = 'MSG91';
  }

  async init() {
    console.log('SMS Gateway initialized with MSG91');
  }

  async sendSMS(phoneNumber, message, templateEvent = 'sos') {
    try {
      const payload = {
        event: templateEvent,
        recipients: [
          {
            mobile: this.formatPhone(phoneNumber),
            var1: message.substring(0, 100)
          }
        ]
      };

      // Call Edge Function to send SMS via MSG91
      const response = await fetch(
        `${window.SUPABASE_URL}/functions/v1/send-sms`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${(window.fwCloud && await fwCloud.accessToken()) || window.SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        }
      );

      const data = await response.json();

      if (data.ok) {
        await this.logSMS(phoneNumber, message, 'sent', templateEvent);
        return { success: true, messageId: data.msg91?.request_id };
      } else {
        await this.logSMS(phoneNumber, message, 'failed', data.error);
        return { success: false, error: data.error };
      }
    } catch (error) {
      console.error('SMS send error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendBulkSMS(phoneNumbers, message, templateEvent = 'sos') {
    try {
      const recipients = phoneNumbers.map(phone => ({
        mobile: this.formatPhone(phone),
        var1: message.substring(0, 100)
      }));

      const payload = {
        event: templateEvent,
        recipients: recipients
      };

      const response = await fetch(
        `${window.SUPABASE_URL}/functions/v1/send-sms`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${(window.fwCloud && await fwCloud.accessToken()) || window.SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        }
      );

      const data = await response.json();
      return { success: data.ok, sent: data.sent, error: data.error };
    } catch (error) {
      console.error('Bulk SMS error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendAlertSMS(vehicleId, eventType, severity) {
    const { data: vehicle } = await window.supabase
      .from('vehicles')
      .select('registration, driver_phone')
      .eq('id', vehicleId)
      .single();

    if (!vehicle?.driver_phone) return;

    const messages = {
      harsh_brake: `⚠️ Harsh braking on ${vehicle.registration}. Drive safely!`,
      collision: `🚨 COLLISION ALERT on ${vehicle.registration}. Check immediately.`,
      speeding: `⚡ Speeding detected (${vehicle.registration}). Reduce speed.`,
      harsh_turn: `⚠️ Harsh turn on ${vehicle.registration}. Drive carefully.`,
      harsh_acceleration: `⚠️ Harsh acceleration on ${vehicle.registration}. Drive smoothly.`
    };

    const message = messages[eventType] || `Alert on ${vehicle.registration}`;

    if (severity === 'critical') {
      // Send to driver
      await this.sendSMS(vehicle.driver_phone, message, 'sos');

      // Also notify supervisor
      const { data: supervisor } = await window.supabase
        .from('team_members')
        .select('phone')
        .eq('role', 'supervisor')
        .eq('org_id', window.supabaseUser.org_id)
        .limit(1)
        .single();

      if (supervisor?.phone) {
        await this.sendSMS(supervisor.phone, `CRITICAL: ${message}`, 'sos');
      }
    } else {
      await this.sendSMS(vehicle.driver_phone, message, 'halt');
    }
  }

  formatPhone(phone) {
    // Remove non-digits
    let cleaned = phone.replace(/\D/g, '');

    // Add 91 for India if 10 digits
    if (cleaned.length === 10) {
      cleaned = '91' + cleaned;
    }

    return cleaned;
  }

  async logSMS(phone, message, status, templateEvent) {
    try {
      await window.supabase
        .from('sms_logs')
        .insert({
          org_id: window.supabaseUser?.org_id,
          phone_number: phone,
          message: message,
          status: status,
          template_event: templateEvent,
          provider: 'MSG91',
          sent_at: new Date().toISOString()
        });
    } catch (error) {
      console.error('Failed to log SMS:', error);
    }
  }
}

// Global instance
window.smsGateway = new SMSGateway();

// Auto-init on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => window.smsGateway.init(), 500);
  });
} else {
  setTimeout(() => window.smsGateway.init(), 500);
}
