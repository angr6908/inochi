"use client";

import React, { createContext, useContext, useEffect, useLayoutEffect, useState, useCallback } from "react";
import { User, getMe, signIn as apiSignIn, signUp as apiSignUp } from "./api";

// Restore the cached session before the first paint so the logged-in UI (nav,
// composer) doesn't pop in a frame late; falls back to useEffect during SSR.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Non-sensitive hint mirroring login state so the server can render the right
// nav on refresh (the real token stays in localStorage). Read by the root layout.
function setAuthCookie(on: boolean) {
  document.cookie = `auth=${on ? "1" : ""};path=/;max-age=${on ? 31536000 : 0};samesite=lax`;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (username: string, password: string) => Promise<void>;
  signOut: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children, initialAuthed }: { children: React.ReactNode; initialAuthed: boolean }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(initialAuthed);

  useIsomorphicLayoutEffect(() => {
    const stored = localStorage.getItem("token");
    if (!stored) {
      setAuthCookie(false);
      setLoading(false);
      return;
    }
    const cached = localStorage.getItem("user");
    if (cached) {
      try {
        setUser(JSON.parse(cached) as User);
      } catch {
        // ignore malformed cache
      }
    }
    getMe()
      .then((u) => {
        setUser(u);
        localStorage.setItem("user", JSON.stringify(u));
        setAuthCookie(true);
      })
      .catch(() => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        setAuthCookie(false);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const res = await apiSignIn(username, password);
    localStorage.setItem("token", res.token);
    localStorage.setItem("user", JSON.stringify(res.user));
    setAuthCookie(true);
    setUser(res.user);
  }, []);

  const signUp = useCallback(async (username: string, password: string) => {
    const res = await apiSignUp(username, password);
    localStorage.setItem("token", res.token);
    localStorage.setItem("user", JSON.stringify(res.user));
    setAuthCookie(true);
    setUser(res.user);
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setAuthCookie(false);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const u = await getMe();
    setUser(u);
    localStorage.setItem("user", JSON.stringify(u));
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
