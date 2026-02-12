# Fotoshop API

Node.js API that connects **Firestore** with **Replicate's flux-kontext-pro** for AI image editing. Fetches photos from Firestore, processes them via Replicate, and saves results back to Firebase Storage + Firestore.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `REPLICATE_API_TOKEN` | Your Replicate API token from [replicate.com/account](https://replicate.com/account/api-tokens) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to Firebase service account JSON file |
| `FIREBASE_STORAGE_BUCKET` | Your Firebase Storage bucket (e.g. `fotoshop-prototype.firebasestorage.app`) |

**Firebase service account:** Download from Firebase Console → Project Settings → Service Accounts → Generate new private key.

### 3. Run

```bash
npm run dev
```

API runs at `http://localhost:3000`.

## API Endpoints

### `POST /process/order`

Process all photos in an order.

**Body:**
```json
{
  "order_id": "ORD_1770598001221",
  "collection": "orders"
}
```

**Response:**
```json
{
  "order_id": "ORD_1770598001221",
  "results": [
    { "success": true, "photo_id": "PH_1", "output_url": "https://..." },
    { "success": false, "photo_id": "PH_2", "error": "..." }
  ]
}
```

### `POST /process/order/:orderId`

Same as above with `orderId` in the URL.

## Firestore Data Structure

Expected order document:

```json
{
  "booth_id": "10001",
  "order_id": "ORD_1770598001221",
  "photos": [
    {
      "input_url": "https://firebasestorage.googleapis.com/...",
      "photo_id": "PH_1",
      "preset": "portrait_enhance",
      "user_id": "jLslctOwPSZc5uzEKmUMcPhtAQl2",
      "output": { "preview": true, "store_in": "firebase_storage" }
    }
  ]
}
```

After processing, each photo gets `output_url` and `output_completed_at` added.

## Presets

| Preset | Description |
|--------|-------------|
| `portrait_enhance` | Enhance portrait, improve skin, lighting |
| `disney_pixar` | Disney Pixar style |
| `anime` | Anime style |
| `oil_painting` | Oil painting style |
| `vintage` | Vintage film look |
| `cinematic` | Cinematic lighting |
| `professional` | Professional headshot |

Add more in `src/services/presets.js`.

---

## Using the same Firebase as your Flutter app

Use the **same Firebase project** as your Flutter app so both see the same Firestore and Storage:

1. In [Firebase Console](https://console.firebase.google.com/), open the project your Flutter app uses.
2. **Project settings** (gear) → **Service accounts** → **Generate new private key** → save as `service-account.json` in this API folder.
3. **Project settings** → **General** → under "Your apps", note the **Storage bucket** (e.g. `fotoshop-prototype.firebasestorage.app`).
4. In this project, create `.env` with:
   - `GOOGLE_APPLICATION_CREDENTIALS=./service-account.json`
   - `FIREBASE_STORAGE_BUCKET=<your-bucket-from-step-3>`
   - `REPLICATE_API_TOKEN=<your-token>`

Then orders and photos created/updated by the API will appear in the same Firestore and Storage that your Flutter app uses.

---

## Testing

### 1. Create a test order in Firestore (same as Flutter data)

In Firebase Console → **Firestore** → collection `orders` (or your collection name) → **Add document**:

- **Document ID:** e.g. `ORD_TEST_001`
- **Fields:**
  - `booth_id` (string): `10001`
  - `order_id` (string): `ORD_TEST_001`
  - `photos` (array):
    - Item 0 (map):
      - `input_url` (string): a public image URL (e.g. from your Storage or any HTTPS image)
      - `photo_id` (string): `PH_1`
      - `preset` (string): `portrait_enhance`
      - `user_id` (string): your test user ID (e.g. from your Flutter app)

Or create the order from your Flutter app; then use that `order_id` in step 2.

### 2. Start the API and call it

```bash
npm run dev
```

Then from another terminal (or Postman):

```bash
curl -X POST http://localhost:3000/process/order ^
  -H "Content-Type: application/json" ^
  -d "{\"order_id\": \"ORD_TEST_001\"}"
```

(On macOS/Linux use `\` instead of `^` for line continuation.)

### 3. Check results

- **Firestore:** The same order document should now have `output_url` and `output_completed_at` on the processed photo(s).
- **Storage:** New file under `uploads/edited/<user_id>/<order_id>_<photo_id>.jpg`.
- Your Flutter app can read the same order document and display the new `output_url`.
