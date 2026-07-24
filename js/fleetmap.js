/* ============ FleetWorks — fleetmap.js ============
   Fleet Map tab: vehicles grouped and pinned by their Base Depot / City
   field on a real Leaflet + OpenStreetMap map — both free, no API key.
   Not live GPS tracking (that needs an actual telematics/GPS device feed
   per vehicle, a separate hardware integration) — this is a "where are my
   depots" view built from data the app already has. City name -> lat/lng
   is a static lookup (no geocoding API call), so it only recognises the
   city names in CITY_COORDS below; anything else is listed as unmatched
   so the owner knows to fix the spelling or that it's not covered yet. */

"use strict";

let leafletLoading = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (!leafletLoading) leafletLoading = new Promise((res, rej) => {
    if (!document.getElementById("leafletCss")) {
      const link = document.createElement("link");
      link.id = "leafletCss"; link.rel = "stylesheet";
      link.href = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js";
    s.onload = res;
    s.onerror = () => { leafletLoading = null; rej(new Error("Could not load the map — check your internet connection and try again.")); };
    document.head.appendChild(s);
  });
  return leafletLoading;
}

// Major Indian cities/towns, [lat, lng]. Approximate (city-centre level) —
// good enough for a depot marker on a zoomed-out national map, not for
// street-level accuracy. Common older/alternate names point at the same
// coordinates as their current name.
const CITY_COORDS = {
  "delhi": [28.6139, 77.2090], "new delhi": [28.6139, 77.2090],
  "mumbai": [19.0760, 72.8777], "bombay": [19.0760, 72.8777],
  "bengaluru": [12.9716, 77.5946], "bangalore": [12.9716, 77.5946],
  "chennai": [13.0827, 80.2707], "madras": [13.0827, 80.2707],
  "kolkata": [22.5726, 88.3639], "calcutta": [22.5726, 88.3639],
  "hyderabad": [17.3850, 78.4867], "pune": [18.5204, 73.8567],
  "ahmedabad": [23.0225, 72.5714], "surat": [21.1702, 72.8311],
  "jaipur": [26.9124, 75.7873], "lucknow": [26.8467, 80.9462],
  "kanpur": [26.4499, 80.3319], "nagpur": [21.1458, 79.0882],
  "indore": [22.7196, 75.8577], "thane": [19.2183, 72.9781],
  "bhopal": [23.2599, 77.4126], "visakhapatnam": [17.6868, 83.2185], "vizag": [17.6868, 83.2185],
  "pimpri-chinchwad": [18.6298, 73.7997], "patna": [25.5941, 85.1376],
  "vadodara": [22.3072, 73.1812], "baroda": [22.3072, 73.1812],
  "ghaziabad": [28.6692, 77.4538], "ludhiana": [30.9010, 75.8573],
  "agra": [27.1767, 78.0081], "nashik": [19.9975, 73.7898],
  "faridabad": [28.4089, 77.3178], "meerut": [28.9845, 77.7064],
  "rajkot": [22.3039, 70.8022], "kalyan": [19.2350, 73.1295],
  "vasai-virar": [19.4630, 72.8100], "varanasi": [25.3176, 82.9739],
  "srinagar": [34.0837, 74.7973], "aurangabad": [19.8762, 75.3433],
  "dhanbad": [23.7957, 86.4304], "amritsar": [31.6340, 74.8723],
  "navi mumbai": [19.0330, 73.0297], "allahabad": [25.4358, 81.8463], "prayagraj": [25.4358, 81.8463],
  "ranchi": [23.3441, 85.3096], "howrah": [22.5958, 88.2636],
  "coimbatore": [11.0168, 76.9558], "jabalpur": [23.1815, 79.9864],
  "gwalior": [26.2183, 78.1828], "vijayawada": [16.5062, 80.6480],
  "jodhpur": [26.2389, 73.0243], "madurai": [9.9252, 78.1198],
  "raipur": [21.2514, 81.6296], "kota": [25.2138, 75.8648],
  "guwahati": [26.1445, 91.7362], "chandigarh": [30.7333, 76.7794],
  "solapur": [17.6599, 75.9064], "hubli": [15.3647, 75.1240], "hubli-dharwad": [15.3647, 75.1240],
  "bareilly": [28.3670, 79.4304], "moradabad": [28.8386, 78.7733],
  "mysuru": [12.2958, 76.6394], "mysore": [12.2958, 76.6394],
  "gurugram": [28.4595, 77.0266], "gurgaon": [28.4595, 77.0266],
  "aligarh": [27.8974, 78.0880], "jalandhar": [31.3260, 75.5762],
  "tiruchirappalli": [10.7905, 78.7047], "trichy": [10.7905, 78.7047],
  "bhubaneswar": [20.2961, 85.8245], "salem": [11.6643, 78.1460],
  "warangal": [17.9689, 79.5941], "thiruvananthapuram": [8.5241, 76.9366], "trivandrum": [8.5241, 76.9366],
  "bhiwandi": [19.3002, 73.0629], "saharanpur": [29.9680, 77.5460],
  "guntur": [16.3067, 80.4365], "amravati": [20.9374, 77.7796],
  "bikaner": [28.0229, 73.3119], "noida": [28.5355, 77.3910],
  "jamshedpur": [22.8046, 86.2029], "bhilai": [21.1938, 81.3509],
  "cuttack": [20.4625, 85.8830], "firozabad": [27.1592, 78.3957],
  "kochi": [9.9312, 76.2673], "cochin": [9.9312, 76.2673],
  "bhavnagar": [21.7645, 72.1519], "dehradun": [30.3165, 78.0322],
  "durgapur": [23.5204, 87.3119], "asansol": [23.6739, 86.9524],
  "nanded": [19.1383, 77.3210], "kolhapur": [16.7050, 74.2433],
  "ajmer": [26.4499, 74.6399], "akola": [20.7096, 77.0082],
  "kalaburagi": [17.3297, 76.8343], "gulbarga": [17.3297, 76.8343],
  "jamnagar": [22.4707, 70.0577], "ujjain": [23.1765, 75.7885],
  "siliguri": [26.7271, 88.3953], "jhansi": [25.4484, 78.5685],
  "jammu": [32.7266, 74.8570], "sangli": [16.8524, 74.5815],
  "mangaluru": [12.9141, 74.8560], "mangalore": [12.9141, 74.8560],
  "erode": [11.3410, 77.7172], "belagavi": [15.8497, 74.4977], "belgaum": [15.8497, 74.4977],
  "tirunelveli": [8.7139, 77.7567], "gaya": [24.7955, 84.9994],
  "jalgaon": [21.0077, 75.5626], "udaipur": [24.5854, 73.7125],
  "tirupur": [11.1085, 77.3411], "davanagere": [14.4644, 75.9218],
  "kozhikode": [11.2588, 75.7804], "calicut": [11.2588, 75.7804],
  "kurnool": [15.8281, 78.0373], "rajahmundry": [17.0005, 81.8040],
  "bokaro": [23.6693, 86.1511], "ballari": [15.1394, 76.9214], "bellary": [15.1394, 76.9214],
  "patiala": [30.3398, 76.3869], "agartala": [23.8315, 91.2868],
  "bhagalpur": [25.2445, 86.9718], "muzaffarnagar": [29.4727, 77.7085],
  "latur": [18.4088, 76.5604], "dhule": [20.9042, 74.7749],
  "rohtak": [28.8955, 76.6066], "korba": [22.3595, 82.7501],
  "bhilwara": [25.3407, 74.6313], "berhampur": [19.3149, 84.7941],
  "muzaffarpur": [26.1225, 85.3906], "ahmednagar": [19.0952, 74.7496],
  "mathura": [27.4924, 77.6737], "kollam": [8.8932, 76.6141],
  "kadapa": [14.4673, 78.8242], "sambalpur": [21.4669, 83.9812],
  "bilaspur": [22.0797, 82.1409], "satara": [17.6805, 74.0183],
  "vijayapura": [16.8302, 75.7100], "bijapur": [16.8302, 75.7100],
  "rampur": [28.7978, 79.0270], "shivamogga": [13.9299, 75.5681], "shimoga": [13.9299, 75.5681],
  "chandrapur": [19.9615, 79.2961], "junagadh": [21.5222, 70.4579],
  "thrissur": [10.5276, 76.2144], "alwar": [27.5530, 76.6346],
  "bardhaman": [23.2324, 87.8615], "nizamabad": [18.6725, 78.0941],
  "parbhani": [19.2704, 76.7602], "tumakuru": [13.3392, 77.1139], "tumkur": [13.3392, 77.1139],
  "hisar": [29.1492, 75.7217], "panipat": [29.3909, 76.9635],
  "darbhanga": [26.1542, 85.8918], "dewas": [22.9676, 76.0534],
  "karnal": [29.6857, 76.9905], "bathinda": [30.2110, 74.9455],
  "jalna": [19.8410, 75.8864], "eluru": [16.7107, 81.0952],
  "barasat": [22.7248, 88.4818], "purnia": [25.7771, 87.4753],
  "satna": [24.5854, 80.8322], "mau": [25.9420, 83.5610],
  "sonipat": [28.9931, 77.0151], "farrukhabad": [27.3894, 79.5798],
  "sagar": [23.8388, 78.7378], "rourkela": [22.2604, 84.8536],
  "durg": [21.1904, 81.2849], "imphal": [24.8170, 93.9368],
  "ratlam": [23.3315, 75.0367], "hapur": [28.7306, 77.7768],
  "arrah": [25.5541, 84.6620], "anantapur": [14.6819, 77.6006],
  "karimnagar": [18.4386, 79.1288], "etawah": [26.7855, 79.0154],
  "bharatpur": [27.2152, 77.4909], "begusarai": [25.4182, 86.1272],
  "gandhidham": [23.0839, 70.1337], "puducherry": [11.9416, 79.8083], "pondicherry": [11.9416, 79.8083],
  "sikar": [27.6094, 75.1399], "thoothukudi": [8.7642, 78.1348], "tuticorin": [8.7642, 78.1348],
  "rewa": [24.5364, 81.3037], "mirzapur": [25.1460, 82.5690],
  "raichur": [16.2076, 77.3463], "pali": [25.7711, 73.3234],
  "haridwar": [29.9457, 78.1642], "vizianagaram": [18.1067, 83.3956],
  "katihar": [25.5388, 87.5827], "nagercoil": [8.1780, 77.4346],
  "sri ganganagar": [29.9094, 73.8800], "panchkula": [30.6942, 76.8606],
  "guntakal": [15.1670, 77.3775], "yamunanagar": [30.1290, 77.2674],
  "bidar": [17.9104, 77.5199], "baharampur": [24.0977, 88.2503],
  "rae bareli": [26.2309, 81.2331], "silchar": [24.8333, 92.7789],
  "ongole": [15.5057, 80.0499], "nandyal": [15.4778, 78.4836],
  "morena": [26.5019, 78.0022], "bhiwani": [28.7975, 76.1322],
  "porbandar": [21.6417, 69.6293], "palakkad": [10.7867, 76.6548],
  "anand": [22.5645, 72.9289], "bhimavaram": [16.5449, 81.5212],
  "silvassa": [20.2766, 73.0083], "fatehpur": [25.9308, 80.8135],
  "hospet": [15.2695, 76.3877], "vellore": [12.9165, 79.1325],
  "nellore": [14.4426, 79.9865], "thanjavur": [10.7870, 79.1378],
  "dindigul": [10.3624, 77.9695], "kanchipuram": [12.8342, 79.7036],
  "kumbakonam": [10.9601, 79.3845], "cuddalore": [11.7480, 79.7714],
  "sivakasi": [9.4491, 77.7972], "karur": [10.9601, 78.0766],
  "namakkal": [11.2189, 78.1677], "hosur": [12.7409, 77.8253],
};

let map = null, markerLayer = null;

async function renderFleetMap() {
  const el = document.getElementById("fleetMapEl");
  if (!el) return; // tab not built yet
  try { await loadLeaflet(); } catch (e) { el.innerHTML = `<p class="muted" style="padding:20px">${esc(e.message)}</p>`; return; }

  if (!map) {
    map = L.map(el).setView([22.5, 79], 5); // roughly the centre of India
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors",
      maxZoom: 18,
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
  }
  markerLayer.clearLayers();

  const byCity = {}; // normalized city -> { label, vehicles: [] }
  const unmatched = [];
  db.vehicles.forEach(v => {
    const raw = (v.depot || "").trim();
    if (!raw) { unmatched.push(v); return; }
    const coords = CITY_COORDS[raw.toLowerCase()];
    if (!coords) { unmatched.push(v); return; }
    const key = raw.toLowerCase();
    if (!byCity[key]) byCity[key] = { label: raw, coords, vehicles: [] };
    byCity[key].vehicles.push(v);
  });

  const points = [];
  Object.values(byCity).forEach(c => {
    const marker = L.marker(c.coords).addTo(markerLayer);
    const list = c.vehicles.map(v => `${esc(v.name)} <span class="muted">(${esc(v.status || "Active")})</span>`).join("<br>");
    marker.bindPopup(`<strong>${esc(c.label)}</strong> — ${c.vehicles.length} vehicle${c.vehicles.length > 1 ? "s" : ""}<br>${list}`);
    points.push(c.coords);
  });

  if (points.length) map.fitBounds(points, { padding: [30, 30], maxZoom: 11 });
  setTimeout(() => map && map.invalidateSize(), 50);

  const note = document.getElementById("fleetMapUnmatched");
  if (note) {
    note.textContent = unmatched.length
      ? `${unmatched.length} vehicle${unmatched.length > 1 ? "s" : ""} not shown — no depot city set or city not recognised: ${unmatched.map(v => v.name).join(", ")}`
      : (db.vehicles.length ? "" : "Add vehicles with a Base Depot / City to see them here.");
  }
}
