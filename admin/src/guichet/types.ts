/*
 * Ce que l'administration lit : les lignes du moteur, telles que les RPC
 * admin_* les rendent (clés en snake_case, comme en base — l'outil est
 * interne, on ne traduit pas deux fois).
 */
import type { Droit, Role } from "../noyau/droits";

export type Profil = { id: string; email: string; nom: string; role: Role; actif: boolean; droits: Droit[] };

export type Terminal = { id: string; nom: string; lieu: string | null; vu_le: string | null; muet: boolean; a_cle?: boolean; floats?: Float[]; commandes_en_attente?: number };
export type Float = { id: number; operateur: string; numero: string; terminal: string | null; code_agent: string | null; actif: boolean; dossiers_ouverts?: number };

export type Tableau = {
  circulation: number;
  soldes: Record<string, { disponible: number; bloque: number }>;
  maison: Record<string, number>;
  comptes: number;
  jour: { entrees: number; sorties: number; volume_usdt: number; frais_xafe: number };
  retenues: { nombre: number; montant: number };
  sorties_en_cours: number;
  declarations_attendues: number;
  verifications: number;
  terminaux: Terminal[];
  floats: Float[];
  cotation: Cotation;
};

export type Cotation = { dernier: number | null; il_y_a_24h: number | null; haut: number | null; bas: number | null; volume_usdt: number; volume_xafe: number; meilleur_achat: number | null; meilleure_vente: number | null };

export type Declaration = { id: string; transaction_id: string; etat: "attendu" | "credite" | "refuse"; montant: number | null; numero_payeur: string | null; motif: string | null; declare_le: string; credite_le: string | null };
export type Entree = {
  reference: string; etat: string; operateur: string; montant_recu: number; float_numero: string; code_agent: string | null;
  declarations: Declaration[]; cree_le: string; expire_le: string; credite_le: string | null;
  compte: { id: string; telephone: string; nom: string | null; palier: number };
};
export type Retenue = {
  id: number; terminal: string; operateur: string; float_numero: string; numero_payeur: string | null; montant: number | null; reference_operateur: string | null;
  transaction_id: string | null; texte: string | null; emis_le: string | null; etat: "retenue" | "rapprochee" | "remboursee"; depot_reference: string | null; cree_le: string;
  /** pourquoi l'appariement automatique a refusé ; « bloquee » : seule l'équipe la dénoue */
  motif?: string | null; bloquee?: boolean;
  compte_suggere: { id: string; nom: string | null; telephone: string } | null;
};
export type Transfert = { id: number; terminal: string; etat: string; montant_xafe: number; montant_envoye: number; reprises: number; resultat: string | null; reference_operateur: string | null; reclamee_le: string | null };
export type Sortie = {
  reference: string; etat: string; operateur: string; numero: string; montant: number; frais: number; montant_xaf: number; montant_envoye: number; montant_rendu: number;
  cree_le: string; terminee_le: string | null; transferts: Transfert[]; compte: { id: string; telephone: string; nom: string | null };
};
export type Client = {
  id: string; telephone: string; nom: string | null; entreprise: string | null; palier: number; verification_en_cours: "identite" | "entreprise" | null;
  cree_le: string; desactive_le: string | null; xafe: number; usdt: number;
};
export type ClientDetail = {
  compte: Client & { a_code: boolean; verrou_jusqua: string | null; verification_pieces: string[] | null; code_verrou_jusqua: string | null };
  soldes: Record<string, { disponible: number; bloque: number }>;
  numeros: { id: string; operateur: string; numero: string; verifie_le: string | null; actif_des: string; retire_le: string | null }[];
  depots: Omit<Entree, "compte">[];
  sorties: Omit<Sortie, "compte" | "transferts">[];
  ordres: { id: string; numero: string; cote: string; type: string; prix: number | null; quantite: number; executee: number; total_xafe: number; etat: string; cree_le: string }[];
  ecritures: { actif: string; disponible: number; bloque: number; nature: string; source: string; quand: string }[];
};
export type Marche = {
  cotation: Cotation;
  carnet: { achats: { prix: number; quantite: number; ordres: number }[]; ventes: { prix: number; quantite: number; ordres: number }[]; dernier: number | null };
  transactions: { prix: number; quantite: number; preneur: string; cree_le: string }[];
  ordres_ouverts: number;
  parametres: { paire: string; pas_prix: number; quantite_min: number; ouvert: boolean };
  frais: { placeur: number; preneur: number; sortie: number };
  chandelles: { t: string; o: number; h: number; l: number; c: number; v: number }[];
};
export type Parametres = Record<string, unknown> & { operateurs?: { id: string; nom: string; plafond_par_transfert: number; plafond_jour: number | null }[] };
export type LigneJournal = { id: number; admin: string | null; action: string; cible: string | null; detail: unknown; quand: string };
