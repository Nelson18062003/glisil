/*
 * Le guichet, branché à React : un seul guichet pour toute l'application,
 * des lectures en cache (TanStack Query) qui se rafraîchissent d'elles-mêmes
 * quand le moteur dit que quelque chose a bougé.
 */
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { GuichetDemo } from "./demo";
import type { Guichet } from "./guichet";
import { GuichetSupabase } from "./supabase";
import type { Actif, Reseau } from "./types";

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
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </Contexte.Provider>
  );
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
export function useOperation(ref: string | undefined) {
  const { data, ...reste } = useHistorique();
  const op = useMemo(() => data?.find((o) => o.reference === ref) ?? null, [data, ref]);
  return { data: op, ...reste };
}
export function useNotifications() { const g = useGuichet(); return useQuery({ queryKey: cles.notifications, queryFn: () => g.notifications(), refetchInterval: 20_000 }); }
export function useAdresseDepot(actif: Actif, reseau: Reseau) { const g = useGuichet(); return useQuery({ queryKey: cles.adresse(actif, reseau), queryFn: () => g.adresseDepot(actif, reseau) }); }
export function useRetraitCrypto(ref: string | undefined) { const g = useGuichet(); return useQuery({ queryKey: cles.retrait(ref ?? ""), queryFn: () => g.retraitCrypto(ref!), enabled: Boolean(ref), refetchInterval: 3_000 }); }

/** Après une écriture : tout se relit. Le moteur a le dernier mot. */
export function useRafraichir() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}
