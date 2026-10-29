import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useGuichet } from "../guichet";
import type { Profil } from "../guichet/types";
import { aLeDroit, type Droit } from "../noyau/droits";

/*
 * La session de l'administration : un profil, seulement quand l'entrée est
 * complète (mot de passe + application d'authentification + codes de secours
 * notés, 0035). Les étapes de l'entrée vivent dans pages/connexion.tsx ;
 * ici, on ne garde que leur résultat.
 */
type Session = {
  pret: boolean;
  profil: Profil | null;
  peut: (droit: Droit) => boolean;
  /** l'entrée est faite : le profil rendu par entrer_administration */
  ouvrir: (p: Profil) => void;
  deconnecter: (portee?: "local" | "global") => Promise<void>;
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
  /* une session fermée ailleurs (expirée, « déconnecter partout ») ramène à l'entrée */
  useEffect(() => guichet.surChangement(() => { void relire(); }), [guichet, relire]);

  const valeur = useMemo<Session>(() => ({
    pret, profil,
    peut: (d) => aLeDroit(profil?.role, d),
    ouvrir: (p) => setProfil(p),
    deconnecter: async (portee = "local") => { await guichet.deconnecter(portee); setProfil(null); },
  }), [pret, profil, guichet]);

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useSession(): Session {
  const s = useContext(Contexte);
  if (!s) throw new Error("SessionProvider manquant");
  return s;
}
