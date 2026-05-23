// ============================================================
// apps-script-api.gs  —  Grand Table POS  —  Complete Backend
// 1. Go to sheet → Extensions → Apps Script
// 2. Paste this entire file, replacing all existing code
// 3. Run setupSystem() ONCE manually (▶ button) to create folder + sheets
// 4. Deploy → New Deployment → Web App
//    Execute as: Me | Access: Anyone
// 5. Copy the Web App URL into pos-config.js
// ============================================================

// ── Storage keys (PropertiesService) ──────────────────────
const PROP_SHEET_ID  = "SHEET_ID";
const PROP_FOLDER_ID = "FOLDER_ID";
const PROP_PIN       = "ADMIN_PIN";
const PROP_SETUP     = "SETUP_DONE";

// ── Sheet tab names ───────────────────────────────────────
const S = {
  ORDERS     : "Orders",
  MENU       : "MenuItems",
  TABLES     : "Tables",
  INVENTORY  : "Inventory",
  STAFF      : "Staff",
  RECIPES    : "Recipes",
  DELIVERIES : "Deliveries",
  DRIVERS    : "Drivers",
  ANALYTICS  : "Analytics",
  SETTINGS   : "Settings",
  ROTA       : "Rota",
  CLOCKINGS  : "Clockings",
};

// ─────────────────────────────────────────────────────────
//  AUTO SETUP  —  run this ONCE manually before deploying
// ─────────────────────────────────────────────────────────
function setupSystem() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(PROP_SETUP) === "true") {
    Logger.log("✅ Already set up. Sheet ID: " + props.getProperty(PROP_SHEET_ID));
    return;
  }

  Logger.log("🚀 Starting Grand Table POS setup...");

  // 1. Create folder in root of admin's Drive
  const folder = DriveApp.createFolder("Grand Table POS");
  props.setProperty(PROP_FOLDER_ID, folder.getId());
  Logger.log("📁 Folder created: " + folder.getId());

  // 2. Create spreadsheet inside that folder
  const ss = SpreadsheetApp.create("Grand Table POS — Database");
  const ssFile = DriveApp.getFileById(ss.getId());
  folder.addFile(ssFile);
  DriveApp.getRootFolder().removeFile(ssFile); // move out of root
  props.setProperty(PROP_SHEET_ID, ss.getId());
  Logger.log("📊 Spreadsheet created: " + ss.getId());

  // 3. Build all tabs
  _buildSheets(ss);

  // 4. Set default admin PIN
  props.setProperty(PROP_PIN, "1234");

  // 5. Mark setup complete
  props.setProperty(PROP_SETUP, "true");

  Logger.log("✅ Setup complete!");
  Logger.log("📋 Spreadsheet ID: " + ss.getId());
  Logger.log("🔑 Default admin PIN: 1234  — change this in Manager Portal → Settings");
}

function _buildSheets(ss) {
  // Remove the default blank sheet
  const def = ss.getSheets()[0];

  const tabs = [
    { name: S.ORDERS,     headers: ["OrderID","TableNumber","CustomerName","WaiterName","Items","Subtotal","Tax","Total","Status","OrderTime","Notes"] },
    { name: S.MENU,       headers: ["ItemID","Name","Category","Price","Description","Available","PrepTime","Emoji"] },
    { name: S.TABLES,     headers: ["TableID","TableNumber","Capacity","Status","CurrentWaiter","Guests","OpenedAt"] },
    { name: S.INVENTORY,  headers: ["ItemID","Name","Unit","Quantity","ReorderLevel","LastUpdated","Supplier","Cost"] },
    { name: S.STAFF,      headers: ["StaffID","Name","Role","Email","Status","JoinDate"] },
    { name: S.RECIPES,    headers: ["RecipeID","DishName","PrepTime","CookTime","Difficulty","Ingredients","Steps"] },
    { name: S.DELIVERIES, headers: ["DeliveryID","OrderID","DriverEmail","CustomerName","CustomerAddress","Status","PickupTime","DeliveredTime","Distance","Earnings"] },
    { name: S.DRIVERS,    headers: ["DriverID","Name","Email","Phone","Vehicle","PlateNumber","Status","Rating","TodayEarnings","Approved"] },
    { name: S.ANALYTICS,  headers: ["Date","TotalRevenue","OrderCount","AvgOrderValue","TopItem","PeakHour"] },
    { name: S.SETTINGS,   headers: ["Key","Value"] },
    { name: S.ROTA,       headers: ["RotaID","StaffEmail","StaffName","Date","ShiftStart","ShiftEnd","Role","Location","Notes","Status"] },
    { name: S.CLOCKINGS,  headers: ["ClockingID","StaffEmail","StaffName","Date","ClockIn","ClockOut","TotalHours","Status","Notes"] },
  ];

  tabs.forEach(tab => {
    const sheet = ss.insertSheet(tab.name);
    const hRange = sheet.getRange(1, 1, 1, tab.headers.length);
    hRange.setValues([tab.headers]);
    hRange.setBackground("#1a1a2e").setFontColor("#ffffff").setFontWeight("bold");
    sheet.setFrozenRows(1);
  });

  // Seed Settings
  const settingsSheet = ss.getSheetByName(S.SETTINGS);
  settingsSheet.appendRow(["restaurant_name", "The Grand Table"]);
  settingsSheet.appendRow(["currency",         "£"]);
  settingsSheet.appendRow(["tax_rate",         "0.10"]);
  settingsSheet.appendRow(["delivery_fee",     "2.50"]);
  settingsSheet.appendRow(["admin_email",      Session.getActiveUser().getEmail()]);

  // Seed sample Tables
  const tableSheet = ss.getSheetByName(S.TABLES);
  for (let i = 1; i <= 12; i++) {
    tableSheet.appendRow(["TBL-" + i, i, i <= 4 ? 2 : i <= 8 ? 4 : 6, "available", "", 0, ""]);
  }

  // Seed sample Menu
  const menuSheet = ss.getSheetByName(S.MENU);
  const menuSeed = [
    ["MENU-1","Burger Deluxe","Main Course",12.99,"Beef, cheddar, special sauce, fries",true,"12 min","🍔"],
    ["MENU-2","Fish & Chips","Main Course",13.99,"Beer-battered cod with tartare sauce",true,"15 min","🐟"],
    ["MENU-3","Ribeye Steak","Main Course",24.99,"8oz ribeye, choice of sides",true,"18 min","🥩"],
    ["MENU-4","Pasta Carbonara","Main Course",11.99,"Creamy bacon and parmesan",true,"12 min","🍝"],
    ["MENU-5","Caesar Salad","Main Course",9.99,"Romaine, parmesan, croutons",true,"5 min","🥗"],
    ["MENU-6","Spring Rolls","Appetizers",6.99,"Crispy vegetable rolls",true,"8 min","🥢"],
    ["MENU-7","Chicken Wings","Appetizers",8.99,"Buffalo or BBQ — 6 pcs",true,"12 min","🍗"],
    ["MENU-8","Garlic Bread","Appetizers",4.99,"Toasted with cheese",true,"5 min","🥖"],
    ["MENU-9","Chocolate Cake","Desserts",6.99,"Rich dark chocolate with cream",true,"2 min","🎂"],
    ["MENU-10","Ice Cream","Desserts",4.99,"Three scoops, choice of flavour",true,"2 min","🍦"],
    ["MENU-11","Coca Cola","Beverages",2.99,"Regular or Diet",true,"1 min","🥤"],
    ["MENU-12","Fresh Juice","Beverages",4.99,"Orange, apple or mixed berry",true,"3 min","🍊"],
    ["MENU-13","Coffee","Beverages",2.49,"Espresso, latte, cappuccino",true,"4 min","☕"],
    ["MENU-14","Water","Beverages",0,"Still or sparkling",true,"1 min","💧"],
  ];
  menuSeed.forEach(r => menuSheet.appendRow(r));

  // Delete default blank sheet
  try { ss.deleteSheet(def); } catch(e) {}

  Logger.log("📋 All sheets created and seeded.");
}

// ─────────────────────────────────────────────────────────
//  HTTP ROUTER
// ─────────────────────────────────────────────────────────
function doGet(e) {
  const p = e.parameter;
  try {
    switch(p.action) {
      case "getOrders":       return _ok(getOrders(p.status));
      case "getMenu":         return _ok(getMenu(p.category));
      case "getTables":       return _ok(getTables());
      case "getInventory":    return _ok(getInventory());
      case "getDrivers":      return _ok(getDrivers());
      case "getDriverOrders": return _ok(getDriverOrders(p.email));
      case "getAnalytics":    return _ok(getAnalytics(p.date));
      case "getSettings":     return _ok(getSettings());
      case "getDriverLocations": return _ok(getDriverLocations());
      case "getRota":         return _ok(getRota(p.email, p.month, p.year));
      case "getClockings":    return _ok(getClockings(p.email, p.month));
      case "getHours":        return _ok(getHours(p.email, p.month, p.year));
      case "getRecipe":       return _ok(getRecipe(p.dish));
      default: return _err("Unknown GET action: " + p.action);
    }
  } catch(e) { return _err(e.message); }
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  try {
    switch(body.action) {
      case "verifyPin":            return _ok(verifyPin(body.pin));
      case "setPin":               return _ok(setPin(body.pin));
      case "verifyDriver":         return _ok(verifyDriver(body.email));
      case "verifyTeamMember":    return _ok(verifyTeamMember(body.email));
      case "addApprovedDriver":    return _ok(addApprovedDriver(body.data));
      case "removeApprovedDriver": return _ok(removeApprovedDriver(body.email));
      case "createOrder":          return _ok(createOrder(body.data));
      case "updateOrder":          return _ok(updateOrder(body.data));
      case "updateTable":          return _ok(updateTable(body.data));
      case "addMenuItem":          return _ok(addMenuItem(body.data));
      case "updateMenuItem":       return _ok(updateMenuItem(body.data));
      case "updateInventory":      return _ok(updateInventory(body.data));
      case "createDelivery":       return _ok(createDelivery(body.data));
      case "updateDelivery":       return _ok(updateDelivery(body.data));
      case "updateDriver":         return _ok(updateDriverData(body.data));
      case "updateSettings":       return _ok(updateSettings(body.data));
      case "updateDriverLocation":  return _ok(updateDriverLocation(body.data));
      case "clockIn":              return _ok(clockIn(body.data));
      case "saveRecipe":           return _ok(saveRecipe(body.data));
      case "clockOut":             return _ok(clockOut(body.data));
      case "addTeamMember":        return _ok(addTeamMember(body.data));
      case "removeTeamMember":     return _ok(removeTeamMember(body.email));
      case "saveRota":             return _ok(saveRota(body.data));
      default: return _err("Unknown POST action: " + body.action);
    }
  } catch(e) { return _err(e.message); }
}

// ─────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────
function _ss()  { return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty(PROP_SHEET_ID)); }
function _sh(n) { return _ss().getSheetByName(n); }
function _ok(d) { return ContentService.createTextOutput(JSON.stringify({ success:true, data:d })).setMimeType(ContentService.MimeType.JSON); }
function _err(m){ return ContentService.createTextOutput(JSON.stringify({ success:false, error:m })).setMimeType(ContentService.MimeType.JSON); }
function _uid(p){ return p + "-" + Date.now() + "-" + Math.floor(Math.random()*9000+1000); }

function _rows(sheetName) {
  const sh = _sh(sheetName);
  const vals = sh.getDataRange().getValues();
  if (vals.length < 2) return [];
  const headers = vals[0];
  return vals.slice(1)
    .filter(r => r[0] !== "")
    .map(r => { const o={}; headers.forEach((h,i) => o[h]=r[i]); return o; });
}

function _findRow(sheetName, colIndex, value) {
  const vals = _sh(sheetName).getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][colIndex]) === String(value)) return i + 1;
  }
  return -1;
}

function _updateRow(sheetName, colIndex, idValue, updates) {
  const sh      = _sh(sheetName);
  const vals    = sh.getDataRange().getValues();
  const headers = vals[0];
  const rowIdx  = _findRow(sheetName, colIndex, idValue);
  if (rowIdx === -1) throw new Error("Row not found: " + idValue);
  const rowObj = {};
  headers.forEach((h,i) => rowObj[h] = vals[rowIdx-1][i]);
  Object.assign(rowObj, updates);
  sh.getRange(rowIdx, 1, 1, headers.length).setValues([headers.map(h => rowObj[h])]);
  return rowObj;
}

// ─────────────────────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────────────────────
function verifyPin(pin) {
  const stored = PropertiesService.getScriptProperties().getProperty(PROP_PIN) || "1234";
  return { verified: String(pin) === String(stored) };
}

function setPin(pin) {
  if (!/^\d{4}$/.test(String(pin))) throw new Error("PIN must be exactly 4 digits");
  PropertiesService.getScriptProperties().setProperty(PROP_PIN, String(pin));
  return { updated: true };
}

// Driver: check if email is in approved Drivers list
function verifyDriver(email) {
  const drivers = _rows(S.DRIVERS);
  const driver  = drivers.find(d =>
    d.Email.toLowerCase() === email.toLowerCase() &&
    String(d.Approved).toLowerCase() === "true"
  );
  if (!driver) return { approved: false };
  return { approved: true, driver };
}

function addApprovedDriver(data) {
  const sh = _sh(S.DRIVERS);
  const id = _uid("DRV");
  sh.appendRow([id, data.name, data.email, data.phone||"", data.vehicle||"", data.plate||"", "available", 5.0, 0, true]);
  return { driverId: id };
}

function removeApprovedDriver(email) {
  const drivers = _rows(S.DRIVERS);
  const driver  = drivers.find(d => d.Email.toLowerCase() === email.toLowerCase());
  if (!driver) throw new Error("Driver not found");
  return _updateRow(S.DRIVERS, 2, email, { Approved: false, Status: "inactive" });
}

// ─────────────────────────────────────────────────────────
//  ORDERS
// ─────────────────────────────────────────────────────────
function getOrders(status) {
  const all = _rows(S.ORDERS);
  const out = status ? all.filter(o => o.Status === status) : all;
  out.sort((a,b) => new Date(b.OrderTime) - new Date(a.OrderTime));
  return out;
}

function createOrder(d) {
  const sh      = _sh(S.ORDERS);
  const orderId = _uid("ORD");
  const now     = new Date().toISOString();
  const sub     = d.subtotal || d.total || 0;
  const tax     = +(sub * 0.10).toFixed(2);
  const total   = +(sub + tax).toFixed(2);

  sh.appendRow([orderId, d.tableNumber, d.customerName||"", d.waiterName||"",
    JSON.stringify(d.items), sub, tax, total, "new", now, d.notes||""]);

  if (d.tableNumber) {
    try { updateTable({ tableNumber:d.tableNumber, status:"occupied", currentWaiter:d.waiterName||"", guests:d.guests||0, openedAt:now }); }
    catch(e) { Logger.log("Table update skipped: " + e.message); }
  }

  _bumpAnalytics(total);
  return { orderId, total, timestamp: now };
}

function updateOrder(d) {
  const result = _updateRow(S.ORDERS, 0, d.orderId, {
    ...(d.status && { Status: d.status }),
    ...(d.items  && { Items:  JSON.stringify(d.items) }),
    ...(d.notes  && { Notes:  d.notes }),
  });
  if (d.status === "served" || d.status === "closed") {
    try { updateTable({ tableNumber: result.TableNumber, status:"available", currentWaiter:"", guests:0, openedAt:"" }); }
    catch(e) {}
  }
  return { updated: true };
}

// ─────────────────────────────────────────────────────────
//  TABLES
// ─────────────────────────────────────────────────────────
function getTables() { return _rows(S.TABLES); }

function updateTable(d) {
  const sh   = _sh(S.TABLES);
  const vals = sh.getDataRange().getValues();
  const hdrs = vals[0];
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][1]) === String(d.tableNumber)) {
      const obj = {}; hdrs.forEach((h,j) => obj[h] = vals[i][j]);
      if (d.status        !== undefined) obj.Status        = d.status;
      if (d.currentWaiter !== undefined) obj.CurrentWaiter = d.currentWaiter;
      if (d.guests        !== undefined) obj.Guests        = d.guests;
      if (d.openedAt      !== undefined) obj.OpenedAt      = d.openedAt;
      sh.getRange(i+1,1,1,hdrs.length).setValues([hdrs.map(h=>obj[h])]);
      return { updated: true };
    }
  }
  throw new Error("Table not found: " + d.tableNumber);
}

// ─────────────────────────────────────────────────────────
//  MENU
// ─────────────────────────────────────────────────────────
function getMenu(category) {
  const all = _rows(S.MENU).filter(i => String(i.Available).toLowerCase() !== "false");
  return category ? all.filter(i => i.Category === category) : all;
}

function addMenuItem(d) {
  const id = _uid("MENU");
  _sh(S.MENU).appendRow([id, d.name, d.category, d.price, d.description||"", true, d.prepTime||"", d.emoji||"🍽️"]);
  return { itemId: id };
}

function updateMenuItem(d) {
  return _updateRow(S.MENU, 0, d.itemId, {
    ...(d.name        && { Name:        d.name }),
    ...(d.price       && { Price:       d.price }),
    ...(d.category    && { Category:    d.category }),
    ...(d.description && { Description: d.description }),
    ...(d.available   !== undefined && { Available: d.available }),
    ...(d.emoji       && { Emoji:       d.emoji }),
  });
}

// ─────────────────────────────────────────────────────────
//  INVENTORY
// ─────────────────────────────────────────────────────────
function getInventory() {
  return _rows(S.INVENTORY).map(item => ({
    ...item,
    AlertStatus: +item.Quantity <= 0 ? "out"
      : +item.Quantity <= +item.ReorderLevel * 0.5 ? "critical"
      : +item.Quantity <= +item.ReorderLevel ? "low"
      : "ok"
  }));
}

function updateInventory(d) {
  const result = _updateRow(S.INVENTORY, 0, d.itemId, {
    ...(d.quantity     !== undefined && { Quantity:     d.quantity }),
    ...(d.reorderLevel !== undefined && { ReorderLevel: d.reorderLevel }),
    LastUpdated: new Date().toISOString(),
  });
  if (+result.Quantity <= +result.ReorderLevel) {
    _sendLowStockAlert(result.Name, result.Quantity, result.Unit);
  }
  return { updated: true };
}

// ─────────────────────────────────────────────────────────
//  DRIVERS & DELIVERIES
// ─────────────────────────────────────────────────────────
function getDrivers() {
  return _rows(S.DRIVERS).map(({ ...d }) => d); // don't strip anything sensitive here
}

function getDriverOrders(email) {
  return _rows(S.DELIVERIES).filter(d =>
    d.DriverEmail.toLowerCase() === email.toLowerCase() &&
    !["delivered","cancelled"].includes(d.Status)
  );
}

function createDelivery(d) {
  const id  = _uid("DEL");
  const now = new Date().toISOString();
  _sh(S.DELIVERIES).appendRow([id, d.orderId, d.driverEmail||"", d.customerName||"",
    d.customerAddress, "pending", now, "", d.distance||"", d.earnings||""]);
  return { deliveryId: id };
}

function updateDelivery(d) {
  const updates = { ...(d.status && { Status: d.status }), ...(d.driverEmail && { DriverEmail: d.driverEmail }) };
  if (d.status === "delivered") updates.DeliveredTime = new Date().toISOString();
  return _updateRow(S.DELIVERIES, 0, d.deliveryId, updates);
}

function updateDriverData(d) {
  return _updateRow(S.DRIVERS, 0, d.driverId, {
    ...(d.status        && { Status:        d.status }),
    ...(d.rating        && { Rating:        d.rating }),
    ...(d.todayEarnings !== undefined && { TodayEarnings: d.todayEarnings }),
  });
}

// ─────────────────────────────────────────────────────────
//  RECIPES
// ─────────────────────────────────────────────────────────
function getRecipe(dish) {
  const all = _rows(S.RECIPES);
  const r   = all.find(x => x.DishName.toLowerCase() === (dish||"").toLowerCase());
  if (!r) throw new Error("Recipe not found: " + dish);
  try { r.Steps = JSON.parse(r.Steps); } catch(e) {}
  try { r.Ingredients = JSON.parse(r.Ingredients); } catch(e) {}
  return r;
}

// ─────────────────────────────────────────────────────────
//  ANALYTICS
// ─────────────────────────────────────────────────────────
function getAnalytics(date) {
  const all = _rows(S.ANALYTICS);
  if (date) return all.find(r => r.Date === date) || {};
  return all.slice(-30);
}

function _bumpAnalytics(orderTotal) {
  const sh    = _sh(S.ANALYTICS);
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const vals  = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][0] === today) {
      const rev   = +(vals[i][1]||0) + +orderTotal;
      const cnt   = +(vals[i][2]||0) + 1;
      sh.getRange(i+1,2).setValue(rev);
      sh.getRange(i+1,3).setValue(cnt);
      sh.getRange(i+1,4).setValue(+(rev/cnt).toFixed(2));
      return;
    }
  }
  sh.appendRow([today, +orderTotal, 1, +orderTotal, "", ""]);
}

// ─────────────────────────────────────────────────────────
//  SETTINGS
// ─────────────────────────────────────────────────────────
function getSettings() {
  const rows = _rows(S.SETTINGS);
  const out  = {};
  rows.forEach(r => out[r.Key] = r.Value);
  return out;
}

function updateSettings(d) {
  const sh   = _sh(S.SETTINGS);
  const vals = sh.getDataRange().getValues();
  Object.entries(d).forEach(([key, value]) => {
    let found = false;
    for (let i = 1; i < vals.length; i++) {
      if (vals[i][0] === key) { sh.getRange(i+1,2).setValue(value); found=true; break; }
    }
    if (!found) sh.appendRow([key, value]);
  });
  return { updated: true };
}

// ─────────────────────────────────────────────────────────
//  EMAIL ALERTS
// ─────────────────────────────────────────────────────────
function _sendLowStockAlert(name, qty, unit) {
  try {
    const email = Session.getActiveUser().getEmail();
    MailApp.sendEmail(email,
      `⚠️ Low Stock: ${name}`,
      `${name} is running low.\nCurrent stock: ${qty} ${unit}\n\n— Grand Table POS`
    );
  } catch(e) { Logger.log("Email alert failed: " + e.message); }
}


// ─────────────────────────────────────────────────────────
//  TEAM — Staff Rota, Clockings, Hours
// ─────────────────────────────────────────────────────────

function verifyTeamMember(email) {
  const staff = _rows(S.STAFF);
  const member = staff.find(s =>
    s.Email && s.Email.toLowerCase() === email.toLowerCase() &&
    String(s.Approved).toLowerCase() === "true"
  );
  if (!member) return { approved: false };
  return { approved: true, staff: member };
}

function addTeamMember(d) {
  // Add or update staff record with Approved=true
  const staff = _rows(S.STAFF);
  const existing = staff.find(s => s.Email && s.Email.toLowerCase() === d.email.toLowerCase());
  if (existing) {
    return _updateRow(S.STAFF, 3, d.email, { Approved: true, Status: "active" });
  }
  const sh = _sh(S.STAFF);
  const id = _uid("STF");
  sh.appendRow([id, d.name, d.role||"Staff", d.email, "active",
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"), true]);
  return { staffId: id };
}

function removeTeamMember(email) {
  return _updateRow(S.STAFF, 3, email, { Approved: false, Status: "inactive" });
}

// Get rota for a staff member for a given month/year
function getRota(email, month, year) {
  const now  = new Date();
  const m    = parseInt(month || now.getMonth() + 1);
  const y    = parseInt(year  || now.getFullYear());
  const all  = _rows(S.ROTA);
  return all.filter(r => {
    if (!r.StaffEmail) return false;
    if (r.StaffEmail.toLowerCase() !== email.toLowerCase()) return false;
    const d = new Date(r.Date);
    return d.getMonth() + 1 === m && d.getFullYear() === y;
  });
}

// Save/update a rota entry (manager use)
function saveRota(d) {
  if (d.rotaId) {
    return _updateRow(S.ROTA, 0, d.rotaId, {
      Date: d.date, ShiftStart: d.shiftStart, ShiftEnd: d.shiftEnd,
      Role: d.role||"", Notes: d.notes||"", Status: d.status||"confirmed"
    });
  }
  const sh = _sh(S.ROTA);
  const id = _uid("ROT");
  sh.appendRow([id, d.staffEmail, d.staffName, d.date,
    d.shiftStart, d.shiftEnd, d.role||"", d.location||"", d.notes||"", d.status||"confirmed"]);
  return { rotaId: id };
}

// Clock In
function clockIn(d) {
  // Check if already clocked in today
  const today    = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const existing = _rows(S.CLOCKINGS).find(c =>
    c.StaffEmail.toLowerCase() === d.email.toLowerCase() &&
    c.Date === today && c.Status === "in"
  );
  if (existing) return { error: "Already clocked in", clockingId: existing.ClockingID };

  const sh  = _sh(S.CLOCKINGS);
  const id  = _uid("CLK");
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "HH:mm");
  sh.appendRow([id, d.email, d.name, today, now, "", 0, "in", ""]);
  return { clockingId: id, clockedIn: now, date: today };
}

// Clock Out
function clockOut(d) {
  const today  = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const sh     = _sh(S.CLOCKINGS);
  const vals   = sh.getDataRange().getValues();
  const hdrs   = vals[0];

  for (let i = 1; i < vals.length; i++) {
    const row = vals[i];
    // col 1=StaffEmail, col 3=Date, col 7=Status
    if (row[1].toLowerCase() === d.email.toLowerCase() &&
        row[3] === today && row[7] === "in") {
      const nowStr   = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "HH:mm");
      const inTime   = row[4]; // ClockIn
      const inParts  = inTime.split(":").map(Number);
      const nowTime  = new Date();
      const nowParts = nowStr.split(":").map(Number);
      const hours    = +((nowParts[0]*60 + nowParts[1] - inParts[0]*60 - inParts[1]) / 60).toFixed(2);
      sh.getRange(i+1, 6).setValue(nowStr);
      sh.getRange(i+1, 7).setValue(hours);
      sh.getRange(i+1, 8).setValue("out");
      return { clockedOut: nowStr, totalHours: hours };
    }
  }
  return { error: "No active clock-in found for today" };
}

// Get clockings for a month
function getClockings(email, month) {
  const now = new Date();
  const m   = parseInt(month || now.getMonth() + 1);
  const y   = now.getFullYear();
  const all = _rows(S.CLOCKINGS);
  return all.filter(c => {
    if (!c.StaffEmail || c.StaffEmail.toLowerCase() !== email.toLowerCase()) return false;
    const d = new Date(c.Date);
    return d.getMonth() + 1 === m && d.getFullYear() === y;
  });
}

// Monthly hours summary
function getHours(email, month, year) {
  const now = new Date();
  const m   = parseInt(month || now.getMonth() + 1);
  const y   = parseInt(year  || now.getFullYear());
  const clockings = getClockings(email, m).filter(c => c.Status === "out");
  const totalHours = clockings.reduce((sum, c) => sum + (parseFloat(c.TotalHours)||0), 0);
  const byWeek = {};
  clockings.forEach(c => {
    const d = new Date(c.Date);
    const week = Math.ceil(d.getDate() / 7);
    if (!byWeek[week]) byWeek[week] = 0;
    byWeek[week] += parseFloat(c.TotalHours)||0;
  });
  return {
    month: m, year: y, email,
    totalHours: +totalHours.toFixed(2),
    totalDays : clockings.length,
    byWeek,
    clockings,
  };
}


// ─────────────────────────────────────────────────────────
//  DRIVER LOCATION TRACKING
// ─────────────────────────────────────────────────────────

// Saves driver GPS position into Drivers sheet so manager map can show live positions.
// Drivers sheet must have columns: Lat, Lng, LastSeen (add if missing).
function updateDriverLocation(d) {
  var sh   = _sh(S.DRIVERS);
  var vals = sh.getDataRange().getValues();
  var hdrs = vals[0];

  // Ensure Lat/Lng/LastSeen columns exist
  ["Lat","Lng","LastSeen"].forEach(function(col) {
    if (hdrs.indexOf(col) === -1) {
      var newCol = hdrs.length + 1;
      sh.getRange(1, newCol).setValue(col);
      hdrs.push(col);
    }
  });

  var latIdx      = hdrs.indexOf("Lat");
  var lngIdx      = hdrs.indexOf("Lng");
  var lastSeenIdx = hdrs.indexOf("LastSeen");
  var emailIdx    = hdrs.indexOf("Email");

  for (var i = 1; i < vals.length; i++) {
    if (vals[i][emailIdx] && vals[i][emailIdx].toLowerCase() === d.email.toLowerCase()) {
      sh.getRange(i+1, latIdx+1).setValue(d.lat);
      sh.getRange(i+1, lngIdx+1).setValue(d.lng);
      sh.getRange(i+1, lastSeenIdx+1).setValue(d.ts || new Date().toISOString());
      return { updated: true, email: d.email };
    }
  }
  return { error: "Driver not found: " + d.email };
}

// Get all driver locations for manager map view
function getDriverLocations() {
  var drivers = _rows(S.DRIVERS);
  return drivers
    .filter(function(d) { return d.Lat && d.Lng && d.Approved === true; })
    .map(function(d) {
      return { name: d.Name, email: d.Email, lat: d.Lat, lng: d.Lng,
               lastSeen: d.LastSeen, status: d.Status };
    });
}


// Improved saveRecipe — upserts by DishName
function saveRecipe(d) {
  var sh   = _sh(S.RECIPES);
  var vals = sh.getDataRange().getValues();
  var hdrs = vals[0];
  var nameIdx = hdrs.indexOf("DishName");

  // Find existing row for this dish
  for (var i = 1; i < vals.length; i++) {
    if (vals[i][nameIdx] && vals[i][nameIdx].toLowerCase() === d.dishName.toLowerCase()) {
      // Update existing row
      var rowObj = {};
      hdrs.forEach(function(h,j){ rowObj[h] = vals[i][j]; });
      if (d.prepTime)    rowObj.PrepTime    = d.prepTime;
      if (d.cookTime)    rowObj.CookTime    = d.cookTime;
      if (d.difficulty)  rowObj.Difficulty  = d.difficulty;
      if (d.ingredients) rowObj.Ingredients = d.ingredients;
      if (d.steps)       rowObj.Steps       = d.steps;
      sh.getRange(i+1, 1, 1, hdrs.length).setValues([hdrs.map(function(h){ return rowObj[h]; })]);
      return { updated: true, dishName: d.dishName };
    }
  }

  // Insert new row
  var id = _uid("RCP");
  sh.appendRow([
    id,
    d.dishName,
    d.prepTime    || "",
    d.cookTime    || "",
    d.difficulty  || "Medium",
    d.ingredients || "[]",
    d.steps       || "[]",
  ]);
  return { created: true, recipeId: id, dishName: d.dishName };
}

// ─────────────────────────────────────────────────────────
//  SCHEDULED TRIGGERS  (set up in Apps Script → Triggers)
//  dailyReset     → Time-driven, daily at midnight
//  checkInventory → Time-driven, every hour
// ─────────────────────────────────────────────────────────
function dailyReset() {
  const sh   = _sh(S.DRIVERS);
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) sh.getRange(i+1,9).setValue(0);
  Logger.log("Daily reset done: " + new Date());
}

function checkInventory() {
  const low = getInventory().filter(i => i.AlertStatus === "critical" || i.AlertStatus === "out");
  if (low.length > 0) {
    const email = Session.getActiveUser().getEmail();
    MailApp.sendEmail(email,
      `⚠️ ${low.length} item(s) critically low`,
      low.map(i => `${i.Name}: ${i.Quantity} ${i.Unit} (reorder at ${i.ReorderLevel})`).join("\n")
    );
  }
}
