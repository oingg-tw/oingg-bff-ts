import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";

let app: App | undefined;

const DEFAULT_SERVICE_ACCOUNT_PATH = "serviceAccountKey.json";

/**
 * Initializes the firebase-admin app from a service account key file.
 * Call once during startup, before any other firebase-admin usage.
 */
export function initFirebase(): App {
  if (app) {
    return app;
  }

  const existing = getApps()[0];
  if (existing) {
    app = existing;
    return app;
  }

  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? DEFAULT_SERVICE_ACCOUNT_PATH;

  app = initializeApp({
    credential: cert(serviceAccountPath),
  });
  return app;
}

export function getFirebaseAuth(): Auth {
  return getAuth(initFirebase());
}
