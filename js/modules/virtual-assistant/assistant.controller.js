/**
 * Virtual Assistant - AI-powered Feature Guide
 * Context-aware help system for FleetWorks users
 */

const VirtualAssistant = {
  isOpen: false,
  currentContext: null,

  // Feature knowledge base
  features: {
    'live-video': {
      title: 'Live Video Dashboard',
      description: 'Real-time dashcam and 360° camera feeds for vehicle monitoring',
      details: 'Stream live dashcam and 360° camera feeds with HLS protocol. Latency: 3-5 seconds. GPS-synchronized playback for trip analysis.',
      tips: ['Use for accident investigations', 'Monitor high-risk routes', 'Train drivers based on video evidence']
    },
    'fuel-dashboard': {
      title: 'Fuel Dashboard',
      description: 'Track fuel consumption and identify efficiency issues',
      details: 'Monitor fleet-wide fuel consumption with 14-day trends. Identify top consumption factors and optimize efficiency.',
      tips: ['Set baseline efficiency per vehicle', 'Compare similar routes', 'Track seasonal variations']
    },
    'trip-management': {
      title: 'Trip Management',
      description: 'Monitor active trips with real-time progress and ETA',
      details: 'Track actual vs planned distance, monitor fuel consumption, check tire health, and manage trip expenses.',
      tips: ['Pre-trip vehicle health check essential', 'Monitor ETA changes in real-time', 'Track expenses per trip']
    },
    'tpms-safety': {
      title: 'TPMS Safety Monitoring',
      description: 'Real-time tire pressure monitoring with AI failure predictions',
      details: 'Monitor tire pressure, temperature, and wear. AI predicts failure 7 days in advance (0-100% risk). Critical alerts for >80% risk.',
      tips: ['Replace tires before AI recommends', 'Monitor temperature spikes', 'Check pressure compliance daily']
    },
    'cold-chain': {
      title: 'Cold Chain Management',
      description: 'Temperature monitoring for refrigerated cargo',
      details: 'Track cabin and cargo temperature for 6 product types. FSSAI compliance. Estimate cargo loss from violations.',
      tips: ['Minimize door opens', 'Pre-trip temp verification', 'Monitor compliance daily', 'Respond to violations <15min']
    },
    'fuel-pilferage': {
      title: 'Fuel Pilferage Detection',
      description: 'AI detects unusual fuel consumption patterns',
      details: 'Anomaly detection with 25% variance threshold. Confidence scoring. Estimates loss in liters and rupees.',
      tips: ['Check anomalies daily', 'Review trip context', 'Set baseline per vehicle', 'Cross-check with fuel cards']
    },
    'driver-settlement': {
      title: 'Driver Settlement Module',
      description: 'Automated driver payment calculations',
      details: 'Base pay + Distance (₹1.5/km) + Dearness (₹2/km) + Halt (₹100/halt). Automatic deductions for violations.',
      tips: ['Review before payment', 'Explain deductions clearly', 'Use for performance incentives']
    },
    'gst-compliance': {
      title: 'GST Compliance Suite',
      description: 'Automated tax compliance and e-way bills',
      details: 'Auto-generate GST invoices from trips. E-way bill via SBIN API. GSTR-1 filing ready. 100% audit trail.',
      tips: ['Verify trip details before invoicing', 'Check GSTIN configuration', 'File GSTR-1 monthly']
    },
    'tire-tracker': {
      title: 'RFID Tire Tracking',
      description: 'RFID-based tire lifecycle management',
      details: 'Impinj Monza Gen2+ tags (915 MHz). Track pressure, temperature, wear, and maintenance history.',
      tips: ['Register tires on purchase', 'Monitor pressure compliance', 'Plan rotations proactively']
    },
    'fleet-card': {
      title: 'Fleet Card Integration',
      description: 'Unified tracking of fuel card transactions',
      details: 'Support for HPCL, BPCL, IOCL, JIOBP. Rate and liter analysis. Usage statistics per card.',
      tips: ['Match with fuel readings', 'Monitor rate changes', 'Reconcile weekly']
    }
  },

  // Initialize assistant
  init() {
    this.createUI();
    this.attachListeners();
    console.log('Virtual Assistant initialized');
  },

  // Create chat UI
  createUI() {
    const container = document.createElement('div');
    container.id = 'va-container';
    container.innerHTML = `
      <div id="va-button" style="
        position: fixed;
        bottom: 30px;
        right: 30px;
        width: 60px;
        height: 60px;
        background: linear-gradient(135deg, #0f1e33 0%, #00d9ff 100%);
        border: none;
        border-radius: 50%;
        cursor: pointer;
        z-index: 999;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.8rem;
        box-shadow: 0 4px 12px rgba(0, 217, 255, 0.3);
        transition: all 0.3s;
      ">
        🤖
      </div>

      <div id="va-panel" style="
        position: fixed;
        bottom: 100px;
        right: 30px;
        width: 380px;
        max-height: 600px;
        background: white;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
        display: none;
        flex-direction: column;
        z-index: 999;
        overflow: hidden;
      ">
        <div style="
          background: linear-gradient(135deg, #0f1e33 0%, #00d9ff 100%);
          color: white;
          padding: 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        ">
          <div>
            <h3 style="margin:0;font-size:1.1rem">FleetWorks Assistant</h3>
            <p style="margin:4px 0 0;font-size:0.85rem;opacity:0.9">AI-powered feature guide</p>
          </div>
          <button id="va-close" style="
            background: none;
            border: none;
            color: white;
            cursor: pointer;
            font-size: 1.2rem;
          ">✕</button>
        </div>

        <div id="va-content" style="
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          font-size: 0.95rem;
        ">
          <div id="va-welcome" style="text-align:center;padding:20px 0">
            <div style="font-size:2rem;margin-bottom:12px">👋</div>
            <h4>Welcome to Virtual Assistant</h4>
            <p style="color:#64748b;font-size:0.9rem">Ask me about any FleetWorks feature or choose from below:</p>
            <div id="va-suggestions" style="margin-top:16px"></div>
          </div>
          <div id="va-messages" style="display:none"></div>
        </div>

        <div style="
          border-top: 1px solid #e2e8f0;
          padding: 12px;
          display: flex;
          gap: 8px;
        ">
          <input id="va-input" type="text" placeholder="Ask about a feature..." style="
            flex: 1;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 8px 12px;
            font-size: 0.9rem;
            font-family: 'Poppins', sans-serif;
          ">
          <button id="va-send" style="
            background: #0f1e33;
            color: white;
            border: none;
            border-radius: 6px;
            padding: 8px 16px;
            cursor: pointer;
            font-weight: 600;
          ">Send</button>
        </div>
      </div>
    `;

    document.body.appendChild(container);

    // Load suggestions
    this.loadSuggestions();
  },

  // Load quick suggestions
  loadSuggestions() {
    const suggestions = document.getElementById('va-suggestions');
    const featureKeys = Object.keys(this.features).slice(0, 6);

    featureKeys.forEach(key => {
      const btn = document.createElement('button');
      btn.textContent = this.features[key].title;
      btn.style.cssText = `
        display: block;
        width: 100%;
        padding: 8px 12px;
        margin: 6px 0;
        background: #f1f5f9;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        cursor: pointer;
        text-align: left;
        font-size: 0.9rem;
        transition: all 0.2s;
      `;
      btn.onmouseover = () => btn.style.background = '#e2e8f0';
      btn.onmouseout = () => btn.style.background = '#f1f5f9';
      btn.onclick = () => this.askAboutFeature(key);
      suggestions.appendChild(btn);
    });
  },

  // Ask about a feature
  askAboutFeature(featureKey) {
    const feature = this.features[featureKey];
    if (!feature) return;

    this.showMessages();
    this.addUserMessage(`Tell me about ${feature.title}`);
    this.addAssistantMessage(feature);
  },

  // Show messages area
  showMessages() {
    document.getElementById('va-welcome').style.display = 'none';
    document.getElementById('va-messages').style.display = 'block';
  },

  // Add user message
  addUserMessage(text) {
    const messages = document.getElementById('va-messages');
    const msg = document.createElement('div');
    msg.style.cssText = `
      margin-bottom: 12px;
      text-align: right;
    `;
    msg.innerHTML = `
      <div style="
        display: inline-block;
        background: #0f1e33;
        color: white;
        padding: 10px 14px;
        border-radius: 12px;
        max-width: 80%;
        word-wrap: break-word;
      ">${text}</div>
    `;
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
  },

  // Add assistant message
  addAssistantMessage(feature) {
    const messages = document.getElementById('va-messages');
    const msg = document.createElement('div');
    msg.style.cssText = `
      margin-bottom: 12px;
      text-align: left;
    `;
    msg.innerHTML = `
      <div style="
        display: inline-block;
        background: #f1f5f9;
        color: #1e293b;
        padding: 12px 14px;
        border-radius: 12px;
        max-width: 80%;
        word-wrap: break-word;
      ">
        <strong style="color:#0f1e33">${feature.title}</strong><br>
        <p style="margin:8px 0 0">${feature.details}</p>
        ${feature.tips ? `
          <div style="margin-top:8px;padding-top:8px;border-top:1px solid #cbd5e1">
            <strong style="font-size:0.9rem;color:#00d9ff">💡 Tips:</strong>
            <ul style="margin:4px 0;padding-left:20px;font-size:0.9rem">
              ${feature.tips.map(tip => `<li>${tip}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    `;
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
  },

  // Handle send message
  sendMessage() {
    const input = document.getElementById('va-input');
    const text = input.value.trim().toLowerCase();

    if (!text) return;

    this.showMessages();
    this.addUserMessage(text);
    input.value = '';

    // Find matching feature
    let matched = false;
    for (const [key, feature] of Object.entries(this.features)) {
      if (text.includes(key.replace('-', ' ')) ||
          feature.title.toLowerCase().includes(text) ||
          text.includes(feature.title.toLowerCase())) {
        this.addAssistantMessage(feature);
        matched = true;
        break;
      }
    }

    if (!matched) {
      this.addAssistantMessage({
        title: '🤔 Not Sure',
        details: `I didn't find information about "${text}". Try asking about:<br>
          • Fuel Dashboard • Trip Management • TPMS Safety<br>
          • Cold Chain • Driver Settlement • GST Compliance<br>
          • Fuel Pilferage • Tire Tracking • Fleet Card Integration`,
        tips: []
      });
    }
  },

  // Attach event listeners
  attachListeners() {
    const button = document.getElementById('va-button');
    const panel = document.getElementById('va-panel');
    const closeBtn = document.getElementById('va-close');
    const sendBtn = document.getElementById('va-send');
    const input = document.getElementById('va-input');

    button.onclick = () => {
      this.isOpen = !this.isOpen;
      panel.style.display = this.isOpen ? 'flex' : 'none';
      button.style.transform = this.isOpen ? 'scale(1.1)' : 'scale(1)';
    };

    closeBtn.onclick = () => {
      this.isOpen = false;
      panel.style.display = 'none';
      button.style.transform = 'scale(1)';
    };

    sendBtn.onclick = () => this.sendMessage();
    input.onkeypress = (e) => {
      if (e.key === 'Enter') this.sendMessage();
    };
  }
};

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(() => VirtualAssistant.init(), 100));
} else {
  setTimeout(() => VirtualAssistant.init(), 100);
}

// Make globally available
window.VirtualAssistant = VirtualAssistant;
