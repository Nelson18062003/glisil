/*
 * LA CONFIGURATION DU VEILLEUR, lue une fois, pour ses deux maisons : le
 * service Node (`npm run veilleur`, une boucle) et la fonction Supabase
 * `veilleur` (un tour par appel, relancée chaque minute). Mêmes variables,
 * mêmes défauts — voir README.md.
 */
import { estReseau, fiche, graineValide, prefixe, RESEAUX, variableDuNoeud, type Reseau } from "./cles.ts";
import { ChaineEvm } from "./evm.ts";
import { moteur, type Rpc } from "./moteur.ts";
import { fixerLePlafondDEssai, inscrire, signataireEvm, signataireTron } from "./signataire.ts";
import { ChaineTron } from "./tron.ts";
import { Veilleur, type ConfigVeilleur } from "./veilleur.ts";

export type Env = Record<string, string | undefined>;

/** Les réglages d'un réseau tels que les paramètres « chaine » les portent (migration 0007). */
export type ConfigReseau = {
  // pas de clé d'API ici : les paramètres se lisent par les comptes connectés. TRC20_CLE_API est un secret de la fonction.
  noeud: string; usdt: string; xafe: string; confirmations?: number;
  froid?: string; plafond_chaud_usdt?: number; garder_chaud_usdt?: number; natif_minimum?: number;
  /** le bloc du déploiement du contrat XAFe : la lecture du jeton part de là */
  depart?: number;
  /** ce que le registre de la base dit du réseau (0018) : vérifié contre celui du code */
  famille?: string; compte_hd?: number;
};
export type ConfigurationMoteur = {
  essai: boolean; bep20: ConfigReseau | null; trc20: ConfigReseau | null;
  /** chaque réseau configuré (0018) ; absent d'une base d'avant, où bep20 et trc20 suffisent */
  reseaux?: Record<string, ConfigReseau | null>;
  jeton: string | null; graine: string | null; admin_cle_essai: string | null;
};

/**
 * Ce que la base donne (chaine_configuration) → les variables du veilleur.
 * Les variables déjà posées (secrets de la fonction, environnement du service)
 * passent AVANT : en production, la graine vient d'un secret, jamais de la base.
 */
export function envDepuisConfiguration(c: ConfigurationMoteur, env: Env): Env {
  const e: Env = {};
  const reseau = (id: Reseau, r: ConfigReseau | null | undefined) => {
    if (!r || !r.noeud) return;
    const p = prefixe(id);
    e[variableDuNoeud(id)] = r.noeud;
    e[`${p}_USDT`] = r.usdt;
    e[`${p}_XAFE`] = r.xafe;
    if (r.confirmations != null) e[`${p}_CONFIRMATIONS`] = String(r.confirmations);
    if (r.froid) e[`${p}_FROID`] = r.froid;
    if (r.plafond_chaud_usdt != null) e[`${p}_PLAFOND_CHAUD_USDT`] = String(r.plafond_chaud_usdt);
    if (r.garder_chaud_usdt != null) e[`${p}_GARDER_CHAUD_USDT`] = String(r.garder_chaud_usdt);
    if (r.natif_minimum != null) e[`${p}_NATIF_MINIMUM`] = String(r.natif_minimum);
    if (r.depart != null) e[`${p}_DEPART`] = String(r.depart);
    if (r.famille != null) e[`${p}_FAMILLE`] = r.famille;
    if (r.compte_hd != null) e[`${p}_COMPTE_HD`] = String(r.compte_hd);
    // réseau d'essai seulement : la clé admin d'essai inscrit les adresses XAFe
    if (c.essai && c.admin_cle_essai) e[`${p}_ADMIN_CLE_ESSAI`] = c.admin_cle_essai;
  };
  const tous = c.reseaux ?? { bep20: c.bep20, trc20: c.trc20 };
  // un réseau que la base connaît et pas ce code (un veilleur pas encore mis à jour) : il l'ignore
  for (const [id, r] of Object.entries(tous)) if (estReseau(id)) reseau(id, r);
  if (c.essai && c.graine) e.XAFE_GRAINE = c.graine;
  if (c.jeton) e.VEILLEUR_JETON = c.jeton;
  const resultat: Env = { ...e };
  for (const [k, v] of Object.entries(env)) if (v !== undefined && v !== "") resultat[k] = v;
  return resultat;
}

/**
 * La base et le code doivent dériver les mêmes adresses : si le registre de la
 * base donne une autre famille ou un autre compte que celui du code, le
 * veilleur REFUSE de tourner — sinon il préparerait des adresses dont la base
 * croirait connaître le chemin, et une clé ne se retrouverait plus.
 */
export function verifierLeRegistre(id: Reseau, env: Env) {
  const f = fiche(id), p = prefixe(id);
  const famille = env[`${p}_FAMILLE`], compte = env[`${p}_COMPTE_HD`];
  if (famille != null && famille !== f.famille) throw new Error(`${id} : la base dit famille « ${famille} », le code « ${f.famille} »`);
  if (compte != null && Number(compte) !== f.compte) throw new Error(`${id} : la base dit compte de dérivation ${compte}, le code ${f.compte}`);
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
  const commun = (id: Reseau): ConfigVeilleur => {
    const p = prefixe(id), f = fiche(id);
    // RÉSEAU D'ESSAI : une clé admin d'essai peut inscrire elle-même les adresses XAFe. Jamais en production.
    const cleEssai = env[`${p}_ADMIN_CLE_ESSAI`];
    const noeud = env[variableDuNoeud(id)]!;
    return {
      graine,
      journal,
      reserve: Number(env.RESERVE_ADRESSES ?? 20),
      parTour: Number(env.ADRESSES_PAR_TOUR ?? 10),
      seuilBalayage: Number(env.SEUIL_BALAYAGE_USDT ?? 50),
      // les mêmes seuils que « mise-en-service verifier » : en dessous, quelques retraits seulement passent encore
      natifMinimum: Number(env[`${p}_NATIF_MINIMUM`] ?? f.natifMinimum),
      departJeton: env[`${p}_DEPART`] ? Number(env[`${p}_DEPART`]) : undefined,
      blocsJetonParTour: Number(env[`${p}_BLOCS_JETON_PAR_TOUR`] ?? f.blocsParTour),
      froid: env[`${p}_FROID`] ? { adresse: env[`${p}_FROID`]!, plafondChaud: Number(env[`${p}_PLAFOND_CHAUD_USDT`] ?? 20000), garderChaud: Number(env[`${p}_GARDER_CHAUD_USDT`] ?? 10000) } : undefined,
      inscrire: cleEssai
        ? (adresses) => inscrire(f.famille === "evm" ? signataireEvm(noeud, cleEssai, id) : signataireTron(noeud, cleEssai, env.TRC20_CLE_API), env[`${p}_XAFE`]!, adresses)
        : undefined,
      // la même clé d'essai tient le plafond de frappe du jour au chiffre fixé par le propriétaire
      plafondDEssai: cleEssai && env[`${p}_XAFE`]
        ? () => fixerLePlafondDEssai(f.famille === "evm" ? signataireEvm(noeud, cleEssai, id) : signataireTron(noeud, cleEssai, env.TRC20_CLE_API), env[`${p}_XAFE`]!)
        : undefined,
    };
  };
  const veilleurs: Veilleur[] = [];
  for (const id of Object.keys(RESEAUX) as Reseau[]) {
    const noeud = env[variableDuNoeud(id)];
    if (!noeud || !veut(id)) continue;
    verifierLeRegistre(id, env);
    const p = prefixe(id), f = fiche(id);
    const confirmations = Number(env[`${p}_CONFIRMATIONS`] ?? f.confirmations);
    const ch = f.famille === "evm"
      ? new ChaineEvm({ reseau: id, rpcUrl: noeud, usdt: env[`${p}_USDT`] ?? "", xafe: env[`${p}_XAFE`] ?? "", graine, confirmations })
      : new ChaineTron({ reseau: id, noeud, usdt: env[`${p}_USDT`] ?? "", xafe: env[`${p}_XAFE`] ?? "", graine, confirmations, cleApi: env.TRC20_CLE_API });
    await ch.demarrer();
    veilleurs.push(new Veilleur(ch, commun(id)));
  }
  if (!veilleurs.length) throw new Error(`aucun réseau configuré : ${Object.keys(RESEAUX).map((r) => variableDuNoeud(r as Reseau)).join(", ")}`);
  return veilleurs;
}
