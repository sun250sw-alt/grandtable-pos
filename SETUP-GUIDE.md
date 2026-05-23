# Grand Table POS — Setup Guide
## Get fully live in ~20 minutes

---

## STEP 1 — Google Cloud Project

1. Go to https://console.cloud.google.com
2. Click **New Project** → Name: `grandtable-pos` → Create
3. Go to **APIs & Services → Library**, enable:
   - ✅ Google Sheets API
   - ✅ Google Drive API

---

## STEP 2 — OAuth Consent Screen

1. **APIs & Services → OAuth Consent Screen**
2. Choose **External** → Create
3. App name: `Grand Table POS`
4. Support email: your shop Gmail
5. Save and Continue through all steps
6. **Add your shop Gmail as a test user**

---

## STEP 3 — Create OAuth Client ID

1. **APIs & Services → Credentials → + Create Credentials → OAuth Client ID**
2. Type: **Web application**
3. Name: `Grand Table POS`
4. Authorised JavaScript origins — add ALL of these:
   ```
   http://localhost
   http://127.0.0.1
   https://YOUR-USERNAME.github.io
   ```
5. Click **Create** → Copy the **Client ID**
   ```
   Looks like: 123456789-abc.apps.googleusercontent.com
   ```

---

## STEP 4 — Apps Script Setup (auto-creates your Sheet)

1. Go to https://script.google.com → **New Project**
2. Name it: `Grand Table POS API`
3. Delete all default code
4. Paste the entire contents of **`apps-script-api.gs`**
5. Click **Save** (Ctrl+S)
6. In the function dropdown, select **`setupSystem`**
7. Click **▶ Run** — this creates:
   - 📁 Folder `Grand Table POS` in your Google Drive
   - 📊 Spreadsheet with all 10 tabs, pre-seeded with data
   - 🔑 Default admin PIN: **1234** (change in Manager Portal → Settings)
8. Check the **Execution log** — copy the **Spreadsheet ID** shown
9. Now **Deploy → New Deployment**:
   - Type: **Web App**
   - Execute as: **Me**
   - Who has access: **Anyone**
10. Click **Deploy → Authorize**
11. Copy the **Web App URL**

---

## STEP 5 — Configure pos-config.js

Open `pos-config.js` and replace the 3 placeholder values:

```javascript
const POS_CONFIG = {
  GOOGLE_CLIENT_ID : "123456789-abc.apps.googleusercontent.com",  // ← from Step 3
  APPS_SCRIPT_URL  : "https://script.google.com/macros/s/ABC.../exec", // ← from Step 4
  ADMIN_EMAIL      : "yourshop@gmail.com",  // ← your ONE master Google account
  ...
};
```

---

## STEP 6 — Deploy to GitHub Pages

1. Create a GitHub repo: `grandtable-pos` (set to **Public**)
2. Upload ALL files:
   ```
   index.html              ← Hub (sign in here first)
   waiter-app.html
   kitchen-display.html
   kitchen-prep-display.html
   waiting-display.html
   manager-portal.html
   customer-app.html       ← public, no login
   driver-app.html
   pos-config.js           ← shared auth + API
   apps-script-api.gs      ← reference only, not served
   ```
3. **Settings → Pages → Source: Deploy from branch → main → / (root)**
4. Wait ~60 seconds → your system is live at:
   ```
   https://YOUR-USERNAME.github.io/grandtable-pos/
   ```

---

## STEP 7 — First Login

1. Open `https://YOUR-USERNAME.github.io/grandtable-pos/`
2. Sign in with the **shop Google account** (`ADMIN_EMAIL`)
3. You're in the Hub — all internal apps are now accessible
4. Open **Manager Portal** → enter PIN **1234** → go to **Settings → Change PIN**
5. Add your drivers in **Manager Portal → Staff → Add Driver**

---

## How Each App Authenticates

| App | Who Signs In | How |
|-----|-------------|-----|
| Hub | Shop Google account | Google OAuth |
| Waiter App | Anyone on shop device | Hub session (auto) |
| Kitchen Display | Anyone on shop device | Hub session (auto) |
| Kitchen Prep | Anyone on shop device | Hub session (auto) |
| Waiting Display | Anyone on shop device | Hub session (auto) |
| Manager Portal | Manager | Hub session + 4-digit PIN |
| Customer App | Nobody | Fully public |
| Driver App | Each driver | Their own Google account (must be pre-approved) |

**Session lasts 24 hours** — sign in once on each device, all apps stay open.

---

## Adding a Driver

1. Open **Manager Portal → Staff → Drivers tab**
2. Click **Add Driver**
3. Enter their name, Gmail address, phone, vehicle
4. They can now sign into the Driver App with that Gmail

## Changing the Admin PIN

1. Open **Manager Portal** → enter current PIN
2. Go to **Settings → Security → Change PIN**
3. Enter new 4-digit PIN → Save

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Access denied" on sign-in | Make sure `ADMIN_EMAIL` in pos-config.js exactly matches your Google account email |
| "Not a valid origin" | Add your GitHub Pages URL to Authorised JavaScript Origins in Google Cloud Console |
| Apps Script 403 error | Re-deploy with "Anyone" access; re-authorize |
| Sheet not found | Run `setupSystem()` again in Apps Script editor |
| Driver can't sign in | Check their Gmail is in Manager Portal → Staff → Drivers and Approved = true |

---

## Team Portal — Additional Setup

### How Staff Access the Team Portal

1. Manager opens **Manager Portal → Staff → Drivers tab** (same tab also manages team)
2. Click **"Approve Driver Gmail"** (same flow for team members)
3. Enter staff member's full name + their **exact Gmail address**
4. Staff member opens `team-app.html` on their phone or PC
5. They sign in with their own Google account
6. If their Gmail is approved → they see their dashboard
7. If not approved → they see "Contact your manager"

### New Google Sheets Tabs (auto-created by setupSystem)

| Tab | What it stores |
|-----|---------------|
| **Rota** | RotaID, StaffEmail, StaffName, Date, ShiftStart, ShiftEnd, Role, Location, Notes, Status |
| **Clockings** | ClockingID, StaffEmail, Date, ClockIn, ClockOut, TotalHours, Status |

### Building the Rota (Manager Portal → Rota Manager)

1. Open **Manager Portal → Rota Manager**
2. Navigate to the target week with **‹ Prev / Next ›**
3. Click any cell in the grid (staff × day) to assign a shift
4. Set start time, end time, role/station, notes
5. Click **Save Shift** — appears in the grid instantly
6. When the week is complete click **Publish Rota**
7. Staff immediately see it in their Team Portal → Rota tab

### Clock In/Out Flow

```
Staff opens Team Portal on their phone
       ↓
Today tab shows their shift for the day
       ↓
They tap "Clock In" → time recorded in Clockings sheet
       ↓
Green chip shows "Clocked in at HH:MM"
       ↓
End of shift → tap "Clock Out"
       ↓
Hours calculated and saved automatically
```

Manager can view all clockings in **Manager Portal → Team Clockings**

### Share URL with Staff

After deploying to GitHub Pages, share this URL with all staff:
```
https://YOUR-USERNAME.github.io/grandtable-pos/team-app.html
```
They bookmark it on their phone — works like an app.
