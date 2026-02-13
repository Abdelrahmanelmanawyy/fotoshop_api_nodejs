# FotoShop – Full setup and test

## 1. Backend (Node.js API)

### 1.1 Create `.env`

From the **fotoshop_api_nodejs** folder:

```powershell
cd c:\Users\user\Desktop\fotoshop_app\fotoshop_api_nodejs
copy .env.example .env
```

Then edit `.env` and set:

- `REPLICATE_API_TOKEN` – your token from [replicate.com/account/api-tokens](https://replicate.com/account/api-tokens)
- `GOOGLE_APPLICATION_CREDENTIALS` – path to your service account JSON (e.g. `./fotoshop-prototype-firebase-adminsdk-fbsvc-c1a2047091.json`)
- `FIREBASE_STORAGE_BUCKET` – `fotoshop-prototype.firebasestorage.app`

### 1.2 Install and run the API

```powershell
npm install
npm run dev
```

You should see: **Fotoshop API running on http://localhost:3000**

Leave this terminal open.

---

## 2. Flutter app

### 2.1 Open a second terminal

```powershell
cd c:\Users\user\Desktop\fotoshop_app\fotoshop_prototype
flutter pub get
flutter run
```

Pick a device (Chrome, Windows, or Android emulator). The app should start.

---

## 3. Test the full flow

### Step A – Create an order in the app

1. In the Flutter app: sign in (or sign up).
2. Connect to a booth (enter a booth ID, e.g. `10001`, and connect).
3. Go to **AI** (bottom nav or menu).
4. Tap **“Tap to upload photo”** and pick an image.
5. Optionally type a prompt (e.g. “portrait enhance”).
6. Tap **“Apply AI Magic”**.

You’ll be taken to the **order result** screen. You’ll see the **original** photo and **“Processing…”** (no edited image yet).

Note the **order ID** in the app bar (e.g. `ORD_1739...`). You’ll need it for the next step.

### Step B – Run the backend on that order

The backend is what calls Replicate and writes the result to Firebase. Trigger it with the order ID from Step A.

In a **third** terminal (or PowerShell), run:

```powershell
curl -X POST http://localhost:3000/process/order -H "Content-Type: application/json" -d "{\"order_id\": \"PASTE_ORDER_ID_HERE\"}"
```

Replace `PASTE_ORDER_ID_HERE` with the real order ID (e.g. `ORD_1739123456789`).

Or in **PowerShell** (easier with a variable):

```powershell
$orderId = "ORD_1739123456789"
Invoke-RestMethod -Uri "http://localhost:3000/process/order" -Method Post -ContentType "application/json" -Body (@{ order_id = $orderId } | ConvertTo-Json)
```

### Step C – See the result in the app

- Keep the **order result** screen open in the Flutter app.
- After the backend finishes (Replicate + Firebase update), the **edited photo** will appear automatically on that screen (no refresh needed), because the app listens to Firestore.

---

## Order of things

| Step | What to run | When |
|------|-------------|------|
| 1 | Backend: `npm run dev` in **fotoshop_api_nodejs** | First, leave it running |
| 2 | Flutter: `flutter run` in **fotoshop_prototype** | Second |
| 3 | Create order in app (AI → upload → Apply AI Magic) | In the app |
| 4 | Call `POST /process/order` with that order ID | After you see the order ID |
| 5 | Watch the order result screen in the app | Edited image appears when backend finishes |

---

## Quick checks

- **Backend health:** open [http://localhost:3000/health](http://localhost:3000/health) in a browser → should return `{"status":"ok",...}`.
- **Backend root:** [http://localhost:3000](http://localhost:3000) → shows API name and endpoints.

If the backend isn’t running, the Flutter app will still create orders in Firestore, but no edited image will appear until you start the API and call `POST /process/order` for that order.
