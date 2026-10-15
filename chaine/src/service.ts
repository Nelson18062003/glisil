/*
 * LA CONFIGURATION DU VEILLEUR, lue une fois, pour ses deux maisons : le
 * service Node (`npm run veilleur`, une boucle) et la fonction Supabase
 * `veilleur` (un tour par appel, relancée chaque minute). Mêmes variables,
 * mêmes défauts — voir README.md.
 */
import type { Reseau } from "./cles.ts";
import { graineValide } from "./cles.ts";
import { ChaineEvm } from "./evm.ts";
import { moteur, type Rpc } from "./moteur.ts";
import { inscrire, signataireEvm, signataireTron } from "./signataire.ts";
import { ChaineTron } from "./tron.ts";
import { Veilleur, type ConfigVeilleur } from "./veilleur.ts";

export type Env = Record<string, string | undefined>;

/** Les réglages d'un réseau tels que les paramètres « chaine » les portent (migration 0007). */
export type ConfigReseau = {
  // pas de clé d'API ici : les paramètres se lisent par les comptes connectés. TRC20_CLE_API est un secret de la fonction.
  noeud: string; usdt: string; xafe: string; confirmations?: number;
  froid?: string; plafond_chaud_usdt?: number; garder_chaud_usdt?: number; natif_minimum?: number;
};
export type ConfigurationMoteur = {
  essai: boolean; bep20: ConfigReseau | null; trc20: ConfigReseau | null;
  jeton: string | null; graine: string | null; admin_cle_essai: string | null;
};

/**
 * Ce que la base donne (chaine_configuration) → les variables du veilleur.
 * Les variables déjà posées (secrets de la fonction, environnement du service)
 * passent AVANT : en production, la graine vient d'un secret, jamais de la base.
 */
export function envDepuisConfiguration(c: ConfigurationMoteur, env: Env): Env {
  const e: Env = {};
  const reseau = (p: "BEP20" | "TRC20", r: ConfigReseau | null) => {
    if (!r) return;
    e[p === "BEP20" ? "BEP20_RPC" : "TRC20_NOEUD"] = r.noeud;
    e[`${p}_USDT`] = r.usdt;
    e[`${p}_XAFE`] = r.xafe;
    if (r.confirmations != null) e[`${p}_CONFIRMATIONS`] = String(r.confirmations);
    if (r.froid) e[`${p}_FROID`] = r.froid;
    if (r.plafond_chaud_usdt != null) e[`${p}_PLAFOND_CHAUD_USDT`] = String(r.plafond_chaud_usdt);
    if (r.garder_chaud_usdt != null) e[`${p}_GARDER_CHAUD_USDT`] = String(r.garder_chaud_usdt);
    if (r.natif_minimum != null) e[`${p}_NATIF_MINIMUM`] = String(r.natif_minimum);
    // réseau d'essai seulement : la clé admin d'essai inscrit les adresses XAFe
    if (c.essai && c.admin_cle_essai) e[`${p}_ADMIN_CLE_ESSAI`] = c.admin_cle_essai;
  };
  reseau("BEP20", c.bep20);
  reseau("TRC20", c.trc20);
  if (c.essai && c.graine) e.XAFE_GRAINE = c.graine;
  if (c.jeton) e.VEILLEUR_JETON = c.jeton;
  const resultat: Env = { ...e };
  for (const [k, v] of Object.entries(env)) if (v !== undefined && v !== "") resultat[k] = v;
  return resultat;
}

export function moteurDepuis(env: Env): Rpc {
  if (!env.MOTEUR_URL || !env.MOTEUR_CLE) throw new Error("MOTEUR_URL et MOTEUR_CLE sont nécessaires");
  return moteur(env.MOTEUR_URL, env.MOTEUR_CLE);
}

/** Les réseaux configurés (ou ceux demandés), un veilleur chacun, prêts à tourner. */
export async function veilleursDepuis(env: Env, seulement?: Reseau[], journal?: (ligne: string) => void): Promise<Veilleur[]> {
  const graine = env.XAFE_GRAINE ?? "";
  if (!graineValide(graine)) throw new Error("XAFE_GRAINE manque ou n'est pas une graine valide (12 ou 24 mots)");
  const veut = (r: Reseau) => !seulement || seulement.includes(r);
  const commun = (prefixe: "BEP20" | "TRC20"): ConfigVeilleur => {
    // RÉSEAU D'ESSAI : une clé admin d'essai peut inscrire elle-même les adresses XAFe. Jamais en production.
    const cleEssai = env[`${prefixe}_ADMIN_CLE_ESSAI`];
    return {
      graine,
      journal,
      reserve: Number(env.RESERVE_ADRESSES ?? 20),
      parTour: Number(env.ADRESSES_PAR_TOUR ?? 10),
      seuilBalayage: Number(env.SEUIL_BALAYAGE_USDT ?? 50),
      // les mêmes seuils que « mise-en-service verifier » : sous 0,01 BNB ou 50 TRX, quelques retraits seulement passent encore
      natifMinimum: Number(env[`${prefixe}_NATIF_MINIMUM`] ?? (prefixe === "BEP20" ? 0.01 : 50)),
      froid: env[`${prefixe}_FROID`] ? { adresse: env[`${prefixe}_FROID`]!, plafondChaud: Number(env[`${prefixe}_PLAFOND_CHAUD_USDT`] ?? 20000), garderChaud: Number(env[`${prefixe}_GARDER_CHAUD_USDT`] ?? 10000) } : undefined,
      inscrire: cleEssai
        ? (adresses) => inscrire(prefixe === "BEP20" ? signataireEvm(env.BEP20_RPC!, cleEssai) : signataireTron(env.TRC20_NOEUD!, cleEssai, env.TRC20_CLE_API), prefixe === "BEP20" ? env.BEP20_XAFE! : env.TRC20_XAFE!, adresses)
        : undefined,
    };
  };
  const veilleurs: Veilleur[] = [];
  if (env.BEP20_RPC && veut("bep20")) {
    const ch = new ChaineEvm({ rpcUrl: env.BEP20_RPC, usdt: env.BEP20_USDT ?? "", xafe: env.BEP20_XAFE ?? "", graine, confirmations: Number(env.BEP20_CONFIRMATIONS ?? 15) });
    await ch.demarrer();
    veilleurs.push(new Veilleur(ch, commun("BEP20")));
  }
  if (env.TRC20_NOEUD && veut("trc20")) {
    const ch = new ChaineTron({ noeud: env.TRC20_NOEUD, usdt: env.TRC20_USDT ?? "", xafe: env.TRC20_XAFE ?? "", graine, confirmations: Number(env.TRC20_CONFIRMATIONS ?? 20), cleApi: env.TRC20_CLE_API });
    await ch.demarrer();
    veilleurs.push(new Veilleur(ch, commun("TRC20")));
  }
  if (!veilleurs.length) throw new Error("aucun réseau configuré : BEP20_RPC et/ou TRC20_NOEUD");
  return veilleurs;
}
