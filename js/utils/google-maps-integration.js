/**
 * Google Maps Integration
 * Real-time vehicle GPS tracking and route visualization
 */

const GoogleMapsIntegration = {
  map: null,
  markers: {},
  infoWindows: {},
  polylines: {},

  // Initialize maps (call with your Google Maps API key)
  init(apiKey, containerId = 'gpsMapContainer') {
    // Load Google Maps script dynamically
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=marker`;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      this.createMap(containerId);
      this.startTracking();
      console.log('Google Maps initialized');
    };

    document.head.appendChild(script);
  },

  // Create map
  createMap(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`Map container ${containerId} not found`);
      return;
    }

    this.map = new google.maps.Map(container, {
      zoom: 10,
      center: { lat: 12.9716, lng: 77.5946 }, // Bangalore
      mapTypeId: 'roadmap',
      styles: [
        { featureType: 'all', elementType: 'labels.text.fill', stylers: [{ color: '#666' }] },
        { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#d9e8f0' }] }
      ]
    });
  },

  // Add vehicle marker
  addVehicleMarker(vehicleId, vehicleName, lat, lng, heading = 0, icon = '🚗') {
    if (!this.map) return;

    // Create marker
    const marker = new google.maps.Marker({
      position: { lat, lng },
      map: this.map,
      title: vehicleName,
      icon: this.createMarkerIcon(icon)
    });

    // Store marker
    this.markers[vehicleId] = marker;

    // Create info window
    const infoWindow = new google.maps.InfoWindow({
      content: `
        <div style="padding:8px;font-size:12px">
          <strong>${vehicleName}</strong><br>
          📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}<br>
          🧭 Heading: ${heading.toFixed(0)}°
        </div>
      `
    });

    this.infoWindows[vehicleId] = infoWindow;

    marker.addListener('click', () => {
      Object.values(this.infoWindows).forEach(iw => iw.close());
      infoWindow.open(this.map, marker);
    });
  },

  // Update vehicle position
  updateVehiclePosition(vehicleId, lat, lng, heading = 0) {
    if (!this.markers[vehicleId]) return;

    this.markers[vehicleId].setPosition({ lat, lng });

    // Update info window
    if (this.infoWindows[vehicleId]) {
      this.infoWindows[vehicleId].setContent(`
        <div style="padding:8px;font-size:12px">
          <strong>${this.markers[vehicleId].getTitle()}</strong><br>
          📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}<br>
          🧭 Heading: ${heading.toFixed(0)}°
        </div>
      `);
    }
  },

  // Draw route polyline
  drawRoute(vehicleId, coordinates, color = '#3b82f6') {
    if (!this.map) return;

    // Remove old polyline
    if (this.polylines[vehicleId]) {
      this.polylines[vehicleId].setMap(null);
    }

    const polyline = new google.maps.Polyline({
      path: coordinates,
      geodesic: true,
      strokeColor: color,
      strokeOpacity: 0.7,
      strokeWeight: 3,
      map: this.map
    });

    this.polylines[vehicleId] = polyline;
  },

  // Create custom marker icon
  createMarkerIcon(emoji) {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#0f1e33';
    ctx.beginPath();
    ctx.arc(16, 16, 14, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#00d9ff';
    ctx.font = '20px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 16, 16);

    return canvas.toDataURL();
  },

  // Center map on vehicle
  centerOnVehicle(vehicleId) {
    if (!this.markers[vehicleId] || !this.map) return;

    this.map.setCenter(this.markers[vehicleId].getPosition());
    this.map.setZoom(14);
  },

  // Start real-time tracking
  startTracking() {
    if (!window.VehicleSimulator) return;

    setInterval(() => {
      window.VehicleSimulator.getAllVehicles().forEach(vehicle => {
        const vehicleId = vehicle.vehicle.id;
        const { lat, lng } = vehicle.position;

        if (!this.markers[vehicleId]) {
          this.addVehicleMarker(vehicleId, vehicle.vehicle.name, lat, lng, vehicle.heading, '🚗');
        } else {
          this.updateVehiclePosition(vehicleId, lat, lng, vehicle.heading);
        }
      });
    }, 1000);
  },

  // Get directions
  async getDirections(origin, destination) {
    const service = new google.maps.DirectionsService();

    return new Promise((resolve, reject) => {
      service.route(
        {
          origin: origin,
          destination: destination,
          travelMode: google.maps.TravelMode.DRIVING
        },
        (result, status) => {
          if (status === 'OK') {
            resolve(result);
          } else {
            reject(status);
          }
        }
      );
    });
  },

  // Add geofence circle
  addGeofence(lat, lng, radiusMeters, name = 'Geofence') {
    if (!this.map) return;

    const circle = new google.maps.Circle({
      center: { lat, lng },
      radius: radiusMeters,
      strokeColor: '#FF0000',
      strokeOpacity: 0.8,
      strokeWeight: 2,
      fillColor: '#FF0000',
      fillOpacity: 0.1,
      map: this.map,
      title: name
    });

    return circle;
  },

  // Get distance between two points
  getDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }
};

window.GoogleMapsIntegration = GoogleMapsIntegration;
