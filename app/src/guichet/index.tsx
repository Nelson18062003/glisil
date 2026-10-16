/*
 * Le guichet, branché à React : un seul guichet pour toute l'application,
 * des lectures en cache (TanStack Query) qui se rafraîchissent d'elles-mêmes
 * quand le moteur dit que quelque chose a bougé.
 */
import { appliquerSupport } from "../noyau/conditions";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { appliquerParametres, CRYPTO, MARCHE, RAPIDE, SORTIES } from "../noyau/argent";
import { GuichetDemo } from "./demo";
import type { Guichet } from "./guichet";
import { GuichetSupabase } from "./supabase";
import type { Actif, Reseau, SensRapide } from "./types";

const Contexte = createContext<Guichet | null>(null);

export function ouvrirLeGuichet(): Guichet {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const cle = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (url && cle) return new GuichetSupabase(url, cle);
  return new GuichetDemo();
}

export const client = new QueryClient({
  defaultOptions: { queries: { staleTime: 2_000, retry: 1, refetchOnWindowFocus: true } },
});

export function GuichetProvider({ guichet, children }: { guichet: Guichet; children: ReactNode }) {
  useEffect(() => guichet.surChangement(() => { void client.invalidateQueries(); }), [guichet]);
  return (
    <Contexte.Provider value={guichet}>
      <QueryClientProvider client={client}><Parametres />{children}</QueryClientProvider>
    </Contexte.Provider>
  );
}

/** Les frais et plafonds que l'équipe a posés, lus au démarrage puis toutes les cinq minutes, appliqués en place. */
function useParametres() {
  const g = useGuichet();
  return useQuery({
    queryKey: ["parametres"],
    queryFn: async () => { const p = await g.parametres().catch(() => null); appliquerParametres(p); appliquerSupport(p); return p ?? false; },
    refetchInterval: 5 * 60_000,
  });
}
function Parametres() {
  useParametres();
  return null;
}

/**
 * Ce que l'équipe a ouvert. Glisil peut ouvrir par les dépôts seuls : les
 * sorties, le marché, l'achat rapide et la crypto ont chacun leur
 * interrupteur, que la base fait respecter et que l'écran lit ici — l'écran
 * se redessine quand les paramètres arrivent ou changent.
 */
export function useOuvertures() {
  const { dataUpdatedAt, isPending } = useParametres();
  return useMemo(() => ({
    /* tant que la première lecture n'est pas revenue, on ne sait pas : ni « ouvert », ni « bientôt » */
    pret: !isPending,
    sorties: SORTIES.ouvertes,
    /* l'équipe paie à la main : on demande le nom du compte, et on ne promet pas « 40 secondes » */
    sortieManuelle: SORTIES.mode === "manuel",
    marche: MARCHE.ouvert,
    rapide: RAPIDE.ouvert && MARCHE.ouvert,
    cryptoDepots: CRYPTO.depotsOuverts,
    cryptoRetraits: CRYPTO.retraitsOuverts,
    /* l'entrée « Crypto » mène à l'un de ces trois : fermée s'ils le sont tous */
    crypto: CRYPTO.depotsOuverts || CRYPTO.retraitsOuverts || (RAPIDE.ouvert && MARCHE.ouvert),
  }), [dataUpdatedAt, isPending]); // les valeurs vivent hors de React : la date de la lecture suffit à les relire
}

export function useGuichet(): Guichet {
  const g = useContext(Contexte);
  if (!g) throw new Error("GuichetProvider manquant");
  return g;
}

/* ------------------------------------------------------------ lectures */

export const cles = {
  compte: ["compte"] as const,
  soldes: ["soldes"] as const,
  numeros: ["numeros"] as const,
  depot: (ref: string) => ["depot", ref] as const,
  depotsEnAttente: ["depots-en-attente"] as const,
  sortie: (ref: string) => ["sortie", ref] as const,
  cotation: ["cotation"] as const,
  carnet: (p: number) => ["carnet", p] as const,
  transactions: (n: number) => ["transactions", n] as const,
  chandelles: (m: number, n: number) => ["chandelles", m, n] as const,
  mesOrdres: ["mes-ordres"] as const,
  ordre: (id: string) => ["ordre", id] as const,
  historique: ["historique"] as const,
  notifications: ["notifications"] as const,
  adresse: (a: Actif, r: Reseau) => ["adresse", a, r] as const,
  retrait: (ref: string) => ["retrait", ref] as const,
};

const MARCHE_MS = 4_000;

export function useCompte() { const g = useGuichet(); return useQuery({ queryKey: cles.compte, queryFn: () => g.compte() }); }
export function useSoldes() { const g = useGuichet(); return useQuery({ queryKey: cles.soldes, queryFn: () => g.soldes(), refetchInterval: 15_000 }); }
export function useNumeros() { const g = useGuichet(); return useQuery({ queryKey: cles.numeros, queryFn: () => g.numeros() }); }
export function useDepot(ref: string | undefined) { const g = useGuichet(); return useQuery({ queryKey: cles.depot(ref ?? ""), queryFn: () => g.depot(ref!), enabled: Boolean(ref), refetchInterval: 3_000 }); }
export function useDepotsEnAttente() { const g = useGuichet(); return useQuery({ queryKey: cles.depotsEnAttente, queryFn: () => g.depotsEnAttente(), refetchInterval: 10_000 }); }
export function useSortie(ref: string | undefined) { const g = useGuichet(); return useQuery({ queryKey: cles.sortie(ref ?? ""), queryFn: () => g.sortie(ref!), enabled: Boolean(ref), refetchInterval: 3_000 }); }
export function useCotation() { const g = useGuichet(); return useQuery({ queryKey: cles.cotation, queryFn: () => g.cotation(), refetchInterval: MARCHE_MS }); }
export function useCarnet(profondeur: number) { const g = useGuichet(); return useQuery({ queryKey: cles.carnet(profondeur), queryFn: () => g.carnet(profondeur), refetchInterval: MARCHE_MS }); }
export function useTransactions(n: number) { const g = useGuichet(); return useQuery({ queryKey: cles.transactions(n), queryFn: () => g.transactions(n), refetchInterval: MARCHE_MS }); }
export function useChandelles(minutes: number, n: number) { const g = useGuichet(); return useQuery({ queryKey: cles.chandelles(minutes, n), queryFn: () => g.chandelles(minutes, n), refetchInterval: 15_000 }); }
export function useMesOrdres() { const g = useGuichet(); return useQuery({ queryKey: cles.mesOrdres, queryFn: () => g.mesOrdres(), refetchInterval: 6_000 }); }
export function useOrdre(id: string | undefined) { const g = useGuichet(); return useQuery({ queryKey: cles.ordre(id ?? ""), queryFn: () => g.ordre(id!), enabled: Boolean(id) }); }
export function useHistorique() { const g = useGuichet(); return useQuery({ queryKey: cles.historique, queryFn: () => g.historique(), refetchInterval: 10_000 }); }
/**
 * Une opération : d'abord dans la liste déjà chargée ; sinon (au-delà des 200
 * dernières), demandée seule au moteur. « Introuvable » ne se dit qu'après
 * cette seconde question.
 */
export function useOperation(ref: string | undefined) {
  const g = useGuichet();
  const liste = useHistorique();
  const dansLaListe = useMemo(() => liste.data?.find((o) => o.reference === ref) ?? null, [liste.data, ref]);
  const seule = useQuery({
    queryKey: ["operation", ref ?? ""],
    queryFn: () => g.operation(ref!),
    enabled: Boolean(ref) && liste.isSuccess && !dansLaListe,
    refetchInterval: 10_000,
  });
  return {
    ...liste,
    data: dansLaListe ?? seule.data ?? null,
    isLoading: liste.isLoading || (!dansLaListe && !liste.isError && seule.data === undefined && !seule.isError),
  };
}
export function useNotifications() { const g = useGuichet(); return useQuery({ queryKey: cles.notifications, queryFn: () => g.notifications(), refetchInterval: 20_000 }); }
export function useAdresseDepot(actif: Actif, reseau: Reseau) { const g = useGuichet(); return useQuery({ queryKey: cles.adresse(actif, reseau), queryFn: () => g.adresseDepot(actif, reseau) }); }
export function useRetraitCrypto(ref: string | undefined) { const g = useGuichet(); return useQuery({ queryKey: cles.retrait(ref ?? ""), queryFn: () => g.retraitCrypto(ref!), enabled: Boolean(ref), refetchInterval: 3_000 }); }

/** L'estimation de l'achat rapide pendant qu'on tape : rien n'est écrit ; elle se relit, le carnet bouge. */
export function useEstimationRapide(sens: SensRapide, montant: number) {
  const g = useGuichet();
  return useQuery({
    queryKey: ["rapide", sens, montant],
    queryFn: () => g.devisRapide({ sens, montant, ferme: false }),
    enabled: montant > 0,
    retry: false,
    refetchInterval: 5_000,
    placeholderData: (avant) => avant,
  });
}

/** Après une écriture : tout se relit. Le moteur a le dernier mot. */
export function useRafraichir() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}
