// Firebase client initialization
// Expect the following env vars in your React app:
// REACT_APP_FIREBASE_API_KEY, REACT_APP_FIREBASE_AUTH_DOMAIN, REACT_APP_FIREBASE_PROJECT_ID,
// REACT_APP_FIREBASE_APP_ID, REACT_APP_FIREBASE_MESSAGING_SENDER_ID, REACT_APP_FIREBASE_STORAGE_BUCKET

import { initializeApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// En Vite, las variables vienen de import.meta.env con prefijo VITE_
const env = import.meta.env || {};
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
};

// Debug seguro: no mostramos la apiKey, solo si existe
if (import.meta.env.DEV) {
  const sanitized = {
    ...firebaseConfig,
    apiKey: firebaseConfig.apiKey ? 'OK' : 'MISSING',
  };
  // eslint-disable-next-line no-console
  console.log('[Firebase cfg]', sanitized);
}

function assertConfig(cfg) {
  const missing = Object.entries(cfg)
    .filter(([_, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(`Firebase config incompleta. Falta(n): ${missing.join(', ')}. Revisa .env.local (prefijo VITE_) y reinicia el dev server.`);
  }
}

assertConfig(firebaseConfig);

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export default app;


