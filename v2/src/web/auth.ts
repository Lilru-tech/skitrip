// Firebase Auth (email + contraseña). Solo se importan firebase/app y firebase/auth.
// El SDK guarda su propia sesión (IndexedDB); la app nunca guarda tokens por su cuenta.
import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  indexedDBLocalPersistence,
  initializeAuth,
  onIdTokenChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { absoluteUrl } from './router';

// Acceso directo a import.meta.env.X (no a través de una variable) para que Vite sustituya cada valor en el build y
// el código del emulador desaparezca del build publicado.
export const usingEmulator = import.meta.env.VITE_USE_AUTH_EMULATOR ? import.meta.env.VITE_USE_AUTH_EMULATOR === '1' : import.meta.env.DEV;

const app = initializeApp(
  usingEmulator
    ? { apiKey: 'demo-api-key', authDomain: 'demo-skitrip.firebaseapp.com', projectId: 'demo-skitrip' }
    : { apiKey: import.meta.env.VITE_FIREBASE_API_KEY, authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID },
);

// initializeAuth sin popupRedirectResolver: no carga iframes de Google (CSP estricta, menos peso).
export const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
auth.languageCode = 'es';
if (usingEmulator) connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

export type { User };
export const onUserChanged = (cb: (u: User | null) => void) => onIdTokenChanged(auth, cb);
export const login = (email: string, password: string) => signInWithEmailAndPassword(auth, email.trim(), password);
export const signup = (email: string, password: string) => createUserWithEmailAndPassword(auth, email.trim(), password);
export const logout = () => signOut(auth);
// Enlace de vuelta tras cambiar la contraseña: la pantalla de entrar de la web publicada (dominio autorizado en Firebase).
export const resetPassword = (email: string) =>
  sendPasswordResetEmail(auth, email.trim(), usingEmulator ? undefined : { url: absoluteUrl('/entrar') });

export async function idToken(forceRefresh = false): Promise<string | null> {
  const u = auth.currentUser;
  return u ? u.getIdToken(forceRefresh) : null;
}

const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Email o contraseña incorrectos.',
  'auth/invalid-login-credentials': 'Email o contraseña incorrectos.',
  'auth/wrong-password': 'Email o contraseña incorrectos.',
  'auth/user-not-found': 'Email o contraseña incorrectos.',
  'auth/invalid-email': 'El email no tiene un formato válido.',
  'auth/missing-email': 'Escribe tu email.',
  'auth/missing-password': 'Escribe tu contraseña.',
  'auth/email-already-in-use': 'Ya existe una cuenta con ese email. Inicia sesión o recupera tu contraseña.',
  'auth/weak-password': 'La contraseña es demasiado débil: usa al menos 8 caracteres.',
  'auth/password-does-not-meet-requirements': 'La contraseña no cumple los requisitos de seguridad.',
  'auth/too-many-requests': 'Demasiados intentos seguidos. Espera unos minutos y vuelve a probar.',
  'auth/network-request-failed': 'No hay conexión. Revisa tu red e inténtalo de nuevo.',
  'auth/user-disabled': 'Esta cuenta está desactivada.',
  'auth/operation-not-allowed': 'El acceso con email y contraseña no está habilitado.',
  'auth/quota-exceeded': 'Se ha alcanzado el límite temporal del servicio. Prueba más tarde.',
  'auth/internal-error': 'Error del servicio de acceso. Inténtalo de nuevo.',
};

export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string } | null)?.code ?? '';
  return MESSAGES[code] ?? 'No se ha podido completar la operación. Inténtalo de nuevo.';
}
