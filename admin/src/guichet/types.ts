/*
 * Ce que l'administration lit : les lignes du moteur, telles que les RPC
 * admin_* les rendent (clés en snake_case, comme en base — l'outil est
 * interne, on ne traduit pas deux fois).
 */
import type { Droit, Role } from "../noyau/droits";

export type Profil = { id: string; email: string; nom: string; role: Role; actif: boolean; droits: Droit[] };

export type Terminal = { id: string; nom: string; lieu: string | null; vu_le: string | null; muet: boolean; demo?: boolean; a_cle?: boolean; floats?: Float[]; commandes_en_attente?: number };
export type Float = { id: number; operateur: string; numero: string; terminal: string | null; code_agent: string | null; titulaire?: string | null; actif: boolean; dossiers_ouverts?: number };

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
  transaction_id: string | null; texte: string | null; emis_le: string | null; etat: "retenue" | "rapprochee" | "remboursee" | "rejetee"; depot_reference: string | null; cree_le: string;
  /** pourquoi l'appariement automatique a refusé ; « bloquee » : seule l'équipe la dénoue */
  motif?: string | null; bloquee?: boolean;
  compte_suggere: { id: string; nom: string | null; telephone: string } | null;
  /* 0039 : la garde des faux SMS. Le solde annoncé suit-il le dernier solde sûr du float ? */
  continuite?: Continuite | null;
  /** retenue POUR SON SOLDE : ni rapprochée ni remboursée tant que l'équipe ne l'a pas libérée ou rejetée */
  solde_a_verifier?: boolean;
  solde_apres?: number | null; solde_attendu?: number | null;
  /** le dernier solde sûr qui a servi d'appui */
  ancre?: { solde: number; annonce_le: string; source: "sms" | "ussd" | "releve" } | null;
  liberee_le?: string | null; liberee_par?: string | null; note_equipe?: string | null;
};
export type Continuite = "verifiee" | "incoherente" | "absente" | "sans_ancre" | "ignoree" | "liberee" | "rejetee";
export type Transfert = { id: number; terminal: string; etat: string; montant_xafe: number; montant_envoye: number; reprises: number; resultat: string | null; reference_operateur: string | null; reclamee_le: string | null };
export type Sortie = {
  reference: string; etat: string; operateur: string; numero: string; montant: number; frais: number; montant_xaf: number; montant_envoye: number; montant_rendu: number;
  cree_le: string; terminee_le: string | null; transferts: Transfert[]; compte: { id: string; telephone: string; nom: string | null; palier?: number };
  /** « manuel » (0014) : l'équipe paie elle-même, puis donne le transaction ID */
  mode?: "totem" | "manuel";
  /** le nom du compte Mobile Money, tel que le client l'a écrit */
  nom_beneficiaire?: string | null;
  pris_le?: string | null; pris_par?: string | null;
  transaction_id?: string | null; preuve?: string | null;
  payee_le?: string | null; payee_par?: string | null; payee_par_moi?: boolean;
  confirmee_par?: string | null;
  /** payée, attend qu'une AUTRE personne confirme (au-delà du seuil) */
  a_confirmer?: boolean;
  motif?: string | null;
  /** le SMS que la puce a reçu pour chaque paiement : concorde, écart, absent, ou payé en partie */
  rapprochement?: Rapprochement | null;
  /* 0038 : le remboursement PROUVÉ. Les XAFe ne sont détruits que lorsque le SMS de la puce montre chaque paiement. */
  /** ce que le client voit : les paiements actifs */
  paiements?: { transaction_id: string; montant: number }[];
  /** ce que l'équipe voit : tous les paiements, retirés compris (un ID mal tapé, remplacé) */
  paiements_equipe?: PaiementEquipe[];
  /** ce qui reste à payer (XAF) : un gros remboursement se paie en plusieurs transferts */
  reste?: number;
  en_preuve?: boolean;
  prouvee_le?: string | null;
  /** la preuve était là, la clôture a échoué : « Revérifier » */
  cloture_erreur?: string | null;
  forcee_par?: string | null; forcee_le?: string | null; forcee_note?: string | null;
  /** le forçage est ouvert, 30 minutes sont passées, tout est payé, et la preuve manque */
  forcage_possible?: boolean;
  /** les SMS relevés qui pourraient prouver ce qui reste à payer */
  candidats?: Candidat[];
};
export type PaiementEquipe = { transaction_id: string; montant: number; saisi_par: string | null; saisi_le: string; retire_le: string | null; retire_note: string | null; constatee_id: number | null };
export type Candidat = { id: number; transaction_id: string; montant: number | null; emis_le: string | null; terminal: string };
/** Un paiement jugé contre les SMS de la puce. */
export type PreuvePaiement = { transaction_id: string; montant_saisi: number; etat: "concorde" | "ecart" | "absent"; motif?: string | null; constatee_id?: number; montant?: number | null; numero?: string | null; terminal?: string; emis_le?: string | null; texte?: string | null };
export type Rapprochement = {
  etat: "concorde" | "ecart" | "absent" | "partiel"; motif?: string | null; paye?: number; reste?: number; paiements?: PreuvePaiement[];
  /* un seul paiement : ses clés à plat, comme avant */
  montant?: number | null; numero?: string | null; terminal?: string; emis_le?: string | null; texte?: string | null;
};
/** Ce que les puces ont vu partir et qu'aucune sortie n'explique. */
export type SortieNonExpliquee = { id: number; terminal: string; operateur: string; float_numero: string | null; numero: string | null; montant: number | null; transaction_id: string | null; texte: string | null; emis_le: string | null };
export type ATraiter = {
  sorties_manuelles: number; sorties_a_confirmer: number; montant_a_payer: number; sorties_non_expliquees: number;
  /** payées, en attente du SMS de la puce (0038) ; dont en écart */
  sorties_en_preuve?: number; sorties_en_ecart?: number;
  /** les SMS d'encaissement retenus parce que leur solde ne suit pas (0039) */
  retenues_solde?: number;
  /** le dernier relevé de parité (0016) : null tant qu'aucun n'a été fait */
  parite?: { statut: StatutParite; ecart: number | null; couverture: number | null; fait_le: string; alertes: number } | null;
};

/* ─────────────────────────── la parité (0016) ─────────────────────────── */
export type StatutParite = "juste" | "en_cours" | "ecart" | "incomplet";
export type VerdictLigne = "concorde" | "en_route" | "en_retard" | "refusee" | "ecart" | "inconnue";
/** Une ligne du rapprochement : ce que le registre attend sur la chaîne, et ce que la chaîne montre. */
export type LigneParite = {
  reference: string | null; nature: "reserve" | "retrait" | "retour" | "inconnue"; reseau: "bep20" | "trc20"; genre: "frappe" | "destruction";
  montant: number | null; etat_registre?: string | null; tx_attendu?: string | null; depuis: string;
  empreinte: string | null; tx_vu: string | null; bloc_vu: number | null; montant_vu: number | null; adresse_vue?: string | null; verdict: VerdictLigne;
};
export type JetonLu = { reseau: "bep20" | "trc20"; offre: number | null; reserve: number | null; bloc: number | null; a_jour: boolean; lu_le: string | null };
export type FloatParite = { id: number; operateur: string; numero: string; solde: number | null; annonce_le: string | null; source: "sms" | "ussd" | "releve" | null; connu: boolean };
export type ReleveParite = {
  id: number; fait_le: string; registre: number; dans_comptes: number; sur_wallets: number;
  chaine: number | null; offre_lue: number | null; en_route: number; ecart: number | null;
  floats: number | null; couverture: number | null; anomalies: number; statut: StatutParite;
  reseaux: JetonLu[]; floats_detail: FloatParite[];
};
export type AlerteParite = {
  id: number; code: string; gravite: "grave" | "anomalie" | "attention"; message: string; detail: unknown;
  ouverte_le: string; vue_le: string; vues: number; sms_le: string | null; close_le: string | null;
};
export type ContratXafe = { reseau: "bep20" | "trc20"; contrat: string | null; explorateur: string; reserve: string | null };
export type Parite = {
  releve: ReleveParite | null;
  historique: { fait_le: string; statut: StatutParite; registre: number; chaine: number | null; ecart: number | null; floats: number | null }[];
  contrats: ContratXafe[]; essai: boolean; lignes: LigneParite[]; alertes: AlerteParite[];
  reglages: { alerte_numero: string | null; alerte_operateur: "mtn" | "om"; fraicheur_heures: number; delai_minutes: number; publier_floats: boolean } | null;
  floats: { id: number; operateur: string; numero: string; titulaire: string | null; actif: boolean;
            dernier: { solde: number; annonce_le: string; source: "sms" | "ussd" | "releve"; preuve: string | null; note: string | null } | null }[];
};
export type Client = {
  id: string; telephone: string; nom: string | null; entreprise: string | null; palier: number; verification_en_cours: "identite" | "entreprise" | null;
  cree_le: string; desactive_le: string | null; xafe: number; usdt: number;
  email: string | null; ville: string | null; pays: string | null;
  /** la dernière écriture sur son compte (un mouvement d'argent) */
  derniere_operation: string | null;
  derniere_connexion: string | null;
};
export type ClientDetail = {
  compte: Client & {
    a_code: boolean; verrou_jusqua: string | null; verification_pieces: string[] | null; code_verrou_jusqua: string | null;
    prenom: string | null; nom_de_famille: string | null; date_naissance: string | null;
    /** fermé par le client lui-même (0012) ; desactive_le est posé en même temps */
    ferme_le?: string | null;
    conditions_version?: string | null; conditions_acceptees_le?: string | null; conditions_a_jour?: boolean;
  };
  totaux?: { entre_xaf: number; sorti_xaf: number; ordres: number; retraits_crypto: number };
  retraits_crypto?: { reference: string; actif: string; reseau: string; adresse: string; montant: number; frais: number; etat: string; tx_hash: string | null; cree_le: string }[];
  transferts_crypto?: { id: string | number; actif: string; reseau: string; sens: "entree" | "sortie"; montant: number; adresse: string | null; tx_hash: string | null; cree_le: string }[];
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
export type Parametres = Record<string, unknown> & { operateurs?: { id: string; nom: string; plafond_par_transfert: number | null; plafond_jour: number | null }[] };
export type LigneJournal = { id: number; admin: string | null; action: string; cible: string | null; detail: unknown; quand: string };

/** Ce que le veilleur de chaîne a publié à son dernier tour, réseau par réseau (admin_wallets). */
export type EtatChaine = {
  chaud: string; usdt_chaud: number; natif_chaud: number;
  froid: string | null; usdt_froid: number | null; plafond_chaud: number | null; garder_chaud: number | null;
  a_inscrire: string[]; alertes: string[];
};
/** Un réseau du registre (0018) : ouvert aux clients ou non, configuré, lisible par un veilleur. */
export type ReseauRegistre = {
  id: string; nom: string; norme: string; famille: "evm" | "tron" | "solana"; chain_id: number | null; natif: string;
  actif: boolean; maison: boolean; configure: boolean; lisible: boolean; explorateur: string | null; contrat: string | null; note: string | null;
  adresses_attribuees: number; retraits_en_cours: number;
};
export type ReseauWallets = {
  reseau: string; nom?: string; actif?: boolean; etat: EtatChaine | null; maj_le: string | null; muet: boolean;
  adresses_attribuees: number; adresses_libres: number; retraits_en_cours: number; retraits_remplaces: number; curseur: number | null;
};
export type Orphelin = { reseau: string; actif: string; adresse: string; montant: number; preuve: string; raison: string; vu_le: string };
export type Wallets = { reseaux: ReseauWallets[]; orphelins: Orphelin[]; du_usdt: number; maison_usdt: number };

/** Les chiffres en tête de la page Clients (admin_statistiques_clients). */
export type StatsClients = {
  total: number;
  /** ont bougé de l'argent dans les 30 derniers jours */
  actifs_30j: number;
  connectes_7j: number;
  nouveaux_7j: number;
  nouveaux_30j: number;
  verifies: number;
  en_verification: number;
  desactives: number;
  /** ont prouvé leur adresse e-mail sans finir leur profil */
  inscriptions_inachevees: number;
  par_pays: Record<string, number>;
  inscriptions_30j: { jour: string; n: number }[];
};

/** L'équipe (admin_equipe) : qui administre, qui est invité. */
export type Equipe = {
  administrateurs: { id: string; email: string; nom: string; role: import("../noyau/droits").Role; actif: boolean; cree_le: string; derniere_connexion: string | null; moi: boolean }[];
  invitations: { email: string; nom: string; role: import("../noyau/droits").Role; invite_le: string }[];
};

/** Un testeur a signalé un problème (0024). */
export type Signalement = {
  id: number; reference: string; compte_id: string; nom: string | null; texte: string; ecran: string | null; appareil: string | null;
  etat: "nouveau" | "vu" | "regle"; note: string | null; traite_le: string | null; cree_le: string;
};

/** Le dernier cours posé du vrai dollar (0022). */
export type CoursReel = { usd_xaf: number; eur_usd: number; prime: number; prix: number; source: string; date_source: string | null; releve_le: string };
export type ReleveCours = { id: number; source: string; date_source: string | null; eur_usd: number | null; usd_xaf: number | null; prix: number | null; pose: boolean; erreur: string | null; releve_le: string };

export type Robot = {
  id: string; nom: string; role: "teneur" | "trader"; biais: number; actions: number; refus: number; derniere_erreur: string | null; maj_le: string;
  xafe: number; usdt: number; ordres_ouverts: number;
};

/** La page Bêta (admin_beta) : qui teste, l'argent de test, les robots, le vrai dollar, les signalements. */
export type Beta = {
  beta: { actif: boolean; message: string | null; dotation: { XAFe: number; USDT: number }; depots_reels: boolean };
  testeurs: { total: number; nouveaux_24h: number; nouveaux_7j: number; ont_echange: number; actifs_24h: number };
  argent_de_test: { xafe_testeurs: number; usdt_testeurs: number; xafe_robots: number; usdt_robots: number; dotations: number };
  robots: {
    parametre: { actif: boolean; [cle: string]: unknown } | null;
    etat: { derive: number; tours: number; dernier_tour: string | null; dernier_choc: string | null; bilan: Record<string, unknown> | null } | null;
    cours: CoursReel | null;
    reference: number | null;
    robots: Robot[];
    echanges_24h: { total: number; robot_robot: number; avec_un_testeur: number; volume_usdt: number };
  };
  cours: { parametre: { actif: boolean; prime: number; saut_max: number } | null; reference: number | null; prix_reference: number | null; dernier: CoursReel | null; releves: ReleveCours[] };
  signalements: { nouveaux: number; vus: number; regles: number };
  derniers_signalements: Signalement[];
};

/** La fiche « Sécurité » d'une personne (admin_securite_utilisateur, 0035) : jamais une empreinte. */
export type SecuriteUtilisateur = {
  deux_facteurs: boolean;
  codes_restants: number;
  codes_confirmes_le: string | null;
  evenements: { evenement: string; par_admin: string | null; detail: Record<string, unknown> | null; cree_le: string }[];
  reinitialisations: { id: string; admin_id: string; demandee_le: string; faite_le: string | null; facteurs: number | null; echec: string | null; motif?: string }[];
};
