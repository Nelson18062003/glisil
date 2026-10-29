/*
 * La session : où en est l'entrée (noyau/entree.ts le décide, d'après Supabase
 * Auth et la base), le compte quand tout est là, et l'œil qui masque les
 * montants. Il n'y a plus de verrou ni de code secret : l'entrée demande le
 * mot de passe (ou Google) puis le code de l'application d'authentification,
 * et chaque sortie d'argent redemande ses trois preuves (ui/verification.tsx).
 *
 * L'état ne se devine pas : `avancer()` relit l'état d'entrée et en tire la
 * phase. Les écrans d'entrée agissent par le guichet, puis appellent avancer().
 * Une session ouverte par un simple code e-mail (hors « mot de passe oublié »)
 * est fermée ici : elle n'ouvrirait rien en base.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useGuichet } from "../guichet";
import type { Compte } from "../guichet/types";
import { phaseDEntree, type PhaseDEntree } from "../noyau/entree";

export type Etat =
  | { phase: "chargement" }
  | Exclude<PhaseDEntree, { phase: "connecte" } | { phase: "email_a_confirmer" }>
  | { phase: "email_a_confirmer"; email: string | null }
  | { phase: "connecte"; compte: Compte };

/** Ce que la Bienvenue doit dire en arrivant (« adresse confirmée, connectez-vous »…). */
export type Annonce = "facteur_faible" | "adresse_confirmee" | "mot_de_passe_change" | null;

type Session = {
  etat: Etat;
  compte: Compte | null;
  montantsMasques: boolean;
  basculerMasque: () => void;
  /** relit l'état d'entrée et mène à la phase qui suit */
  avancer: () => Promise<void>;
  deconnecter: (portee?: "local" | "global") => Promise<void>;
  /** relit le compte (après une écriture qui le change) */
  rafraichirCompte: () => Promise<void>;
  /** l'adresse et le mot de passe d'une inscription, gardés EN MÉMOIRE le temps du code (jamais écrits) */
  retenirInscription: (email: string | null, motDePasse: string | null) => void;
  inscription: { email: string | null; motDePasse: string | null };
  annonce: Annonce;
  poserAnnonce: (a: Annonce) => void;
  /** « mot de passe oublié » : la session ouverte par son code e-mail n'ouvre que la suite de ce détour */
  commencerRecuperation: () => void;
  finirRecuperation: () => void;
};

const Contexte = createContext<Session | null>(null);
const CLE_MASQUE = "xafe.montants-masques";
const CLE_RECUPERATION = "glisil.recuperation";

function lireMasque(): boolean {
  try { return localStorage.getItem(CLE_MASQUE) === "1"; } catch { return false; }
}
/* le détour « mot de passe oublié » survit à un rechargement (sessionStorage) ; sans stockage, il vit le temps de la page */
let recuperationEnMemoire = false;
const recuperationEnCours = (): boolean => { try { return sessionStorage.getItem(CLE_RECUPERATION) === "1" || recuperationEnMemoire; } catch { return recuperationEnMemoire; } };
function poserRecuperation(oui: boolean) {
  recuperationEnMemoire = oui;
  try { if (oui) sessionStorage.setItem(CLE_RECUPERATION, "1"); else sessionStorage.removeItem(CLE_RECUPERATION); } catch { /* la mémoire suffit */ }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const guichet = useGuichet();
  const [etat, setEtat] = useState<Etat>({ phase: "chargement" });
  const [montantsMasques, setMasque] = useState(lireMasque);
  const [annonce, poserAnnonce] = useState<Annonce>(null);
  const [inscription, setInscription] = useState<{ email: string | null; motDePasse: string | null }>({ email: null, motDePasse: null });
  const inscriptionRef = useRef(inscription);
  inscriptionRef.current = inscription;
  /* deux relectures croisées : la dernière demandée gagne */
  const tour = useRef(0);

  const avancer = useCallback(async () => {
    const ce = ++tour.current;
    let e;
    try { e = await guichet.etatDEntree(); } catch { if (ce === tour.current) setEtat({ phase: "anonyme" }); return; }
    if (ce !== tour.current) return;
    const p = phaseDEntree(e, recuperationEnCours());
    if (p.phase === "anonyme" && p.raison === "facteur_faible") {
      /* un code e-mail seul ne donne jamais une session forte : on la ferme, et l'on demande le mot de passe */
      await guichet.seDeconnecter().catch(() => undefined);
      poserAnnonce("facteur_faible");
    }
    if (ce !== tour.current) return;
    if (p.phase === "connecte") {
      let compte: Compte | null;
      try { compte = await guichet.monCompte(); } catch {
        /* le compte ne se lit pas (réseau) : on garde ce qu'on avait, sinon la Bienvenue — la session, elle, reste */
        if (ce === tour.current) setEtat((avant) => (avant.phase === "connecte" ? avant : { phase: "anonyme" }));
        return;
      }
      if (ce !== tour.current) return;
      setEtat(compte ? { phase: "connecte", compte } : { phase: "inscription" });
      return;
    }
    if (p.phase === "anonyme" && inscriptionRef.current.email) {
      /* l'inscription attend son code : l'écran du code reste ouvert, même sans session */
      setEtat({ phase: "email_a_confirmer", email: inscriptionRef.current.email });
      return;
    }
    setEtat(p.phase === "email_a_confirmer" ? { phase: "email_a_confirmer", email: inscriptionRef.current.email } : p);
  }, [guichet]);

  useEffect(() => { void avancer(); }, [avancer]);

  /* la session fermée ailleurs (expirée, « déconnecter tous mes appareils »), ou devenue faible pour la base */
  const derniereRelecture = useRef(0);
  useEffect(() => guichet.surEntree((ev) => {
    if (ev === "deconnecte") { tour.current++; setEtat((e) => (e.phase === "anonyme" || e.phase === "email_a_confirmer" ? e : { phase: "anonyme" })); return; }
    /* un refus « double authentification requise » : une relecture, pas une rafale (dix requêtes refusées ensemble n'en font qu'une) */
    if (Date.now() - derniereRelecture.current < 3_000) return;
    derniereRelecture.current = Date.now();
    void avancer();
  }), [guichet, avancer]);

  /* la coque rend le retour de Google (glisil://auth-retour?code=…) : le code s'échange ici, dans la page qui a le vérificateur */
  useEffect(() => {
    const surRetour = (ev: Event) => {
      const url = (ev as CustomEvent<string>).detail;
      if (typeof url !== "string") return;
      void guichet.terminerRetourOAuth(url).then(() => avancer(), () => { poserAnnonce(null); void avancer(); });
    };
    window.addEventListener("glisil:retour-oauth", surRetour);
    return () => window.removeEventListener("glisil:retour-oauth", surRetour);
  }, [guichet, avancer]);

  /* le temps réel ne s'ouvre qu'à une session complète : avant aal2, la base ne montre rien, et le canal garderait l'ancien jeton */
  const connecte = etat.phase === "connecte";
  useEffect(() => { guichet.tempsReel(connecte); }, [guichet, connecte]);

  const valeur = useMemo<Session>(() => ({
    etat,
    compte: etat.phase === "connecte" ? etat.compte : null,
    montantsMasques,
    basculerMasque: () => setMasque((m) => { try { localStorage.setItem(CLE_MASQUE, m ? "0" : "1"); } catch { /* sans stockage, l'œil vit le temps de la session */ } return !m; }),
    avancer,
    deconnecter: async (portee = "local") => {
      tour.current++;
      await guichet.seDeconnecter(portee);
      poserRecuperation(false);
      inscriptionRef.current = { email: null, motDePasse: null };
      setInscription({ email: null, motDePasse: null });
      setEtat({ phase: "anonyme" });
    },
    rafraichirCompte: avancer,
    retenirInscription: (email, motDePasse) => { inscriptionRef.current = { email, motDePasse }; setInscription({ email, motDePasse }); },
    inscription,
    annonce,
    poserAnnonce,
    commencerRecuperation: () => poserRecuperation(true),
    finirRecuperation: () => poserRecuperation(false),
  }), [etat, montantsMasques, guichet, avancer, inscription, annonce]);

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useSession(): Session {
  const s = useContext(Contexte);
  if (!s) throw new Error("SessionProvider manquant"); // langue-ok (message pour le développeur)
  return s;
}
