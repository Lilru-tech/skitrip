export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  AUTH_MODE: 'firebase' | 'emulator';
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGINS: string;
  MAX_PROFILES: string;
  INGEST_TOKEN?: string;
}

export interface AuthInfo {
  uid: string;
  email: string | null;
  authTime: number; // epoch s
}

export interface UserRow {
  id: string;
  firebase_uid: string;
  alias: string;
  email: string | null;
  role: 'user' | 'admin';
  status: 'active' | 'blocked';
  tokens_valid_after: number;
  home_origin_id: string | null;
  created_at: number;
}

export type AppVars = { auth: AuthInfo; user: UserRow };
export type AppEnv = { Bindings: Env; Variables: AppVars };
