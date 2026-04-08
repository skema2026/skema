import { createContext, useContext, useState, ReactNode } from "react";

interface AuthCtx {
  token: string | null;
  setToken: (t: string | null) => void;
}

const Ctx = createContext<AuthCtx>({ token: null, setToken: () => {} });

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem("token")
  );

  /** localStorage ↔ state 동기화 */
  const set = (t: string | null) => {
    if (t) localStorage.setItem("token", t);
    else   localStorage.removeItem("token");
    setToken(t);
  };

  return <Ctx.Provider value={{ token, setToken: set }}>{children}</Ctx.Provider>;
};

export const useAuth = () => useContext(Ctx);
