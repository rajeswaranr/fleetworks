/**
 * Vehicle Simulator - Real-time demo data generation
 * Simulates GPS, fuel consumption, tire pressure, and video feeds
 */

const VehicleSimulator = {
  vehicles: [
    { id: 1, name: 'MH-04-AB-1234', driver: 'Rajesh Kumar', route: 'Bangalore - Mumbai', color: '#FF6B6B' },
    { id: 2, name: 'KA-05-CD-5678', driver: 'Amit Singh', route: 'Delhi - Jaipur', color: '#4ECDC4' },
    { id: 3, name: 'TG-07-EF-9012', driver: 'Suresh Patel', route: 'Hyderabad - Chennai', color: '#45B7D1' }
  ],

  simulationData: {},
  mapMarkers: [],

  init() {
    this.initializeVehicles();
    this.startSimulation();
    console.log('Vehicle Simulator initialized');
  },

  initializeVehicles() {
    const startCoords = [
      { lat: 12.9716, lng: 77.5946 }, // Bangalore
      { lat: 28.7041, lng: 77.1025 }, // Delhi
      { lat: 17.3850, lng: 78.4867 }  // Hyderabad
    ];

    this.vehicles.forEach((vehicle, index) => {
      this.simulationData[vehicle.id] = {
        vehicle: vehicle,
        position: { ...startCoords[index] },
        heading: Math.random() * 360,
        speed: 60 + Math.random() * 40, // 60-100 km/h
        fuel: 50 + Math.random() * 50, // 50-100%
        distance: Math.random() * 500,
        engine_temp: 85 + Math.random() * 15,
        rpm: 2000 + Math.random() * 2000,
        tires: {
          FL: { pressure: 32 + Math.random() * 6, temp: 65 + Math.random() * 20 },
          FR: { pressure: 32 + Math.random() * 6, temp: 65 + Math.random() * 20 },
          RL: { pressure: 36 + Math.random() * 6, temp: 70 + Math.random() * 20 },
          RR: { pressure: 36 + Math.random() * 6, temp: 70 + Math.random() * 20 }
        },
        alerts: [],
        status: 'Active'
      };
    });
  },

  startSimulation() {
    setInterval(() => this.updateSimulationData(), 1000);
  },

  updateSimulationData() {
    Object.keys(this.simulationData).forEach(vehicleId => {
      const data = this.simulationData[vehicleId];

      // Update position (simulate movement on map)
      data.position.lat += (Math.random() - 0.5) * 0.001;
      data.position.lng += (Math.random() - 0.5) * 0.001;

      // Update heading
      data.heading = (data.heading + (Math.random() - 0.5) * 10) % 360;

      // Update speed (with variation)
      data.speed = Math.max(0, Math.min(120, data.speed + (Math.random() - 0.5) * 5));

      // Update fuel (consumption: ~0.5L per 100km at 80km/h)
      data.fuel = Math.max(0, data.fuel - (data.speed / 80) * 0.008);

      // Update distance
      data.distance += data.speed / 3600; // Convert km/h to km/s

      // Update engine temp
      data.engine_temp = Math.max(75, Math.min(105, data.engine_temp + (Math.random() - 0.5) * 2));

      // Update RPM
      data.rpm = Math.max(800, Math.min(5000, data.rpm + (Math.random() - 0.5) * 100));

      // Update tire pressures (with realistic drift)
      Object.keys(data.tires).forEach(tire => {
        data.tires[tire].pressure = Math.max(28, Math.min(42,
          data.tires[tire].pressure + (Math.random() - 0.5) * 0.5
        ));
        data.tires[tire].temp = Math.max(50, Math.min(100,
          data.tires[tire].temp + (Math.random() - 0.5) * 2
        ));
      });

      // Generate alerts
      this.checkAlerts(data);
    });
  },

  checkAlerts(data) {
    data.alerts = [];

    // Fuel low alert
    if (data.fuel < 20) {
      data.alerts.push({ type: 'fuel', message: `Low fuel: ${data.fuel.toFixed(1)}%`, severity: 'critical' });
    }

    // Tire pressure alerts
    Object.entries(data.tires).forEach(([tire, reading]) => {
      if (reading.pressure < 30) {
        data.alerts.push({ type: 'tire', message: `${tire} low pressure: ${reading.pressure.toFixed(1)} PSI`, severity: 'warning' });
      } else if (reading.pressure > 40) {
        data.alerts.push({ type: 'tire', message: `${tire} high pressure: ${reading.pressure.toFixed(1)} PSI`, severity: 'info' });
      }
      if (reading.temp > 90) {
        data.alerts.push({ type: 'tire_temp', message: `${tire} high temp: ${reading.temp.toFixed(0)}°C`, severity: 'warning' });
      }
    });

    // Engine temp alert
    if (data.engine_temp > 100) {
      data.alerts.push({ type: 'engine', message: `High engine temp: ${data.engine_temp.toFixed(1)}°C`, severity: 'critical' });
    }

    // Speeding alert
    if (data.speed > 100) {
      data.alerts.push({ type: 'speed', message: `Speeding: ${data.speed.toFixed(0)} km/h`, severity: 'warning' });
    }
  },

  getVehicleData(vehicleId) {
    return this.simulationData[vehicleId];
  },

  getAllVehicles() {
    return Object.values(this.simulationData);
  },

  getGPSCoordinates(vehicleId) {
    const data = this.simulationData[vehicleId];
    return data ? data.position : null;
  }
};

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => VehicleSimulator.init(), 100);
  });
} else {
  setTimeout(() => VehicleSimulator.init(), 100);
}

window.VehicleSimulator = VehicleSimulator;
