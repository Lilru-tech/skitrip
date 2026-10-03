// Estado de sesión: usuario de Firebase + perfil de SkiTrip (alias).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, errorMessage, get } from './api';
import { onUserChanged, type User } from './auth';
import type { MeResponse, OwnProfile } from './types';

export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'needsAlias'; user: User }
  | { status: 'error'; user: User; message: string }
  | { status: 'ready'; user: User; profile: OwnProfile };

interface SessionApi {
  state: SessionState;
  reload: () => Promise<void>;
  setProfile: (p: OwnProfile) => void;
}

const Ctx = createContext<SessionApi | null>(null);
export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('SessionProvider ausente');
  return v;
}
/** Perfil propio; solo dentro de páginas autenticadas. */
export function useProfile(): OwnProfile {
  const { state } = useSession();
  if (state.status !== 'ready') throw new Error('Sin perfil');
  return state.profile;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const uidRef = useRef<string | null | undefined>(undefined); // undefined = aún sin estado inicial

  const auth_uid = () => uidRef.current;
  const loadProfile = useCallback(async (user: User) => {
    try {
      const me = await get<MeResponse>('/api/me');
      if (auth_uid() !== user.uid) return;
      setState(me.profile ? { status: 'ready', user, profile: me.profile } : { status: 'needsAlias', user });
    } catch (e) {
      if (auth_uid() !== user.uid) return;
      if (e instanceof ApiError && e.code === 'profile_required') setState({ status: 'needsAlias', user });
      else setState({ status: 'error', user, message: errorMessage(e) });
    }
  }, []);


  useEffect(() => onUserChanged((u) => {
    // onIdTokenChanged también salta al renovar el token: solo recargamos si cambia la persona.
    const uid = u?.uid ?? null;
    if (uid === uidRef.current) return;
    uidRef.current = uid;
    if (!u) setState({ status: 'anonymous' });
    else {
      setState({ status: 'loading' });
      void loadProfile(u);
    }
  }), [loadProfile]);

  const reload = useCallback(async () => {
    const s = state;
    if ('user' in s) await loadProfile(s.user);
  }, [state, loadProfile]);

  const setProfile = useCallback((profile: OwnProfile) => {
    setState((s) => ('user' in s ? { status: 'ready', user: s.user, profile } : s));
  }, []);

  return <Ctx.Provider value={{ state, reload, setProfile }}>{children}</Ctx.Provider>;
}

/** Alias elegido en el formulario de registro, pendiente de enviarse cuando exista la sesión. */
export const pendingSignup: { alias: string | null } = { alias: null };
