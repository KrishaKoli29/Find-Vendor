// Initialize Socket Connection (Update this URL after deploying backend)
const BACKEND_URL = "http://localhost:3000";
const socket = io(BACKEND_URL);

// Initialize Map
// Initialize Map (Using a premium-looking map style from CartoDB)
const map = L.map("map", { zoomControl: false }).setView([0, 0], 2);

L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  {
    attribution: "&copy; CartoDB",
    subdomains: "abcd",
    maxZoom: 20,
  },
).addTo(map);

// Move zoom controls to top-right so they don't hide under our new UI panels
L.control.zoom({ position: "topright" }).addTo(map);

// Global Variables
let myMarker = null;
let watchId = null;
let isOnline = false;

// Custom Icons[cite: 1]
const customerIcon = L.icon({
  iconUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
const vendorIcon = L.icon({
  iconUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

// Setup Display Name[cite: 1]
const currentUser = localStorage.getItem("currentUser") || "Guest";
if (document.getElementById("userNameDisplay")) {
  document.getElementById("userNameDisplay").innerText =
    `Hello, ${currentUser}`;
}

// ---------------------------------------------------------
// VENDOR LOGIC
// ---------------------------------------------------------
if (document.getElementById("vendor-panel")) {
  if (currentUser !== "Guest")
    document.getElementById("vendorName").value = currentUser;

  window.toggleOnlineStatus = function () {
    const btn = document.getElementById("toggleBtn");
    const statusText = document.getElementById("statusText");

    if (!isOnline) {
      if (navigator.geolocation) {
        // Get initial position to emit 'vendorOnline'
        navigator.geolocation.getCurrentPosition((position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          const name =
            document.getElementById("vendorName").value || "Anonymous Vendor";
          const items =
            document.getElementById("vendorItems").value || "Various items";

          socket.emit("vendorOnline", { lat, lng, name, items });

          // Start watching for movement
          watchId = navigator.geolocation.watchPosition(
            updateVendorLocation,
            handleLocationError,
            { enableHighAccuracy: true },
          );

          isOnline = true;
          btn.innerText = "Go Offline";
          btn.classList.add("btn-danger"); //[cite: 6]
          statusText.innerText = "Online & Broadcasting";
          statusText.style.color = "green";
        }, handleLocationError);
      } else {
        alert("Geolocation is not supported by this browser.");
      }
    } else {
      // GOING OFFLINE
      navigator.geolocation.clearWatch(watchId);
      socket.emit("vendorOffline");

      isOnline = false;
      btn.innerText = "Go Online & Share Location";
      btn.classList.remove("btn-danger"); //[cite: 6]
      statusText.innerText = "Offline";
      statusText.style.color = "red";
    }
  };

  function updateVendorLocation(position) {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;

    updateMyMarker(lat, lng, vendorIcon, "You are here!");
    map.setView([lat, lng], 14);

    if (isOnline) {
      socket.emit("vendorLocationUpdate", { lat, lng });
    }
  }

  window.addEventListener("beforeunload", () => {
    if (isOnline) socket.emit("vendorOffline");
  });
}

// ---------------------------------------------------------
// CUSTOMER LOGIC
// ---------------------------------------------------------
if (document.getElementById("customer-panel")) {
  let activeVendorMarkers = {};

  // Find customer's location
  map.locate({ setView: true, maxZoom: 13 });

  map.on("locationfound", function (e) {
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    updateMyMarker(lat, lng, customerIcon, "Your Location");

    // Request vendors immediately, then poll server every 5 seconds for movement updates
    socket.emit("requestNearbyVendors", { lat, lng });
    setInterval(() => {
      socket.emit("requestNearbyVendors", { lat, lng });
    }, 5000);
  });

  // Listen for the optimized vendor list from the server
  socket.on("nearbyVendorsUpdate", (vendors) => {
    const resultsPanel = document.getElementById("vendor-results");
    let panelHTML = "<h3>Live Vendors</h3>"; //[cite: 1]

    // Track which IDs are in the new batch to remove stale markers
    const currentBatchIds = new Set(vendors.map((v) => v.id));

    vendors.forEach((data) => {
      const lat = parseFloat(data.lat);
      const lng = parseFloat(data.lng);

      if (!activeVendorMarkers[data.id]) {
        activeVendorMarkers[data.id] = L.marker([lat, lng], {
          icon: vendorIcon,
        }).addTo(map);
      } else {
        activeVendorMarkers[data.id].setLatLng([lat, lng]);
      }
      activeVendorMarkers[data.id].bindPopup(
        `<b>${data.name}</b><br>Selling: ${data.items}`,
      ); //[cite: 1]

      panelHTML += `
                <div class="vendor-card">
                    <strong><span class="live-dot"></span>${data.name}</strong>
                    <small>${data.items}</small>
                </div>
            `;
    });

    // Cleanup markers for vendors who moved out of the 5km radius
    for (const id in activeVendorMarkers) {
      if (!currentBatchIds.has(id)) {
        map.removeLayer(activeVendorMarkers[id]);
        delete activeVendorMarkers[id];
      }
    }

    if (vendors.length === 0) {
      panelHTML += "<p>No vendors currently online nearby.</p>"; //[cite: 1]
    }
    resultsPanel.innerHTML = panelHTML;
  });

  // Instantly remove a marker if a vendor explicitly disconnects
  socket.on("vendorDisconnected", (id) => {
    if (activeVendorMarkers[id]) {
      map.removeLayer(activeVendorMarkers[id]);
      delete activeVendorMarkers[id];
    }
  });
}

// ---------------------------------------------------------
// SHARED UTILITIES
// ---------------------------------------------------------
function updateMyMarker(lat, lng, iconType, popupText) {
  if (myMarker) {
    myMarker.setLatLng([lat, lng]); //[cite: 1]
  } else {
    myMarker = L.marker([lat, lng], { icon: iconType }).addTo(map); //[cite: 1]
    myMarker.bindPopup(popupText).openPopup();
  }
}

function handleLocationError(e) {
  console.warn("Location error: ", e.message); //[cite: 1]
}
