// ============================================================
// pos-config.js — Grand Table POS
// No Apps Script needed. Uses Google Drive + Sheets API directly.
// Each user's data lives in their own Google Drive.
// ============================================================

// ── SHOP NAME ───────────────────────────────────────────────
// One place that knows the restaurant's name (Settings → restaurant_name, set at setup / in the
// Manager Portal). Every app header, page title and receipt reads it from here, so the name
// always follows the setup. The last known name is remembered so even the sign-in screen shows it.
window.POS_SHOP = (function () {
  var KEY = "pos_shop_name", name = "", base = null;
  try { name = localStorage.getItem(KEY) || ""; } catch (e) {}
  function display() { return name || "Restaurant"; }
  function apply() {
    try {
      if (base === null) base = document.title.replace(/\s*[-\u2014]\s*(The Grand Table|Restaurant POS)\s*$/, "");
      if (name) document.title = base + " \u2014 " + name;
      document.querySelectorAll("[data-shop-name]").forEach(function (el) { el.textContent = display(); });
    } catch (e) {}
  }
  function set(n) {
    n = String(n || "").trim();
    if (!n || n === name) return;
    name = n;
    try { localStorage.setItem(KEY, n); } catch (e) {}
    apply();
    try { window.dispatchEvent(new Event("pos-shop-name")); } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply); else apply();
  return { get name() { return name; }, display: display, upper: function () { return display().toUpperCase(); }, set: set, apply: apply };
})();

// ── LAN MODE ────────────────────────────────────────────────
// When an app is opened from the restaurant's local server (plain http://),
// every Google Sheets call is redirected to that server instead. Opened from
// GitHub Pages (https) nothing changes. Override with ?mode=online / ?mode=lan.
window.POS_IS_LAN = (function () {
  try {
    if (/[?&]mode=online/.test(location.search)) return false;
    if (/[?&]mode=lan/.test(location.search)) return true;
    return location.protocol === "http:" || (location.protocol === "https:" && location.port === "3443");   // 3443 = the laptop's secure (camera) address
  } catch (e) { return false; }
})();
const POS_LAN_BASE = window.POS_LAN_BASE || "";

const POS_CONFIG = {
  // Replace with your Google OAuth Client ID
  GOOGLE_CLIENT_ID : "335894427389-lj497464m2a7anusn9d5e75ekojkguva.apps.googleusercontent.com",

  RESTAURANT_NAME  : "Restaurant POS",  // default, overridden by each user's setup
  CURRENCY         : "LKR",
  TAX_RATE         : 0.10,
  DELIVERY_FEE     : 250,
  POLL_MS          : window.POS_IS_LAN ? 2000 : 5000,   // LAN also gets instant WebSocket pushes
  MAPS_API_KEY     : "AIzaSyC8E4xFMHnAZi1TZFM5pW51caa746de3ZQ",   // optional — for driver GPS

  // Auth mode per app
  ACCESS: {
    "index"                : "hub",
    "setup-wizard"         : "public",
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
// POS_GAPI — Google Drive + Sheets API (no Apps Script)
// ============================================================
window.POS_GAPI = (() => {

  const SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/drive.appdata",
    "email", "profile",
  ].join(" ");

  const LS_SESSION    = "pos_session";
  const LS_SHEET_ID   = (email) => "pos_sheet_" + email;
  const LS_SETTINGS   = (email) => "pos_settings_" + email;

  let _accessToken = null;
  let _session     = null;   // { email, name, picture }
  let _sheetId     = null;
  let _settings    = {};
  let _tokenClient = null;

  // ── Load Google API libraries ─────────────────────────────
  const LAN = window.POS_IS_LAN;
  const LAN_DEFAULT_USER = { email: "lan@local", name: "Restaurant (LAN)", picture: "" };
  function _lanUser() {
    try { const u = JSON.parse(localStorage.getItem("pos_lan_user") || "null"); if (u && u.email) return u; } catch (e) {}
    return LAN_DEFAULT_USER;
  }
  function setLanUser(u) {
    _session = u;
    try { localStorage.setItem("pos_lan_user", JSON.stringify(u)); } catch (e) {}
  }
  async function _lan(method, path, body) {
    const res = await fetch(POS_LAN_BASE + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch (e) {}
    if (!res.ok || (json && json.success === false)) {
      throw new Error((json && json.error) || ("Server error " + res.status));
    }
    return json || {};
  }

  function loadLibraries() {
    if (LAN) return Promise.resolve();
    return new Promise((resolve) => {
      if (window.gapi && window.gapi.client && window.google && window.google.accounts) {
        resolve(); return;
      }
      let s1 = document.querySelector('script[src="https://apis.google.com/js/api.js"]');
      if (!s1) {
        s1 = document.createElement("script");
        s1.src = "https://apis.google.com/js/api.js";
        document.head.appendChild(s1);
      }
      let s2 = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
      if (!s2) {
        s2 = document.createElement("script");
        s2.src = "https://accounts.google.com/gsi/client";
        s2.async = true;
        document.head.appendChild(s2);
      }

      const checkInterval = setInterval(() => {
        if (window.gapi && window.google && window.google.accounts) {
          clearInterval(checkInterval);
          gapi.load("client", async () => {
            await gapi.client.init({});
            await gapi.client.load("https://sheets.googleapis.com/$discovery/rest?version=v4");
            await gapi.client.load("https://www.googleapis.com/discovery/v1/apis/drive/v3/rest");
            resolve();
          });
        }
      }, 100);
    });
  }

  // ── Sign In ───────────────────────────────────────────────
  function signIn(callback) {
    if (LAN) { _session = _lanUser(); callback && callback(_session); return; }
    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id : POS_CONFIG.GOOGLE_CLIENT_ID,
      scope     : SCOPES,
      callback  : async (tokenResponse) => {
        if (tokenResponse.error) { callback && callback(null, tokenResponse.error); return; }
        _accessToken = tokenResponse.access_token;
        gapi.client.setToken({ access_token: _accessToken });

        const prof = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: "Bearer " + _accessToken }
        }).then(r => r.json());

        _session = { email: prof.email, name: prof.name, picture: prof.picture };
        _saveSession();

        callback && callback(_session);
      },
    });
    _tokenClient.requestAccessToken({ prompt: "consent" });
  }

  function silentSignIn(callback) {
    if (LAN) { _session = _lanUser(); callback && callback(_session); return; }
    const saved = _loadSession();
    if (!saved) { callback && callback(null); return; }
    _session = saved.session;

    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id : POS_CONFIG.GOOGLE_CLIENT_ID,
      scope     : SCOPES,
      prompt    : "",
      callback  : async (tokenResponse) => {
        if (tokenResponse.error) { callback && callback(null, tokenResponse.error); return; }
        _accessToken = tokenResponse.access_token;
        gapi.client.setToken({ access_token: _accessToken });
        callback && callback(_session);
      },
    });
    _tokenClient.requestAccessToken({ prompt: "" });
  }

  function signOut() {
    if (LAN) {
      try { localStorage.removeItem("pos_lan_user"); } catch (e) {}
      _session = null;
      window.location.href = "index.html";
      return;
    }
    if (_accessToken) google.accounts.oauth2.revoke(_accessToken, () => {});
    _accessToken = null;
    _session     = null;
    _sheetId     = null;
    _settings    = {};
    try { localStorage.removeItem(LS_SESSION); } catch(e) {}
    window.location.href = "index.html";
  }

  function _saveSession() {
    try {
      localStorage.setItem(LS_SESSION, JSON.stringify({
        session: _session,
        ts: Date.now()
      }));
    } catch(e) {}
  }

  function _loadSession() {
    try {
      const raw = localStorage.getItem(LS_SESSION);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (Date.now() - d.ts > 8 * 3600 * 1000) {
        localStorage.removeItem(LS_SESSION);
        return null;
      }
      return d;
    } catch(e) { return null; }
  }

  function getSession()    { return _session; }
  function getSheetId()    { return _sheetId; }   // "LAN" in LAN mode (apps only check it is non-empty)
  function getAccessToken(){ return _accessToken; }

  // ── Find or create the user's spreadsheet ─────────────────
  async function initUserSheet(restaurantName) {
    if (LAN) {
      _sheetId = "LAN";
      if (!_session) _session = _lanUser();
      await _loadSettings();
      return { sheetId: "LAN", isNew: false };
    }
    if (!_session) {
      const saved = _loadSession();
      if (saved) _session = saved.session;
    }

    let cachedId = null;
    if (_session && _session.email) {
      cachedId = localStorage.getItem(LS_SHEET_ID(_session.email));
    }
    if (!cachedId) {
      cachedId = localStorage.getItem("pos_active_sheet_id");
    }

    if (cachedId) {
      try {
        _sheetId = cachedId;
        localStorage.setItem("pos_active_sheet_id", cachedId);
        if (_session && _session.email) {
          localStorage.setItem(LS_SHEET_ID(_session.email), cachedId);
        }
        await _loadSettings();
        return { sheetId: cachedId, isNew: false };
      } catch(e) {
        // Cached sheet removed or invalid
      }
    }

    if (!_session || !_session.email) {
      throw new Error("No active Google session to initialize sheet.");
    }

    const name = (restaurantName || _session.name.split(" ")[0]) + " POS";
    try {
      const search = await gapi.client.drive.files.list({
        q         : `name contains 'POS Database' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
        fields    : "files(id,name,createdTime)",
        orderBy   : "createdTime desc",
        pageSize  : 5,
      });
      const files = search.result.files || [];
      if (files.length > 0) {
        _sheetId = files[0].id;
        localStorage.setItem(LS_SHEET_ID(_session.email), _sheetId);
        localStorage.setItem("pos_active_sheet_id", _sheetId);
        await _loadSettings();
        return { sheetId: _sheetId, isNew: false };
      }
    } catch(e) {}

    return await _createFolderAndSheet(restaurantName || ((_session.name || "My Restaurant") + " POS"));
  }

  async function _createFolderAndSheet(restaurantName) {
    const folderRes = await gapi.client.drive.files.create({
      resource: {
        name    : restaurantName + " — POS",
        mimeType: "application/vnd.google-apps.folder",
      },
      fields: "id,name,webViewLink",
    });
    const folderId = folderRes.result.id;

    const ssRes = await gapi.client.drive.files.create({
      resource: {
        name    : restaurantName + " — POS Database",
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents : [folderId],
      },
      fields: "id,name,webViewLink",
    });
    _sheetId = ssRes.result.id;
    localStorage.setItem(LS_SHEET_ID(_session.email), _sheetId);
    localStorage.setItem("pos_active_sheet_id", _sheetId);

    await _buildSheets(restaurantName);
    return { sheetId: _sheetId, folderId, isNew: true, folderName: restaurantName + " — POS" };
  }

  async function _buildSheets(restaurantName) {
    const tabDefs = [
      { name:"Orders",     headers:["OrderID","TableNumber","CustomerName","WaiterName","Items","Subtotal","Tax","Total","Status","OrderTime","Notes"] },
      { name:"MenuItems",  headers:["ItemID","Name","Category","Price","Description","Available","PrepTime","Emoji"] },
      { name:"Tables",     headers:["TableID","TableNumber","Capacity","Status","CurrentWaiter","Guests","OpenedAt"] },
      { name:"Inventory",  headers:["ItemID","Name","Unit","Quantity","ReorderLevel","LastUpdated","Supplier","Cost"] },
      { name:"Staff",      headers:["StaffID","Name","Role","Email","Status","JoinDate","Approved"] },
      { name:"Recipes",    headers:["RecipeID","DishName","PrepTime","CookTime","Difficulty","Ingredients","Steps"] },
      { name:"Deliveries", headers:["DeliveryID","OrderID","DriverEmail","CustomerName","CustomerAddress","Status","PickupTime","DeliveredTime","Distance","Earnings"] },
      { name:"Drivers",    headers:["DriverID","Name","Email","Phone","Vehicle","Plate","Status","Rating","TodayEarnings","Approved","Lat","Lng","LastSeen"] },
      { name:"Analytics",  headers:["Date","TotalRevenue","OrderCount","AvgOrderValue","TopItem","PeakHour"] },
      { name:"Settings",   headers:["Key","Value"] },
      { name:"Rota",       headers:["RotaID","StaffEmail","StaffName","Date","ShiftStart","ShiftEnd","Role","Location","Notes","Status"] },
      { name:"Clockings",  headers:["ClockingID","StaffEmail","StaffName","Date","ClockIn","ClockOut","TotalHours","Status","Notes"] },
    ];

    const addRequests = tabDefs.map(tab => ({
      addSheet: { properties: { title: tab.name } }
    }));
    addRequests.unshift({ deleteSheet: { sheetId: 0 } });

    try {
      await gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: _sheetId,
        resource: { requests: addRequests.slice(1) },
      });
    } catch(e) {}

    const headerData = tabDefs.map(tab => ({
      range : tab.name + "!A1",
      values: [tab.headers],
    }));

    await gapi.client.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: _sheetId,
      resource: {
        valueInputOption: "RAW",
        data: headerData,
      },
    });

    const settings = [
      ["restaurant_name", restaurantName],
      ["currency",        POS_CONFIG.CURRENCY],
      ["tax_rate",        String(POS_CONFIG.TAX_RATE)],
      ["delivery_fee",    String(POS_CONFIG.DELIVERY_FEE)],
      ["admin_email",     _session.email],
      ["admin_pin",       "1234"],
    ];
    await _appendRows("Settings", settings);

    const tables = [];
    for (let i = 1; i <= 12; i++) {
      tables.push(["TBL-"+i, i, i<=4?2:i<=8?4:6, "available","",0,""]);
    }
    await _appendRows("Tables", tables);

    const menu = [
      ["MENU-1","Burger Deluxe","Main Course",1299,"Beef, cheddar, sauce, fries",true,"12 min","🍔"],
      ["MENU-2","Fish & Chips","Main Course",1399,"Beer-battered cod",true,"15 min","🐟"],
      ["MENU-3","Steak","Main Course",2499,"8oz ribeye, choice of sides",true,"18 min","🥩"],
      ["MENU-4","Pasta Carbonara","Main Course",1199,"Creamy bacon pasta",true,"12 min","🍝"],
      ["MENU-5","Caesar Salad","Main Course",999,"Romaine, parmesan",true,"5 min","🥗"],
      ["MENU-6","Spring Rolls","Appetizers",699,"Crispy vegetable rolls",true,"8 min","🥢"],
      ["MENU-7","Chicken Wings","Appetizers",899,"Buffalo or BBQ",true,"12 min","🍗"],
      ["MENU-8","Garlic Bread","Appetizers",499,"Toasted with cheese",true,"5 min","🥖"],
      ["MENU-9","Chocolate Cake","Desserts",699,"Rich dark chocolate",true,"2 min","🎂"],
      ["MENU-10","Ice Cream","Desserts",499,"Three scoops",true,"2 min","🍦"],
      ["MENU-11","Coca Cola","Beverages",299,"Regular or Diet",true,"1 min","🥤"],
      ["MENU-12","Fresh Juice","Beverages",499,"Orange or apple",true,"3 min","🍊"],
      ["MENU-13","Coffee","Beverages",249,"Espresso or latte",true,"4 min","☕"],
      ["MENU-14","Water","Beverages",0,"Still or sparkling",true,"1 min","💧"],
    ];
    await _appendRows("MenuItems", menu);

    await _loadSettings();
  }

  async function _loadSettings() {
    try {
      const rows = await getRows("Settings");
      _settings = {};
      rows.forEach(r => { if (r.Key) _settings[r.Key] = r.Value; });
      if (_settings.restaurant_name) window.POS_SHOP.set(_settings.restaurant_name);
      if (_session && _session.email) {
        localStorage.setItem(LS_SETTINGS(_session.email), JSON.stringify(_settings));
      }
    } catch(e) {}
  }

  function getSettings() { return _settings; }

  // ── Core Sheets CRUD ──────────────────────────────────────

  async function getRows(sheetName) {
    if (LAN) return (await _lan("GET", "/api/sheet/" + encodeURIComponent(sheetName))).data || [];
    const res = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: _sheetId,
      range: sheetName,
    });
    const vals = res.result.values || [];
    if (vals.length < 2) return [];
    const headers = vals[0];
    return vals.slice(1)
      .filter(r => r[0] !== undefined && r[0] !== "")
      .map(r => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = r[i] !== undefined ? r[i] : ""; });
        return obj;
      });
  }

  async function _appendRows(sheetName, rows) {
    if (LAN) {
      for (const values of rows) await _lan("POST", "/api/sheet/" + encodeURIComponent(sheetName) + "/append", { values });
      return;
    }
    await gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId   : _sheetId,
      range           : sheetName + "!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      resource        : { values: rows },
    });
  }

  async function appendRow(sheetName, row) {
    await _appendRows(sheetName, [row]);
  }

  async function updateRow(sheetName, colIndex, matchValue, updates) {
    if (LAN) {
      const r = await _lan("POST", "/api/sheet/" + encodeURIComponent(sheetName) + "/update", { col: colIndex, match: matchValue, updates });
      return r.data;
    }
    const res = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: _sheetId,
      range: sheetName,
    });
    const vals    = res.result.values || [];
    const headers = vals[0];
    for (let i = 1; i < vals.length; i++) {
      if (String(vals[i][colIndex]) === String(matchValue)) {
        const obj = {};
        headers.forEach((h, j) => { obj[h] = vals[i][j] !== undefined ? vals[i][j] : ""; });
        Object.assign(obj, updates);
        // The restaurant laptop merges by UpdatedAt (newest wins) — stamp edits made from the cloud
        // so a driver's "accepted"/"delivered" isn't overwritten by older laptop data.
        if (headers.indexOf("UpdatedAt") >= 0) obj.UpdatedAt = Math.floor(Date.now() / 1000);
        const newRow = headers.map(h => obj[h] !== undefined ? obj[h] : "");
        await gapi.client.sheets.spreadsheets.values.update({
          spreadsheetId   : _sheetId,
          range           : sheetName + "!A" + (i + 1),
          valueInputOption: "RAW",
          resource        : { values: [newRow] },
        });
        return obj;
      }
    }
    throw new Error(sheetName + " row not found: " + matchValue);
  }

  // ── Google Sheets Row Deletion batch API ──
  async function deleteRow(sheetName, colIndex, matchValue) {
    if (LAN) {
      await _lan("POST", "/api/sheet/" + encodeURIComponent(sheetName) + "/delete", { col: colIndex, match: matchValue });
      return { success: true };
    }
    const res = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: _sheetId,
      range: sheetName,
    });
    const vals = res.result.values || [];
    for (let i = 1; i < vals.length; i++) {
      if (String(vals[i][colIndex]) === String(matchValue)) {
        const ss = await gapi.client.sheets.spreadsheets.get({
          spreadsheetId: _sheetId
        });
        const sheet = ss.result.sheets.find(s => s.properties.title === sheetName);
        if (sheet) {
          const sheetId = sheet.properties.sheetId;
          await gapi.client.sheets.spreadsheets.batchUpdate({
            spreadsheetId: _sheetId,
            resource: {
              requests: [
                {
                  deleteDimension: {
                    range: {
                      sheetId: sheetId,
                      dimension: "ROWS",
                      startIndex: i, 
                      endIndex: i + 1 
                    }
                  }
                }
              ]
            }
          });
        }
        return { success: true };
      }
    }
    throw new Error("Row not found in " + sheetName + ": " + matchValue);
  }

  // ── Centralized Automatic Recipe-to-Stock Deduction Engine ──
  async function _deductInventoryForItems(orderedItems) {
    try {
      const recipes = await getRows("Recipes");
      const inventory = await getRows("Inventory");
      
      for (const item of orderedItems) {
        const dishName = item.name || item.Name;
        const qty = parseInt(item.qty || item.quantity || 1, 10);
        if (!dishName) continue;

        // Find matching recipe
        const recipeRow = recipes.find(r => r.DishName && r.DishName.toLowerCase() === dishName.toLowerCase());
        if (!recipeRow || !recipeRow.Ingredients) continue;

        let ingredients = [];
        try {
          ingredients = JSON.parse(recipeRow.Ingredients);
        } catch(e) { continue; }

        if (!Array.isArray(ingredients)) continue;

        for (const ing of ingredients) {
          if (!ing.name) continue;

          // Loose match: matches recipe's "Beef patty (180g)" to stock's "Beef Patties"
          const invItem = inventory.find(inv => {
            const invN = String(inv.Name || "").toLowerCase();
            const ingN = String(ing.name || "").toLowerCase();
            return ingN.includes(invN) || invN.includes(ingN);
          });

          if (invItem) {
            const amtStr = String(ing.amount || "1");
            const numMatch = amtStr.match(/^([\d.]+)/);
            const deductPerUnit = numMatch ? parseFloat(numMatch[1]) : 1;
            const totalDeduct = deductPerUnit * qty;

            const currentStock = parseFloat(invItem.Quantity) || 0;
            const newStock = Math.max(0, currentStock - totalDeduct);

            // Update Sheets
            await updateRow("Inventory", 0, invItem.ItemID, {
              Quantity: parseFloat(newStock.toFixed(2)),
              LastUpdated: new Date().toISOString()
            });
          }
        }
      }
    } catch(e) {
      console.error("Auto-inventory deduction engine failed:", e);
    }
  }

  function uid(prefix) {
    return (prefix || "ID") + "-" + Date.now() + "-" + Math.floor(Math.random()*9000+1000);
  }

  // ── High-level API ────

  const Orders = {
    getAll: async (status) => {
      const all = await getRows("Orders");
      const out = status ? all.filter(o => o.Status === status) : all;
      return { success:true, data: out.sort((a,b) => new Date(b.OrderTime) - new Date(a.OrderTime)) };
    },
    create: async (data) => {
      const id    = uid("ORD");
      const now   = new Date().toISOString();
      const sub   = parseFloat(data.subtotal || data.total || 0);
      const tax   = parseFloat((sub * (_settings.tax_rate || 0.10)).toFixed(2));
      const total = parseFloat((sub + tax).toFixed(2));
      await appendRow("Orders", [id, data.tableNumber, data.customerName||"",
        data.waiterName||"", JSON.stringify(data.items||[]), sub, tax, total, "new", now, data.notes||""]);
      if (data.memberId && window.POS_IS_LAN) { try { await updateRow("Orders", 0, id, { MemberID: data.memberId }); } catch (e) { console.error("member attach:", e); } }
      
      // Auto Deduct Stock Levels based on Recipe Formulation
      try {
        await _deductInventoryForItems(data.items || []);
      } catch(err) { console.error("Stock deduction bypassed:", err); }

      return { success:true, data:{ orderId:id, total, timestamp:now } };
    },
    update: async (data) => {
      const updates = {};
      if (data.status) updates.Status = data.status;
      if (data.items)  updates.Items  = JSON.stringify(data.items);
      if (data.notes)  updates.Notes  = data.notes;
      if (data.memberId !== undefined && window.POS_IS_LAN) updates.MemberID = data.memberId;
      if (data.subtotal !== undefined) updates.Subtotal = data.subtotal;   // totals were silently ignored before
      if (data.tax      !== undefined) updates.Tax      = data.tax;
      if (data.total    !== undefined) updates.Total    = data.total;
      await updateRow("Orders", 0, data.orderId, updates);
      return { success:true, data:{ updated:true } };
    },
  };

  const Menu = {
    getAll: async (category) => {
      const all = await getRows("MenuItems");
      const avail = all.filter(i => String(i.Available).toLowerCase() !== "false");
      return { success:true, data: category ? avail.filter(i => i.Category === category) : avail };
    },
    add: async (data) => {
      const id = uid("MENU");
      await appendRow("MenuItems", [id, data.name, data.category, data.price,
        data.description||"", true, data.prepTime||"", data.emoji||"🍽️"]);
      return { success:true, data:{ itemId:id } };
    },
    update: async (data) => {
      const updates = {};
      if (data.name      !== undefined) updates.Name      = data.name;
      if (data.price     !== undefined) updates.Price     = data.price;
      if (data.available !== undefined) updates.Available = data.available;
      await updateRow("MenuItems", 0, data.itemId, updates);
      return { success:true, data:{ updated:true } };
    },
    delete: async (itemId) => deleteRow("MenuItems", 0, itemId),
  };

  const Tables = {
    getAll: async () => ({ success:true, data: await getRows("Tables") }),
    update: async (data) => {
      const updates = {};
      if (data.status        !== undefined) updates.Status        = data.status;
      if (data.currentWaiter !== undefined) updates.CurrentWaiter = data.currentWaiter;
      if (data.guests        !== undefined) updates.Guests        = data.guests;
      await updateRow("Tables", 1, data.tableNumber, updates);
      return { success:true, data:{ updated:true } };
    },
  };

  const Inventory = {
    getAll: async () => {
      const rows = await getRows("Inventory");
      return { success:true, data: rows.map(item => {
        const q = parseFloat(item.Quantity)||0, r = parseFloat(item.ReorderLevel)||0;
        item.AlertStatus = q<=0?"out":q<=r*.5?"critical":q<=r?"low":"ok";
        return item;
      })};
    },
    update: async (data) => {
      const updates = { LastUpdated: new Date().toISOString() };
      if (data.quantity     !== undefined) updates.Quantity     = data.quantity;
      if (data.reorderLevel !== undefined) updates.ReorderLevel = data.reorderLevel;
      await updateRow("Inventory", 0, data.itemId, updates);
      return { success:true, data:{ updated:true } };
    },
    delete: async (itemId) => deleteRow("Inventory", 0, itemId),
  };

  const Staff = {
    getAll: async () => ({ success:true, data: await getRows("Staff") }),
    add: async (data) => {
      const id = uid("STF");
      await appendRow("Staff", [id, data.name, data.role||"Staff",
        data.email, "active", new Date().toISOString().split("T")[0], true]);
      return { success:true, data:{ staffId:id } };
    },
    verify: async (email) => {
      const list  = await getRows("Staff");
      const found = list.find(s => s.Email && s.Email.toLowerCase() === email.toLowerCase()
                                && String(s.Approved).toLowerCase() === "true");
      return { success:true, data: found ? { approved:true, staff:found } : { approved:false } };
    },
    delete: async (staffId) => deleteRow("Staff", 0, staffId),
  };

  const Drivers = {
    getAll: async () => ({ success:true, data: await getRows("Drivers") }),
    verify: async (email) => {
      const list  = await getRows("Drivers");
      const found = list.find(d => d.Email && d.Email.toLowerCase() === email.toLowerCase()
                                && String(d.Approved).toLowerCase() === "true");
      return { success:true, data: found ? { approved:true, driver:found } : { approved:false } };
    },
    add: async (data) => {
      const id = uid("DRV");
      await appendRow("Drivers", [id, data.name, data.email, data.phone||"",
        data.vehicle||"", data.plate||"", "available", 5.0, 0, true,"","",""]);
      return { success:true, data:{ driverId:id } };
    },
    getOrders: async (email) => {
      const rows = await getRows("Deliveries");
      return { success:true, data: rows.filter(d =>
        d.DriverEmail && d.DriverEmail.toLowerCase() === email.toLowerCase() &&
        !["delivered","cancelled"].includes(d.Status)) };
    },
    update: async (data) => {
      const updates = {};
      if (data.status        !== undefined) updates.Status        = data.status;
      if (data.todayEarnings !== undefined) updates.TodayEarnings = data.todayEarnings;
      await updateRow("Drivers", 0, data.driverId, updates);
      return { success:true, data:{ updated:true } };
    },
  };

  const Deliveries = {
    create: async (data) => {
      const id = uid("DEL");
      await appendRow("Deliveries", [id, data.orderId, data.driverEmail||"",
        data.customerName||"", data.customerAddress, "pending",
        new Date().toISOString(),"",data.distance||"",data.earnings||""]);
      return { success:true, data:{ deliveryId:id } };
    },
    update: async (data) => {
      const updates = {};
      if (data.status)      updates.Status      = data.status;
      if (data.driverEmail) updates.DriverEmail = data.driverEmail;
      if (data.status === "delivered") updates.DeliveredTime = new Date().toISOString();
      await updateRow("Deliveries", 0, data.deliveryId, updates);
      return { success:true, data:{ updated:true } };
    },
  };

  const Recipes = {
    get: async (dish) => {
      const rows = await getRows("Recipes");
      const found = rows.find(r => r.DishName && r.DishName.toLowerCase() === dish.toLowerCase());
      if (!found) return { success:false, error:"Recipe not found" };
      try { found.Steps       = JSON.parse(found.Steps); }       catch(e){}
      try { found.Ingredients = JSON.parse(found.Ingredients); } catch(e){}
      return { success:true, data:found };
    },
    save: async (data) => {
      const rows = await getRows("Recipes");
      const existing = rows.find(r => r.DishName && r.DishName.toLowerCase() === data.dishName.toLowerCase());
      if (existing) {
        await updateRow("Recipes", 1, data.dishName, {
          PrepTime:data.prepTime||"", CookTime:data.cookTime||"",
          Difficulty:data.difficulty||"Medium",
          Ingredients:data.ingredients||"[]", Steps:data.steps||"[]"
        });
        return { success:true, data:{ updated:true } };
      }
      const id = uid("RCP");
      await appendRow("Recipes", [id, data.dishName, data.prepTime||"", data.cookTime||"",
        data.difficulty||"Medium", data.ingredients||"[]", data.steps||"[]"]);
      return { success:true, data:{ created:true } };
    },
  };

  const Team = {
    getRota: async (email, month, year) => {
      const now  = new Date();
      const m    = parseInt(month || now.getMonth()+1);
      const y    = parseInt(year  || now.getFullYear());
      const rows = await getRows("Rota");
      return { success:true, data: rows.filter(r => {
        if (!r.StaffEmail || r.StaffEmail.toLowerCase() !== email.toLowerCase()) return false;
        const d = new Date(r.Date);
        return d.getMonth()+1 === m && d.getFullYear() === y;
      })};
    },
    getClockings: async (email, month) => {
      const now  = new Date();
      const m    = parseInt(month || now.getMonth()+1);
      const y    = now.getFullYear();
      const rows = await getRows("Clockings");
      return { success:true, data: rows.filter(r => {
        if (!r.StaffEmail || r.StaffEmail.toLowerCase() !== email.toLowerCase()) return false;
        const d = new Date(r.Date);
        return d.getMonth()+1 === m && d.getFullYear() === y;
      })};
    },
    getHours: async (email, month, year) => {
      const res  = await Team.getClockings(email, month);
      const done = (res.data||[]).filter(c => c.Status === "out");
      const total = done.reduce((s,c) => s + (parseFloat(c.TotalHours)||0), 0);
      const byWeek = {};
      done.forEach(c => {
        const w = Math.ceil(new Date(c.Date).getDate() / 7);
        byWeek[w] = (byWeek[w]||0) + (parseFloat(c.TotalHours)||0);
      });
      return { success:true, data:{ totalHours:parseFloat(total.toFixed(2)), totalDays:done.length, byWeek }};
    },
    clockIn: async (data) => {
      const today   = new Date().toISOString().split("T")[0];
      const rows    = await getRows("Clockings");
      const already = rows.find(r =>
        r.StaffEmail && r.StaffEmail.toLowerCase() === data.email.toLowerCase() &&
        r.Date === today && r.Status === "in");
      if (already) return { success:true, data:{ error:"Already clocked in", clockingId:already.ClockingID }};
      const id  = uid("CLK");
      const now = new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
      await appendRow("Clockings", [id, data.email, data.name, today, now,"",0,"in",""]);
      return { success:true, data:{ clockingId:id, clockedIn:now, date:today }};
    },
    clockOut: async (data) => {
      const today = new Date().toISOString().split("T")[0];
      const rows  = await getRows("Clockings");
      const idx   = rows.findIndex(r =>
        r.StaffEmail && r.StaffEmail.toLowerCase() === data.email.toLowerCase() &&
        r.Date === today && r.Status === "in");
      if (idx < 0) return { success:true, data:{ error:"No active clock-in" }};
      const row = rows[idx];
      const now = new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
      const inP = row.ClockIn.split(":").map(Number);
      const noP = now.split(":").map(Number);
      const hrs = parseFloat(((noP[0]*60+noP[1]-inP[0]*60-inP[1])/60).toFixed(2));
      await updateRow("Clockings", 0, row.ClockingID, { ClockOut:now, TotalHours:hrs, Status:"out" });
      return { success:true, data:{ clockedOut:now, totalHours:hrs }};
    },
    verify: async (email) => Staff.verify(email),
  };

  const Settings = {
    get: async () => {
      await _loadSettings();
      return { success:true, data:_settings };
    },
    update: async (data) => {
      for (const key of Object.keys(data)) {
        const rows = await getRows("Settings");
        const existing = rows.find(r => r.Key === key);
        if (existing) {
          await updateRow("Settings", 0, existing.Key, { Value: data[key] });
        } else {
          await appendRow("Settings", [key, data[key]]);
        }
      }
      await _loadSettings();
      return { success:true, data:{ updated:true } };
    },
    setPin: async (pin) => Settings.update({ admin_pin: pin }),
    verifyPin: async (pin) => {
      if (LAN) {
        try {
          const r = await _lan("POST", "/api/settings/verify-pin", { pin });
          return { success:true, data:{ verified: !!r.success } };
        } catch (e) { return { success:true, data:{ verified:false } }; }
      }
      await _loadSettings();
      const stored = _settings.admin_pin || "1234";
      return { success:true, data:{ verified: String(pin) === String(stored) }};
    },
  };

  const Analytics = {
    get: async (date) => {
      const rows = await getRows("Analytics");
      return { success:true, data: date ? (rows.find(r => r.Date === date)||{}) : rows.slice(-30) };
    },
  };

  function poll(fn, cb, ms) {
    fn().then(cb);
    return setInterval(() => fn().then(cb), ms || POS_CONFIG.POLL_MS);
  }

  return {
    loadLibraries, signIn, silentSignIn, signOut, getSettings,
    initUserSheet, setLanUser, getRows, appendRow, updateRow, deleteRow, uid,
    Orders, Menu, Tables, Inventory, Staff, Drivers,
    Deliveries, Recipes, Team, Settings, Analytics, poll, getSheetId, getAccessToken, getSession
  };
})();

window.POS_API = window.POS_GAPI;

// ============================================================
// POS_AUTH — Auth gates for each app (uses POS_GAPI)
// ============================================================
window.POS_AUTH = (() => {

  async function init(appId, { onReady, onError } = {}) {
    const mode = POS_CONFIG.ACCESS[appId] || "session";

    if (window.POS_IS_LAN) { return _lanInit(appId, mode, onReady, onError); }

    try {
      await POS_GAPI.loadLibraries();
    } catch(e) {
      onError && onError("Failed to load Google libraries: " + e);
      return;
    }

    if (mode === "public") {
      onReady && onReady(null);
      return;
    }

    const session = POS_GAPI.getSession();

    if (mode === "hub") {
      const saved = _savedSession();
      if (saved) {
        POS_GAPI.silentSignIn(async (s) => {
          if (s) { await POS_GAPI.initUserSheet(); onReady && onReady(POS_GAPI.getSession()); }
          else   { _showSignIn(appId, onReady, onError); }
        });
      } else {
        _showSignIn(appId, onReady, onError);
      }
      return;
    }

    if (mode === "session") {
      const saved = _savedSession();
      if (saved) {
        POS_GAPI.silentSignIn(async (s) => {
          if (s) {
            await POS_GAPI.initUserSheet();
            onReady && onReady(POS_GAPI.getSession());
          } else {
            _showSignIn(appId, onReady, onError);
          }
        });
      } else {
        _showSignIn(appId, onReady, onError);
      }
      return;
    }

    if (mode === "pin") {
      const saved = _savedSession();
      if (!saved) { _showSignIn(appId, onReady, onError); return; }
      POS_GAPI.silentSignIn(async (s) => {
        if (!s) { _showSignIn(appId, onReady, onError); return; }
        await POS_GAPI.initUserSheet();
        _showPinModal(POS_GAPI.getSession(), onReady, onError);
      });
      return;
    }

    if (mode === "driver" || mode === "team") {
      const saved = _savedSession();
      if (saved) {
        POS_GAPI.silentSignIn(async (s) => {
          if (s) {
            await POS_GAPI.initUserSheet();
            onReady && onReady(POS_GAPI.getSession());
          } else {
            _showSignIn(appId, onReady, onError);
          }
        });
      } else {
        _showSignIn(appId, onReady, onError);
      }
      return;
    }
  }

  // ── LAN: no Google sign-in. Floor apps open directly, the Manager Portal asks
  //    for the PIN, the Team App asks "who are you?" from the Staff list. ──
  async function _lanInit(appId, mode, onReady, onError) {
    try {
      if (mode === "public") { onReady && onReady(null); return; }
      await POS_GAPI.initUserSheet();
      if (mode === "pin") { _showPinModal(POS_GAPI.getSession(), onReady, onError); return; }
      if (mode === "team" || mode === "driver") {
        let u = null;
        try { u = JSON.parse(localStorage.getItem("pos_lan_user") || "null"); } catch (e) {}
        if (u && u.email && u.email !== "lan@local") { onReady && onReady(POS_GAPI.getSession()); return; }
        _showStaffPicker(onReady, onError);
        return;
      }
      onReady && onReady(POS_GAPI.getSession());
    } catch (e) {
      onError ? onError("Cannot reach the restaurant server: " + e.message) : alert("Cannot reach the restaurant server: " + e.message);
    }
  }

  async function _showStaffPicker(onReady, onError) {
    const wall = document.createElement("div");
    wall.id = "pos-login-wall";
    wall.style.cssText = "position:fixed;inset:0;background:#07070f;display:flex;align-items:center;justify-content:center;z-index:9999;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:auto;";
    wall.innerHTML = '<div style="text-align:center;padding:24px;max-width:420px;width:100%">' +
      '<div style="font-size:48px;margin-bottom:12px">🧑‍🍳</div>' +
      '<h1 style="color:#fff;font-size:22px;font-weight:900;margin-bottom:6px">Who are you?</h1>' +
      '<p style="color:rgba(255,255,255,.45);font-size:13px;margin-bottom:20px">Tap your name to continue</p>' +
      '<div id="lan-staff-list" style="display:flex;flex-direction:column;gap:10px"></div></div>';
    document.body.appendChild(wall);
    const list = wall.querySelector("#lan-staff-list");
    let staff = [];
    try { staff = await POS_GAPI.getRows("Staff"); } catch (e) {}
    staff = staff.filter(s => s.Name && s.Email && String(s.Status || "active").toLowerCase() === "active");
    if (!staff.length) {
      list.innerHTML = '<div style="color:#f59e0b;font-size:13px">No staff with an email address found. Add staff (with email) in the Manager Portal first.</div>';
      return;
    }
    staff.forEach(s => {
      const b = document.createElement("button");
      b.style.cssText = "background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:#fff;padding:14px;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;";
      b.textContent = s.Name + (s.Role ? "  ·  " + s.Role : "");
      b.onclick = () => {
        POS_GAPI.setLanUser({ email: s.Email, name: s.Name, picture: "" });
        wall.remove();
        onReady && onReady(POS_GAPI.getSession());
      };
      list.appendChild(b);
    });
  }

  function _savedSession() {
    try {
      const raw = localStorage.getItem("pos_session");
      if (!raw) return null;
      const d = JSON.parse(raw);
      return Date.now() - d.ts < 8*3600*1000 ? d : null;
    } catch(e) { return null; }
  }

  function _showSignIn(appId, onReady, onError) {
    const wall = document.createElement("div");
    wall.id = "pos-login-wall";
    wall.style.cssText = `position:fixed;inset:0;background:#07070f;display:flex;
      align-items:center;justify-content:center;z-index:9999;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;`;
    wall.innerHTML = `
      <div style="text-align:center;padding:24px;max-width:360px;width:100%">
        <div style="font-size:56px;margin-bottom:16px">🍽️</div>
        <h1 style="color:#fff;font-size:24px;font-weight:900;margin-bottom:8px">
          ${window.POS_SHOP.name || POS_CONFIG.RESTAURANT_NAME}
        </h1>
        <p style="color:rgba(255,255,255,.4);font-size:14px;margin-bottom:32px">
          Authenticate your restaurant terminal
        </p>
        <button id="gsi-trigger-btn" style="background:#fff; color:#333; border:none;
          padding:12px 24px; border-radius:8px; font-size:15px; font-weight:700;
          cursor:pointer; display:inline-flex; align-items:center; gap:10px;
          box-shadow:0 4px 12px rgba(0,0,0,0.15); transition:background 0.2s;">
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.47h4.84c-.15.79-.6 1.46-1.28 1.92v2.4h2.07c1.21-1.11 1.9-2.75 1.9-4.57z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.07-2.4c-.58.39-1.32.62-2.2.62-1.69 0-3.13-1.14-3.64-2.67H4.72v2.48C6.2 16.92 7.48 18 9 18z"/>
            <path fill="#FBBC05" d="M5.36 11.37c-.13-.39-.2-.8-.2-1.22s.07-.83.2-1.22V6.45H4.72a9 9 0 0 0 0 7.41l.64-2.49z"/>
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.47 1.15 11.43.5 9 .5 7.48.5 6.2 1.58 4.72 2.97l2.48 2.48c.51-1.53 1.95-2.67 3.64-2.67z"/>
          </svg>
          Sign In with Google
        </button>
        <div id="gsi-wall-err" style="color:#e74c3c;font-size:13px;margin-top:16px"></div>
      </div>`;
    document.body.appendChild(wall);

    document.getElementById("gsi-trigger-btn").addEventListener("click", () => {
      document.getElementById("gsi-wall-err").textContent = "Opening Google popup...";
      POS_GAPI.signIn(async (session, err) => {
        if (err || !session) {
          document.getElementById("gsi-wall-err").textContent = "Sign-in failed. Please try again.";
          return;
        }
        if (wall.parentNode) document.body.removeChild(wall);

        if (appId === "index" || appId === "hub") {
          await POS_GAPI.initUserSheet();
        }
        onReady && onReady(session);
      });
    });
  }

  function _showPinModal(session, onReady, onError) {
    const el = document.createElement("div");
    el.id = "pos-pin-overlay";
    el.style.cssText = `position:fixed;inset:0;background:rgba(7,7,15,.95);
      display:flex;align-items:center;justify-content:center;z-index:9999;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;`;
    el.innerHTML = `
      <div style="background:#111827;border:1px solid rgba(255,255,255,.1);border-radius:24px;
        padding:40px 32px;width:320px;text-align:center;box-shadow:0 40px 100px rgba(0,0,0,.7)">
        <div style="font-size:48px;margin-bottom:14px">🔐</div>
        <h2 style="color:#fff;font-size:20px;font-weight:800;margin-bottom:6px">Manager Access</h2>
        <p style="color:rgba(255,255,255,.4);font-size:13px;margin-bottom:28px">
          Signed in as <strong style="color:rgba(255,255,255,.7)">${session.name}</strong><br>
          Enter your 4-digit PIN
        </p>
        <div style="display:flex;justify-content:center;gap:14px;margin-bottom:28px" id="pin-dots">
          ${[0,1,2,3].map(i=>`<div id="pd${i}" style="width:20px;height:20px;border-radius:50%;
            border:2px solid rgba(255,255,255,.2);background:transparent;transition:all .15s"></div>`).join("")}
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px">
          ${[1,2,3,4,5,6,7,8,9,"","0","⌫"].map(k=>`
            <button data-k="${k}" style="padding:15px 0;border-radius:12px;border:1px solid rgba(255,255,255,.08);
              background:rgba(255,255,255,.05);color:#fff;font-size:20px;font-weight:600;
              cursor:${k===""?"default":"pointer"};${k===""?"opacity:0;pointer-events:none;":""}
              transition:background .12s"
              onmousedown="this.style.background='rgba(243,156,18,.25)'"
              onmouseup="this.style.background='rgba(255,255,255,.05)'"
            >${k}</button>`).join("")}
        </div>
        <div id="pin-err" style="color:#e74c3c;font-size:13px;min-height:18px;margin-bottom:14px"></div>
        <button onclick="POS_AUTH.signOut()" style="background:none;border:none;
          color:rgba(255,255,255,.25);font-size:12px;cursor:pointer;text-decoration:underline">
          Sign out
        </button>
      </div>`;
    document.body.appendChild(el);

    let entered = "";
    function updateDots() {
      [0,1,2,3].forEach(i => {
        const d = document.getElementById("pd"+i);
        d.style.background  = i < entered.length ? "#f39c12" : "transparent";
        d.style.borderColor = i < entered.length ? "#f39c12" : "rgba(255,255,255,.2)";
      });
    }

    el.querySelectorAll("[data-k]").forEach(btn => {
      const k = btn.dataset.k;
      if (!k) return;
      btn.addEventListener("click", async () => {
        if (k === "⌫") {
          entered = entered.slice(0,-1);
          document.getElementById("pin-err").textContent = "";
          updateDots(); return;
        }
        if (entered.length >= 4) return;
        entered += k;
        updateDots();
        if (entered.length === 4) {
          const res = await POS_GAPI.Settings.verifyPin(entered);
          if (res.data && res.data.verified) {
            document.body.removeChild(el);
            onReady && onReady(session);
          } else {
            document.getElementById("pin-err").textContent = "Incorrect PIN — try again";
            entered = ""; updateDots();
          }
        }
      });
    });
  }

  function signOut() {
    POS_GAPI.signOut();
  }

  function renderBadge(containerId) {
    const s  = POS_GAPI.getSession();
    const el = document.getElementById(containerId);
    if (!el || !s) return;
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:13px;opacity:.8">${s.name}</span>
        <button onclick="POS_AUTH.signOut()" style="background:rgba(255,255,255,.12);
          border:none;color:rgba(255,255,255,.7);padding:4px 12px;border-radius:10px;
          font-size:12px;cursor:pointer">Sign out</button>
      </div>`;
  }

  function openSheet() {
    if (window.POS_IS_LAN) { alert("The LAN system stores data on the restaurant server. It syncs to Google Sheets automatically."); return; }
    const id = POS_GAPI.getSheetId();
    if (id) {
      window.open("https://docs.google.com/spreadsheets/d/" + id + "/edit", "_blank");
    } else {
      alert("Sheet not connected yet. Please sign in via the Hub first.");
    }
  }

  function refreshApp() {
    window.location.reload();
  }

  function renderUtilBar(containerId, appName) {
    var s = POS_GAPI.getSession();
    var el = document.getElementById(containerId);
    if (!el) return;
    var sheetId = POS_GAPI.getSheetId();
    var sheetBtn = (sheetId && !window.POS_IS_LAN)
      ? '<button onclick="POS_AUTH.openSheet()" style="background:rgba(39,174,96,.15);border:1px solid rgba(39,174,96,.3);color:#27ae60;padding:4px 12px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;">📊 Open Sheet</button>'
      : '';
    el.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
        (window.POS_IS_LAN ? '<span id="pos-live-dot" title="Live connection to the restaurant server" style="font-size:11px;font-weight:700;color:#f59e0b;">● LAN</span>' : '') +
        '<span style="font-size:12px;opacity:.6;">' + (s ? s.name : "") + '</span>' +
        sheetBtn +
        '<button onclick="POS_AUTH.refreshApp()" style="background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.7);padding:4px 12px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;">🔄 Refresh</button>' +
        '<button onclick="POS_AUTH.signOut()" style="background:rgba(255,255,255,.08);border:none;color:rgba(255,255,255,.4);padding:4px 12px;border-radius:8px;font-size:11px;cursor:pointer;">Sign out</button>' +
      '</div>';
  }

  return { init, signOut, renderBadge, renderUtilBar, openSheet, refreshApp };
})();

// ============================================================
// LAN LIVE UPDATES — instant push from the restaurant server.
// Every screen can listen:  window.addEventListener("pos-live", e => reload())
// e.detail = { type: "order.created" | "order.updated" | "menu.updated" | ..., payload }
// (Only active in LAN mode; online mode keeps using the normal polling.)
// ============================================================
(function () {
  if (!window.POS_IS_LAN) return;
  let ws = null, retry = 0;
  function dot(color, title) {
    const d = document.getElementById("pos-live-dot");
    if (d) { d.style.color = color; d.title = title; }
  }
  function connect() {
    try {
      ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
    } catch (e) { return setTimeout(connect, 3000); }
    ws.onopen = () => { retry = 0; dot("#22c55e", "Live"); };
    ws.onmessage = (ev) => {
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg || msg.type === "connected") return;
      window.dispatchEvent(new CustomEvent("pos-live", { detail: msg }));
    };
    ws.onclose = () => { dot("#ef4444", "Reconnecting..."); setTimeout(connect, Math.min(1000 * ++retry, 5000)); };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  }
  // Hide Google-only buttons (Open Sheet) and Google-only tiles in LAN mode.
  const st = document.createElement("style");
  st.textContent = '[onclick*="docs.google.com"],[onclick*="openSheet"],[data-online-only]{display:none !important}';
  (document.head || document.documentElement).appendChild(st);
  connect();
  setInterval(() => dot(ws && ws.readyState === 1 ? "#22c55e" : "#ef4444", ws && ws.readyState === 1 ? "Live" : "Reconnecting..."), 2000);
})();

// Convenience: call fn whenever the server pushes a change (debounced), in
// addition to the app's own polling. Safe to call in online mode (no-op).
window.POS_ONLIVE = function (fn, filter) {
  let t = null;
  window.addEventListener("pos-live", (e) => {
    if (filter && !String(e.detail && e.detail.type || "").startsWith(filter)) return;
    clearTimeout(t);
    t = setTimeout(fn, 120);
  });
};

// ============================================================
// POS_ORDER — one shared definition of "online order" for every app.
// Online orders (Customer App) carry WaiterName "Online Delivery" / "Online Pickup".
// ============================================================
window.POS_ORDER = {
  isOnline(o) { return /^online/i.test(String((o && (o.WaiterName || o.waiterName)) || "")); },
  type(o) {                                   // "delivery" | "pickup" | null (not online)
    if (!this.isOnline(o)) return null;
    const w = String(o.WaiterName || o.waiterName || "");
    const t = parseInt(o.TableNumber, 10);
    return (/deliver/i.test(w) || t === 99) ? "delivery" : "pickup";
  },
  label(o) {                                  // short text for badges
    const t = this.type(o);
    return t === "delivery" ? "🛵 Online Delivery" : t === "pickup" ? "🛍️ Online Pickup" : "";
  },
  address(o) {                                // readable address (never raw GPS)
    const a = String((o && o.CustomerAddress) || "");
    if (a && !/^GPS:/i.test(a)) return a;
    const m = String((o && o.Notes) || "").match(/\[DELIVERY:\s*([^\]]*)\]/i);
    return m ? m[1].trim() : (a ? "Pinned location" : "");
  },
  phone(o) {                                  // Sheets turns "0771234567" into 771234567.0 — undo that
    let p = String((o && o.CustomerPhone) || "").trim().replace(/\.0+$/, "");
    if (/^\d{9}$/.test(p)) p = "0" + p;      // Sri Lankan mobile lost its leading 0
    return p;
  },
  mapLink(o) {
    const n = String((o && o.Notes) || "").match(/\[MAP:\s*([^\]\s]+)\s*\]/i);
    if (n) return n[1];
    const g = String((o && o.CustomerAddress) || "").match(/GPS:\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/i);
    return g ? "https://www.google.com/maps?q=" + g[1] + "," + g[2] : "";
  },
};


// ── Loyalty members + in-app camera scanner (Till / Waiter) ───────────────
// Works only in LAN mode (member list lives on the restaurant laptop). The camera needs
// a secure page: open the app from the https:// address shown in the control panel.
window.POS_MEMBERS = {
  lookup: async function (q) {
    const r = await fetch((window.POS_LAN_BASE || "") + "/api/members/lookup?q=" + encodeURIComponent(q));
    const j = await r.json();
    if (!j.success) throw new Error(j.error || "No member found");
    return j.data;
  },
};
window.POS_SCAN = (function () {
  function loadJsQR() {
    return new Promise(function (res, rej) {
      if (window.jsQR) return res();
      var sc = document.createElement("script"); sc.src = (window.POS_LAN_BASE || "") + "/vendor/jsqr.js";
      sc.onload = function () { res(); }; sc.onerror = function () { rej(new Error("scanner library missing")); };
      document.head.appendChild(sc);
    });
  }
  // opts: { title, onResult(text) -> may return a Promise; throw/reject to show an error and keep scanning }
  function open(opts) {
    opts = opts || {};
    var stream = null, stopped = false, busy = false, timer = null;
    var ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.88);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;font-family:system-ui,sans-serif;color:#fff";
    ov.innerHTML = '<div style="font-size:18px;font-weight:700;margin-bottom:8px"></div>'
      + '<div style="position:relative;width:min(92vw,420px);aspect-ratio:1/1;background:#000;border-radius:16px;overflow:hidden;border:2px solid #f5a623">'
      + '<video playsinline muted style="width:100%;height:100%;object-fit:cover"></video>'
      + '<div style="position:absolute;inset:18%;border:3px solid rgba(255,255,255,.8);border-radius:14px;pointer-events:none"></div></div>'
      + '<div class="msg" style="min-height:44px;margin:10px 0;text-align:center;font-size:14px;max-width:420px"></div>'
      + '<div style="display:flex;gap:8px;width:min(92vw,420px)"><input class="man" placeholder="Or type phone / member ID" style="flex:1;padding:12px;border-radius:10px;border:none;font-size:16px"><button class="go" style="padding:12px 16px;border:none;border-radius:10px;background:#f5a623;font-weight:700;font-size:15px">Find</button></div>'
      + '<button class="x" style="margin-top:14px;padding:12px 28px;border:none;border-radius:10px;background:#444;color:#fff;font-size:15px">Close</button>';
    ov.firstChild.textContent = opts.title || "Scan customer QR";
    document.body.appendChild(ov);
    var video = ov.querySelector("video"), msg = ov.querySelector(".msg");
    function say(t, bad) { msg.textContent = t; msg.style.color = bad ? "#ff8a80" : "#fff"; }
    function close() { stopped = true; clearInterval(timer); try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} ov.remove(); }
    async function handle(text) {
      if (busy || stopped) return; busy = true;
      try { await opts.onResult(text); close(); }
      catch (e) { say(e.message || "Not found", true); setTimeout(function () { busy = false; }, 1500); }
    }
    ov.querySelector(".x").onclick = close;
    ov.querySelector(".go").onclick = function () { var v = ov.querySelector(".man").value.trim(); if (v) handle(v); };
    ov.querySelector(".man").onkeydown = function (e) { if (e.key === "Enter") ov.querySelector(".go").click(); };

    (async function () {
      if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        say("Camera is blocked on this address. Open the app from the secure https:// address shown in the control panel (see “Camera scanner” there). You can still type the phone or member ID below.", true); return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      } catch (e) { say("Camera not allowed (" + (e.name || "error") + "). Allow the camera in the browser, or type the phone / member ID below.", true); return; }
      if (stopped) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      video.srcObject = stream; try { await video.play(); } catch (e) {}
      say("Point the camera at the customer's QR code");
      var det = null;
      if (window.BarcodeDetector) { try { det = new BarcodeDetector({ formats: ["qr_code", "code_128", "ean_13", "code_39"] }); } catch (e) { det = null; } }
      if (!det) { try { await loadJsQR(); } catch (e) { say("Scanner unavailable — type the phone / member ID below.", true); return; } }
      var cv = document.createElement("canvas"), cx = cv.getContext("2d", { willReadFrequently: true });
      timer = setInterval(async function () {
        if (stopped || busy || video.readyState < 2) return;
        try {
          if (det) { var codes = await det.detect(video); if (codes.length) handle(codes[0].rawValue); }
          else {
            var w = video.videoWidth, h = video.videoHeight; if (!w) return;
            var sc = Math.min(1, 640 / w); cv.width = Math.round(w * sc); cv.height = Math.round(h * sc);
            cx.drawImage(video, 0, 0, cv.width, cv.height);
            var r = window.jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
            if (r && r.data) handle(r.data);
          }
        } catch (e) {}
      }, 250);
    })();
    return { close: close };
  }
  return { open: open };
})();
