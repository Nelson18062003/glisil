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
