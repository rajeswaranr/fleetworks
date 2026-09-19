/**
 * Footer Contact Information
 * Displays app contact details and links
 */

const FooterContact = {
  init() {
    this.createFooter();
  },

  createFooter() {
    const footer = document.createElement('footer');
    footer.id = 'app-footer';
    footer.style.cssText = `
      background: linear-gradient(135deg, #0f1e33 0%, #1e2a42 100%);
      color: white;
      padding: 30px 20px;
      margin-top: 60px;
      border-top: 1px solid rgba(0, 217, 255, 0.2);
      font-size: 0.95rem;
    `;

    footer.innerHTML = `
      <div style="max-width:1200px;margin:0 auto">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:30px;margin-bottom:30px">
          <!-- Company Info -->
          <div>
            <h3 style="margin:0 0 12px 0;color:#00d9ff;font-size:1.1rem">FleetWorks</h3>
            <p style="margin:0 0 8px 0;opacity:0.9;line-height:1.6">
              India's AI-powered fleet management platform for logistics, transportation, and dairy companies.
            </p>
            <p style="margin:0;opacity:0.7;font-size:0.9rem">© 2026 FleetWorks Private Limited</p>
          </div>

          <!-- Quick Links -->
          <div>
            <h4 style="margin:0 0 12px 0;color:#00d9ff;font-size:0.95rem">Platform</h4>
            <ul style="margin:0;padding:0;list-style:none">
              <li style="margin-bottom:8px"><a href="https://fleetworks.in" style="color:#f1f5f9;text-decoration:none" onmouseover="this.style.color='#00d9ff'" onmouseout="this.style.color='#f1f5f9'">Live Dashboard</a></li>
              <li style="margin-bottom:8px"><a href="https://fleetworks.in" style="color:#f1f5f9;text-decoration:none" onmouseover="this.style.color='#00d9ff'" onmouseout="this.style.color='#f1f5f9'">Start 15-Day Trial</a></li>
              <li><a href="javascript:void(0)" onclick="VirtualAssistant.init();VirtualAssistant.isOpen=true;document.getElementById('va-panel').style.display='flex'" style="color:#f1f5f9;text-decoration:none" onmouseover="this.style.color='#00d9ff'" onmouseout="this.style.color='#f1f5f9'">Virtual Assistant</a></li>
            </ul>
          </div>

          <!-- Support -->
          <div>
            <h4 style="margin:0 0 12px 0;color:#00d9ff;font-size:0.95rem">Support</h4>
            <ul style="margin:0;padding:0;list-style:none">
              <li style="margin-bottom:8px">📧 <a href="mailto:admin@fleetworks.in" style="color:#f1f5f9;text-decoration:none" onmouseover="this.style.color='#00d9ff'" onmouseout="this.style.color='#f1f5f9'">admin@fleetworks.in</a></li>
              <li style="margin-bottom:8px">📧 <a href="mailto:support@fleetworks.in" style="color:#f1f5f9;text-decoration:none" onmouseover="this.style.color='#00d9ff'" onmouseout="this.style.color='#f1f5f9'">support@fleetworks.in</a></li>
              <li style="margin-bottom:8px">📞 <a href="tel:+919444960009" style="color:#f1f5f9;text-decoration:none" onmouseover="this.style.color='#00d9ff'" onmouseout="this.style.color='#f1f5f9'">+91 94449 60009</a></li>
              <li>📱 Sales: <a href="tel:+919740799722" style="color:#f1f5f9;text-decoration:none" onmouseover="this.style.color='#00d9ff'" onmouseout="this.style.color='#f1f5f9'">+91 97407 99722</a></li>
            </ul>
          </div>

          <!-- Infrastructure -->
          <div>
            <h4 style="margin:0 0 12px 0;color:#00d9ff;font-size:0.95rem">Infrastructure</h4>
            <ul style="margin:0;padding:0;list-style:none">
              <li style="margin-bottom:8px">🏢 Data Center: Mumbai</li>
              <li style="margin-bottom:8px">☁️ Cloud: Supabase</li>
              <li>🔒 Encrypted & Secure</li>
            </ul>
          </div>
        </div>

        <!-- Bottom bar -->
        <div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:20px;text-align:center;opacity:0.8;font-size:0.85rem">
          <p style="margin:0">
            FleetWorks • 66+ Features • India's #1 AI Fleet Management •
            <a href="https://fleetworks.in" style="color:#00d9ff;text-decoration:none">Visit fleetworks.in</a>
          </p>
        </div>
      </div>
    `;

    document.body.appendChild(footer);
  }
};

// Initialize footer when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => FooterContact.init(), 500);
  });
} else {
  setTimeout(() => FooterContact.init(), 500);
}

window.FooterContact = FooterContact;
