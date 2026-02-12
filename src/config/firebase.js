import admin from "firebase-admin";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

let app = null;

/**
 * Initialize Firebase Admin SDK
 * Supports: service account JSON file path or JSON string
 */
export function initializeFirebase() {
  if (app) return app;

  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (serviceAccountJson) {
    app = admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(serviceAccountJson)),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
  } else if (serviceAccountPath) {
    const serviceAccount = JSON.parse(
      readFileSync(serviceAccountPath, "utf-8")
    );
    app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
  } else {
    throw new Error(
      "Firebase credentials not found. Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON"
    );
  }

  return app;
}

export function getFirestore() {
  if (!app) initializeFirebase();
  return admin.firestore();
}

export function getStorage() {
  if (!app) initializeFirebase();
  return admin.storage();
}
