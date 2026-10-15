/*
 * La session : qui est connecté, si l'écran est verrouillé, si les montants
 * sont masqués. Le verrou se pose à chaque ouverture de l'application quand
 * le compte a un code secret ; il se lève avec le code (ou l'empreinte, par
 * la coque native). Une session expirée repose le verrou par-dessus l'écran.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useGuichet } from "../guichet";
import type { Compte, ResultatCode } from "../guichet/types";

type Etat =
  | { phase: "chargement" }
  | { phase: "anonyme" }
  | { phase: "profil"; compte: Compte }
  | { phase: "connecte"; compte: Compte; verrouille: boolean };

type Session = {
  etat: Etat;
  compte: Compte | null;
  montantsMasques: boolean;
  basculerMasque: () => void;
  connecter: (telephone: string, code: string) => Promise<{ nouveau: boolean }>;
  profilComplete: (compte: Compte) => void;
  deverrouiller: (code: string) => Promise<ResultatCode>;
  verrouiller: () => void;
  deconnecter: () => Promise<void>;
  rafraichirCompte: () => Promise<void>;
};

const Contexte = createContext<Session | null>(null);
const CLE_MASQUE = "xafe.montants-masques";
const CLE_DEVERROUILLE = "xafe.deverrouille-a";
/** au-delà, l'application rouverte redemande le code */
const VERROU_APRES_MS = 2 * 60_000;

function lireMasque(): boolean {
  try { return localStorage.getItem(CLE_MASQUE) === "1"; } catch { return false; }
}

function deverrouilleRecemment(): boolean {
  try {
    const t = Number(sessionStorage.getItem(CLE_DEVERROUILLE) ?? 0);
    return t > 0 && Date.now() - t < VERROU_APRES_MS;
  } catch { return false; }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const guichet = useGuichet();
  const [etat, setEtat] = useState<Etat>({ phase: "chargement" });
  const [montantsMasques, setMasque] = useState(lireMasque);

  const chargerCompte = useCallback(async () => {
    const s = await guichet.session();
    if (!s) { setEtat({ phase: "anonyme" }); return; }
    const compte = await guichet.compte();
    if (!compte.nom || !compte.aCode) { setEtat({ phase: "profil", compte }); return; }
    setEtat((avant) => ({ phase: "connecte", compte, verrouille: avant.phase === "connecte" ? avant.verrouille : !deverrouilleRecemment() }));
  }, [guichet]);

  useEffect(() => { void chargerCompte().catch(() => setEtat({ phase: "anonyme" })); }, [chargerCompte]);

  /* l'application revient devant après un long moment : le verrou se repose */
  useEffect(() => {
    let cacheeDepuis = 0;
    const surVisibilite = () => {
      if (document.visibilityState === "hidden") { cacheeDepuis = Date.now(); return; }
      if (cacheeDepuis && Date.now() - cacheeDepuis > VERROU_APRES_MS) {
        setEtat((e) => (e.phase === "connecte" ? { ...e, verrouille: true } : e));
      }
      cacheeDepuis = 0;
    };
    document.addEventListener("visibilitychange", surVisibilite);
    return () => document.removeEventListener("visibilitychange", surVisibilite);
  }, []);

  const valeur = useMemo<Session>(() => ({
    etat,
    compte: "compte" in etat ? etat.compte : null,
    montantsMasques,
    basculerMasque: () => setMasque((m) => { try { localStorage.setItem(CLE_MASQUE, m ? "0" : "1"); } catch { /* sans stockage, l'œil vit le temps de la session */ } return !m; }),
    connecter: async (telephone, code) => {
      const r = await guichet.verifierCodeSms(telephone, code);
      const compte = await guichet.compte();
      if (!compte.nom || !compte.aCode) setEtat({ phase: "profil", compte });
      else { try { sessionStorage.setItem(CLE_DEVERROUILLE, String(Date.now())); } catch { /* idem */ } setEtat({ phase: "connecte", compte, verrouille: false }); }
      return { nouveau: r.nouveau || !compte.nom };
    },
    profilComplete: (compte) => {
      try { sessionStorage.setItem(CLE_DEVERROUILLE, String(Date.now())); } catch { /* idem */ }
      setEtat({ phase: "connecte", compte, verrouille: false });
    },
    deverrouiller: async (code) => {
      const r = await guichet.verifierCodeSecret(code);
      if (r.ok) {
        try { sessionStorage.setItem(CLE_DEVERROUILLE, String(Date.now())); } catch { /* idem */ }
        setEtat((e) => (e.phase === "connecte" ? { ...e, verrouille: false } : e));
      }
      return r;
    },
    verrouiller: () => setEtat((e) => (e.phase === "connecte" ? { ...e, verrouille: true } : e)),
    deconnecter: async () => {
      await guichet.seDeconnecter();
      try { sessionStorage.removeItem(CLE_DEVERROUILLE); } catch { /* idem */ }
      setEtat({ phase: "anonyme" });
    },
    rafraichirCompte: chargerCompte,
  }), [etat, montantsMasques, guichet, chargerCompte]);

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useSession(): Session {
  const s = useContext(Contexte);
  if (!s) throw new Error("SessionProvider manquant");
  return s;
}
