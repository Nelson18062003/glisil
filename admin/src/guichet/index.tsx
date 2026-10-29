import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { GuichetDemo } from "./demo";
import type { GuichetAdmin } from "./guichet";
import { GuichetSupabase } from "./supabase";

const Contexte = createContext<GuichetAdmin | null>(null);

export function ouvrirLeGuichet(): GuichetAdmin {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const cle = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && cle ? new GuichetSupabase(url, cle) : new GuichetDemo();
}

export const client = new QueryClient({ defaultOptions: { queries: { staleTime: 3_000, retry: 1 } } });

export function GuichetProvider({ guichet, children }: { guichet: GuichetAdmin; children: ReactNode }) {
  useEffect(() => guichet.surChangement(() => { void client.invalidateQueries(); }), [guichet]);
  return <Contexte.Provider value={guichet}><QueryClientProvider client={client}>{children}</QueryClientProvider></Contexte.Provider>;
}

export function useGuichet(): GuichetAdmin {
  const g = useContext(Contexte);
  if (!g) throw new Error("GuichetProvider manquant");
  return g;
}

export function useTableau() { const g = useGuichet(); return useQuery({ queryKey: ["tableau"], queryFn: () => g.tableau(), refetchInterval: 10_000 }); }
export function useEntrees(etat?: string | null) { const g = useGuichet(); return useQuery({ queryKey: ["entrees", etat ?? "tout"], queryFn: () => g.entrees(etat), refetchInterval: 10_000 }); }
export function useRetenues(etat: "retenue" | "rapprochee" | "remboursee") { const g = useGuichet(); return useQuery({ queryKey: ["retenues", etat], queryFn: () => g.retenues(etat), refetchInterval: 10_000 }); }
export function useSorties(etat?: string | null) { const g = useGuichet(); return useQuery({ queryKey: ["sorties", etat ?? "tout"], queryFn: () => g.sorties(etat), refetchInterval: 10_000 }); }
export function useSortiesNonExpliquees() { const g = useGuichet(); return useQuery({ queryKey: ["sorties-non-expliquees"], queryFn: () => g.sortiesNonExpliquees(), refetchInterval: 30_000 }); }
/** Ce qui attend l'équipe : remboursements à payer, à confirmer, argent sorti sans explication. */
export function useATraiter() { const g = useGuichet(); return useQuery({ queryKey: ["a-traiter"], queryFn: () => g.aTraiter(), refetchInterval: 15_000 }); }
export function useTerminaux() { const g = useGuichet(); return useQuery({ queryKey: ["terminaux"], queryFn: () => g.terminaux(), refetchInterval: 15_000 }); }
export function useClients(recherche: string, filtre?: string | null) { const g = useGuichet(); return useQuery({ queryKey: ["clients", recherche, filtre ?? ""], queryFn: () => g.clients(recherche, filtre) }); }
export function useStatistiquesClients() { const g = useGuichet(); return useQuery({ queryKey: ["clients-stats"], queryFn: () => g.statistiquesClients(), refetchInterval: 30_000 }); }
export function useClient(id: string | undefined) { const g = useGuichet(); return useQuery({ queryKey: ["client", id], queryFn: () => g.client(id!), enabled: Boolean(id) }); }
export function useSecurite(id: string | undefined) { const g = useGuichet(); return useQuery({ queryKey: ["securite", id], queryFn: () => g.securite(id!), enabled: Boolean(id) }); }
export function useEquipe() { const g = useGuichet(); return useQuery({ queryKey: ["equipe"], queryFn: () => g.equipe() }); }
export function useMarche() { const g = useGuichet(); return useQuery({ queryKey: ["marche"], queryFn: () => g.marche(), refetchInterval: 5_000 }); }
export function useParametres() { const g = useGuichet(); return useQuery({ queryKey: ["parametres"], queryFn: () => g.parametres() }); }
export function useJournal() { const g = useGuichet(); return useQuery({ queryKey: ["journal"], queryFn: () => g.journal(), refetchInterval: 15_000 }); }
export function useReseaux() { const g = useGuichet(); return useQuery({ queryKey: ["reseaux"], queryFn: () => g.reseaux() }); }
export function useWallets() { const g = useGuichet(); return useQuery({ queryKey: ["wallets"], queryFn: () => g.wallets(), refetchInterval: 15_000 }); }
/** La parité à trois colonnes : relue souvent, c'est la question qui compte. */
export function useParite() { const g = useGuichet(); return useQuery({ queryKey: ["parite"], queryFn: () => g.parite(), refetchInterval: 20_000 }); }
/** La page Bêta : relue souvent, les robots tournent toutes les trente secondes. */
export function useBeta() { const g = useGuichet(); return useQuery({ queryKey: ["beta"], queryFn: () => g.beta(), refetchInterval: 15_000 }); }
export function useSignalements(etat?: "nouveau" | "vu" | "regle" | null) { const g = useGuichet(); return useQuery({ queryKey: ["signalements", etat ?? "tout"], queryFn: () => g.signalements(etat), refetchInterval: 30_000 }); }
export function useRafraichir() { const qc = useQueryClient(); return () => qc.invalidateQueries(); }
