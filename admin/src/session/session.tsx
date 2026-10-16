import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useGuichet } from "../guichet";
import type { Profil } from "../guichet/types";
import { aLeDroit, type Droit } from "../noyau/droits";

type Session = {
  pret: boolean;
  profil: Profil | null;
  peut: (droit: Droit) => boolean;
  demanderCode: (email: string) => Promise<void>;
  connecter: (email: string, code: string) => Promise<void>;
  deconnecter: () => Promise<void>;
};

const Contexte = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const guichet = useGuichet();
  const [pret, setPret] = useState(false);
  const [profil, setProfil] = useState<Profil | null>(null);

  const relire = useCallback(async () => {
    try { setProfil(await guichet.session()); } catch { setProfil(null); } finally { setPret(true); }
  }, [guichet]);
  useEffect(() => { void relire(); }, [relire]);

  const valeur = useMemo<Session>(() => ({
    pret, profil,
    peut: (d) => aLeDroit(profil?.role, d),
    demanderCode: (email) => guichet.demanderCode(email),
    connecter: async (email, code) => { setProfil(await guichet.verifierCode(email, code)); },
    deconnecter: async () => { await guichet.deconnecter(); setProfil(null); },
  }), [pret, profil, guichet]);

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useSession(): Session {
  const s = useContext(Contexte);
  if (!s) throw new Error("SessionProvider manquant");
  return s;
}
