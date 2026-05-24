// ============================================================
// pos-config.js  —  Grand Table POS  —  Shared Auth + API
// Add to every app:  <script src="pos-config.js"></script>
// ============================================================

const POS_CONFIG = {
  GOOGLE_CLIENT_ID : "335894427389-lj497464m2a7anusn9d5e75ekojkguva.apps.googleusercontent.com",  // ← replace after setup
  APPS_SCRIPT_URL  : "https://script.google.com/macros/s/AKfycbw_wZUJlXgLcoNOz-hfLeLtpNbfC0vxxmZrHL3KjwOqrhPTajGJWV-J8L-XbdVmPIdV7w/exec", // ← replace
  ADMIN_EMAIL      : "YOUR_SHOP_GMAIL@gmail.com",  // ← the ONE master shop Google account
  RESTAURANT_NAME  : "The Grand Table",
  CURRENCY         : "Rs.",
  TAX_RATE         : 0.10,
  DELIVERY_FEE     : 250,
  POLL_MS          : 5000,

  // Auth mode per app
  // "hub"     → Google sign-in (admin account only) → gateway to internal apps
  // "pin"     → must have hub session + 4-digit PIN
  // "session" → must have hub session, no PIN
  // "driver"  → own Google account, must be in approved drivers list
  // "public"  → no auth at all
  ACCESS: {
    "index"                : "hub",
    "manager-portal"       : "pin",
    "waiter-app"           : "session",
    "kitchen-display"      : "session",
    "kitchen-prep-display" : "session",
    "waiting-display"      : "session",
    "driver-app"           : "driver",
    "team-app"             : "team",
    "customer-app"         : "public",
  },
};

// ============================================================
//  POS_AUTH
// ============================================================
window.POS_AUTH = (() => {
  const HUB_KEY    = "pos_hub_session";      // localStorage – set by Hub
  const DRIVER_KEY = "pos_driver_session";   // localStorage – set by Driver login

  // ── Decode Google JWT ─────────────────────────────────────
  function _jwt(token) {
    const b64 = token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
    return JSON.parse(atob(b64));
  }

  // ── Session helpers ───────────────────────────────────────
  function saveHubSession(email, name, picture) {
    localStorage.setItem(HUB_KEY, JSON.stringify({ email, name, picture, ts: Date.now() }));
  }

  function getHubSession() {
    const raw = localStorage.getItem(HUB_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (Date.now() - s.ts > 24 * 3600 * 1000) { localStorage.removeItem(HUB_KEY); return null; }
    return s;
  }

  function saveDriverSession(email, name, picture, driverData) {
    localStorage.setItem(DRIVER_KEY, JSON.stringify({ email, name, picture, driverData, ts: Date.now() }));
  }

  function getDriverSession() {
    const raw = localStorage.getItem(DRIVER_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (Date.now() - s.ts > 12 * 3600 * 1000) { localStorage.removeItem(DRIVER_KEY); return null; }
    return s;
  }

  function signOut(returnTo) {
    localStorage.removeItem(HUB_KEY);
    localStorage.removeItem(DRIVER_KEY);
    if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
    window.location.href = returnTo || "index.html";
  }

  // ── Load Google Identity Services script ─────────────────
  function _loadGIS(callback) {
    if (window.google?.accounts?.id) { callback(); return; }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = callback;
    document.head.appendChild(s);
  }

  // ── Google Sign-In button renderer ───────────────────────
  function _renderGoogleBtn(containerId, callback) {
    google.accounts.id.initialize({
      client_id           : POS_CONFIG.GOOGLE_CLIENT_ID,
      callback            : callback,
      auto_select         : true,
      cancel_on_tap_outside: false,
    });
    const el = document.getElementById(containerId);
    if (el) {
      google.accounts.id.renderButton(el, {
        theme: "filled_black", size: "large",
        shape: "rectangular", width: 300,
      });
    }
    google.accounts.id.prompt();
  }

  // ── Full-screen login wall ────────────────────────────────
  function _showLoginWall(title, subtitle, btnId, onToken) {
    const wall = document.createElement("div");
    wall.id = "pos-login-wall";
    wall.style.cssText = `
      position:fixed;inset:0;background:#07070f;
      display:flex;align-items:center;justify-content:center;
      z-index:9998;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;`;
    wall.innerHTML = `
      <div style="text-align:center;padding:24px;max-width:380px;width:100%;">
        <div style="font-size:60px;margin-bottom:18px;">🍽️</div>
        <h1 style="color:#fff;font-size:26px;font-weight:900;margin-bottom:8px;">${POS_CONFIG.RESTAURANT_NAME}</h1>
        <p style="color:rgba(255,255,255,.4);font-size:14px;margin-bottom:36px;">${subtitle}</p>
        <div id="${btnId}" style="display:flex;justify-content:center;"></div>
        <div id="gsi-error" style="color:#e74c3c;font-size:13px;margin-top:18px;min-height:20px;"></div>
        <p style="color:rgba(255,255,255,.15);font-size:12px;margin-top:48px;">${title}</p>
      </div>`;
    document.body.appendChild(wall);
    return wall;
  }

  // ── PIN modal ─────────────────────────────────────────────
  function _showPinModal(session, { onSuccess, onFail } = {}) {
    const overlay = document.createElement("div");
    overlay.id = "pos-pin-overlay";
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(7,7,15,.95);backdrop-filter:blur(6px);
      display:flex;align-items:center;justify-content:center;z-index:9999;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;`;
    overlay.innerHTML = `
      <div style="background:#111827;border:1px solid rgba(255,255,255,.1);border-radius:24px;
                  padding:40px 32px;width:320px;text-align:center;
                  box-shadow:0 40px 100px rgba(0,0,0,.7);">
        <div style="font-size:48px;margin-bottom:14px;">🔐</div>
        <h2 style="color:#fff;font-size:20px;font-weight:800;margin-bottom:6px;">Manager Access</h2>
        <p style="color:rgba(255,255,255,.4);font-size:13px;margin-bottom:28px;">
          Signed in as <strong style="color:rgba(255,255,255,.7)">${session.name}</strong><br>
          Enter your 4-digit PIN to continue
        </p>
        <!-- PIN dots -->
        <div style="display:flex;justify-content:center;gap:14px;margin-bottom:28px;">
          ${[0,1,2,3].map(i=>`<div id="pdot-${i}" style="width:20px;height:20px;border-radius:50%;
            border:2px solid rgba(255,255,255,.2);background:transparent;transition:all .15s;"></div>`).join("")}
        </div>
        <!-- Numpad -->
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px;">
          ${[1,2,3,4,5,6,7,8,9,"","0","⌫"].map(k=>`
            <button data-k="${k}" style="
              padding:15px 0;border-radius:12px;border:1px solid rgba(255,255,255,.08);
              background:rgba(255,255,255,.05);color:#fff;font-size:20px;font-weight:600;
              cursor:${k===""?"default":"pointer"};
              ${k===""?"opacity:0;pointer-events:none;":""}
              transition:background .12s;"
              onmousedown="this.style.background='rgba(243,156,18,.25)'"
              onmouseup="this.style.background='rgba(255,255,255,.05)'"
              onmouseleave="this.style.background='rgba(255,255,255,.05)'"
            >${k}</button>`).join("")}
        </div>
        <div id="pin-error" style="color:#e74c3c;font-size:13px;min-height:18px;margin-bottom:14px;"></div>
        <button onclick="POS_AUTH.signOut()" style="background:none;border:none;
          color:rgba(255,255,255,.25);font-size:12px;cursor:pointer;text-decoration:underline;">
          Sign out
        </button>
      </div>`;
    document.body.appendChild(overlay);

    let entered = "";

    function updateDots() {
      for (let i = 0; i < 4; i++) {
        const d = document.getElementById(`pdot-${i}`);
        const filled = i < entered.length;
        d.style.background  = filled ? "#f39c12" : "transparent";
        d.style.borderColor = filled ? "#f39c12" : "rgba(255,255,255,.2)";
        d.style.transform   = filled ? "scale(1.1)" : "scale(1)";
      }
    }

    overlay.querySelectorAll("[data-k]").forEach(btn => {
      const k = btn.dataset.k;
      if (k === "") return;
      btn.addEventListener("click", async () => {
        if (k === "⌫") {
          entered = entered.slice(0,-1);
          document.getElementById("pin-error").textContent = "";
          updateDots(); return;
        }
        if (entered.length >= 4) return;
        entered += k;
        updateDots();
        if (entered.length === 4) {
          btn.disabled = true;
          var res = await POS_API.post({ action: "verifyPin", pin: entered });
          // res.success = API reached OK, res.data.verified = PIN matched
          if (res && res.success && res.data && res.data.verified) {
            document.body.removeChild(overlay);
            onSuccess && onSuccess(session);
          } else {
            document.getElementById("pin-error").textContent = "Incorrect PIN — try again";
            entered = ""; updateDots();
            btn.disabled = false;
          }
        }
      });
    });
  }

  // ── MAIN INIT — call at top of every app ─────────────────
  function init(appId, { onReady, onError } = {}) {
    const mode = POS_CONFIG.ACCESS[appId] || "session";

    // PUBLIC — no auth needed
    if (mode === "public") { onReady && onReady(null); return; }

    // DRIVER — own Google account + approved list check
    if (mode === "driver") {
      const existing = getDriverSession();
      if (existing) { onReady && onReady(existing); return; }
      const wall = _showLoginWall(
        "Use your personal Google account to sign in",
        "Driver Portal — sign in to view your deliveries",
        "driver-gsi-btn"
      );
      _loadGIS(() => _renderGoogleBtn("driver-gsi-btn", async (resp) => {
        const p = _jwt(resp.credential);
        const res = await POS_API.post({ action: "verifyDriver", email: p.email });
        if (!res.approved) {
          document.getElementById("gsi-error").textContent =
            "Your account is not approved. Contact the restaurant manager.";
          return;
        }
        saveDriverSession(p.email, p.name, p.picture, res.driver);
        if (wall.parentNode) document.body.removeChild(wall);
        onReady && onReady(getDriverSession());
      }));
      return;
    }


    // TEAM — own Google account + pre-approved staff list
    if (mode === "team") {
      const existing = localStorage.getItem("pos_team_session");
      if (existing) {
        const s = JSON.parse(existing);
        if (Date.now() - s.ts < 12 * 3600 * 1000) { onReady && onReady(s); return; }
        localStorage.removeItem("pos_team_session");
      }
      const wall = _showLoginWall(
        "Use your personal Google account to sign in",
        "Team Portal — view your rota, hours and clock in/out",
        "team-gsi-btn"
      );
      _loadGIS(() => _renderGoogleBtn("team-gsi-btn", async (resp) => {
        const p = _jwt(resp.credential);
        const res = await POS_API.post({ action: "verifyTeamMember", email: p.email });
        if (!res.data || !res.data.approved) {
          document.getElementById("gsi-error").textContent =
            "Your account is not approved. Ask your manager to add your Gmail address.";
          return;
        }
        const session = { email: p.email, name: p.name, picture: p.picture,
                          staffData: res.data.staff, ts: Date.now() };
        localStorage.setItem("pos_team_session", JSON.stringify(session));
        if (wall && wall.parentNode) document.body.removeChild(wall);
        onReady && onReady(session);
      }));
      return;
    }

    // HUB — Google sign-in with admin account
    if (mode === "hub") {
      const existing = getHubSession();
      if (existing) { onReady && onReady(existing); return; }
      const wall = _showLoginWall(
        "Use the restaurant's Google account to sign in",
        "Staff Portal — sign in with the shop account",
        "hub-gsi-btn"
      );
      _loadGIS(() => _renderGoogleBtn("hub-gsi-btn", (resp) => {
        const p = _jwt(resp.credential);
        if (p.email.toLowerCase() !== POS_CONFIG.ADMIN_EMAIL.toLowerCase()) {
          document.getElementById("gsi-error").textContent =
            `Access denied. Please sign in with ${POS_CONFIG.ADMIN_EMAIL}`;
          return;
        }
        saveHubSession(p.email, p.name, p.picture);
        if (wall.parentNode) document.body.removeChild(wall);
        onReady && onReady(getHubSession());
      }));
      return;
    }

    // SESSION — must have hub session (waiter, kitchen, waiting display)
    if (mode === "session") {
      const session = getHubSession();
      if (session) { onReady && onReady(session); return; }
      // Redirect to hub to sign in
      window.location.href = `index.html?redirect=${encodeURIComponent(window.location.href)}`;
      return;
    }

    // PIN — hub session + 4-digit PIN (manager portal)
    if (mode === "pin") {
      const session = getHubSession();
      if (!session) {
        window.location.href = `index.html?redirect=${encodeURIComponent(window.location.href)}`;
        return;
      }
      _showPinModal(session, {
        onSuccess: (s) => onReady && onReady(s),
        onFail   : (e) => onError && onError(e),
      });
      return;
    }
  }

  // ── Render user badge in header ───────────────────────────
  function renderBadge(containerId, appId) {
    const s = appId === "driver-app" ? getDriverSession() : getHubSession();
    const el = document.getElementById(containerId);
    if (!el || !s) return;
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:13px;opacity:.8;">${s.name}</span>
        <button onclick="POS_AUTH.signOut('index.html')"
          style="background:rgba(255,255,255,.12);border:none;color:rgba(255,255,255,.7);
                 padding:4px 12px;border-radius:10px;font-size:12px;cursor:pointer;">
          Sign out
        </button>
      </div>`;
  }

  return { init, getHubSession, getDriverSession, saveHubSession,
           saveDriverSession, signOut, renderBadge };
})();

// ============================================================
//  POS_API  —  fetch wrapper for Apps Script
// ============================================================
window.POS_API = (() => {
  async function get(params) {
    const url = POS_CONFIG.APPS_SCRIPT_URL + "?" + new URLSearchParams(params);
    try { const r = await fetch(url); return await r.json(); }
    catch(e) { return { error: e.message }; }
  }
  async function post(body) {
    try {
      const r = await fetch(POS_CONFIG.APPS_SCRIPT_URL, {
        method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)
      });
      return await r.json();
    } catch(e) { return { error: e.message }; }
  }
  function poll(fn, cb, ms) {
    fn().then(cb);
    return setInterval(() => fn().then(cb), ms || POS_CONFIG.POLL_MS);
  }

  const Orders     = {
    getAll : (status) => get({ action:"getOrders", status }),
    create : (d)      => post({ action:"createOrder",   data:d }),
    update : (d)      => post({ action:"updateOrder",   data:d }),
  };
  const Menu       = {
    getAll : (cat)  => get({ action:"getMenu", category:cat }),
    add    : (d)    => post({ action:"addMenuItem",    data:d }),
    update : (d)    => post({ action:"updateMenuItem", data:d }),
  };
  const Tables     = {
    getAll : ()   => get({ action:"getTables" }),
    update : (d)  => post({ action:"updateTable", data:d }),
  };
  const Inventory  = {
    getAll : ()   => get({ action:"getInventory" }),
    update : (d)  => post({ action:"updateInventory", data:d }),
  };
  const Drivers    = {
    getAll    : ()        => get({ action:"getDrivers" }),
    getOrders : (email)   => get({ action:"getDriverOrders", email }),
    update    : (d)       => post({ action:"updateDriver", data:d }),
    addApproved: (d)      => post({ action:"addApprovedDriver", data:d }),
    removeApproved: (email)=> post({ action:"removeApprovedDriver", email }),
  };
  const Team = {
    verify     : (email) => post({ action:"verifyTeamMember", email }),
    getRota    : (email, month, year) => get({ action:"getRota", email, month, year }),
    getHours   : (email, month, year) => get({ action:"getHours", email, month, year }),
    clockIn    : (email, name)  => post({ action:"clockIn",  data:{ email, name } }),
    clockOut   : (email)        => post({ action:"clockOut", data:{ email } }),
    getClockings:(email, month) => get({ action:"getClockings", email, month }),
  };
  const Settings   = {
    setPin  : (pin)  => post({ action:"setPin",  pin }),
    getInfo : ()     => get({ action:"getSettings" }),
    update  : (d)    => post({ action:"updateSettings", data:d }),
  };
  const Analytics  = {
    get : (date) => get({ action:"getAnalytics", date }),
  };

  // Test the Apps Script connection — call this from browser console: POS_API.testConnection()
  async function testConnection() {
    console.log("Testing connection to Apps Script...");
    try {
      var res = await get({ action: "ping" });
      if (res && res.success) {
        console.log("✅ Connected!", res.data);
        console.log("Sheet ready:", res.data.sheetReady);
        console.log("PIN ready:  ", res.data.pinReady);
        console.log("Setup done: ", res.data.setupDone);
        if (!res.data.setupDone) {
          console.warn("⚠️ setupSystem() has not been run in Apps Script! Run it now.");
        }
        return res.data;
      } else {
        console.error("❌ API responded but with error:", res);
        return null;
      }
    } catch(e) {
      console.error("❌ Cannot reach Apps Script. Check APPS_SCRIPT_URL in pos-config.js", e);
      return null;
    }
  }

  return { get, post, poll, testConnection, Orders, Menu, Tables, Inventory, Drivers, Team, Settings, Analytics };
})();
