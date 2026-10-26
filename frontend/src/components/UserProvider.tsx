"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";

interface Ctx {
  user: User | null;
  loading: boolean;
}
const UserContext = createContext<Ctx>({ user: null, loading: true });

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Ctx>({ user: null, loading: true });
  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((user) => alive && setState({ user, loading: false }))
      .catch(() => alive && setState({ user: null, loading: false }));
    return () => {
      alive = false;
    };
  }, []);
  return <UserContext.Provider value={state}>{children}</UserContext.Provider>;
}

export function useUser(): Ctx {
  return useContext(UserContext);
}
