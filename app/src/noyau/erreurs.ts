/*
 * Une erreur se dit en trois lignes : ce qui s'est passé, ce que ça change
 * pour l'argent, et quoi faire. Jamais un message technique brut.
 * Les phrases du moteur (RAISE EXCEPTION) sont les clés.
 */

export type ErreurLisible = {
  titre: string;
  argent: string;
  suite: string;
  /** vrai quand le geste n'a sûrement rien fait et peut être recommencé */
  recommencer: boolean;
};

const DICTIONNAIRE: Record<string, Omit<ErreurLisible, "recommencer"> & { recommencer?: boolean }> = {
  "solde insuffisant": {
    titre: "Le solde ne suffit pas",
    argent: "Rien n'a bougé : aucun XAFe ni USDT n'a été bloqué.",
    suite: "Baissez le montant ou entrez des XAF d'abord.",
  },
  "plafond du palier atteint": {
    titre: "Votre palier ne permet pas ce montant aujourd'hui",
    argent: "Rien n'a bougé.",
    suite: "Passez au palier suivant dans Compte → Paliers, ou attendez demain.",
  },
  "numéro pas encore actif": {
    titre: "Ce numéro n'est pas encore utilisable",
    argent: "Rien n'a bougé.",
    suite: "Un numéro ajouté devient actif 24 h après sa vérification.",
  },
  "numéro inconnu sur ce compte": {
    titre: "Ce numéro n'est pas sur votre compte",
    argent: "Rien n'a bougé.",
    suite: "Ajoutez-le dans Compte → Mes numéros MoMo.",
  },
  "prix invalide": {
    titre: "Le prix doit être un multiple de 0,05",
    argent: "Aucun ordre n'a été placé.",
    suite: "Corrigez le prix, par exemple 618,40 plutôt que 618,41.",
  },
  "quantité invalide": {
    titre: "La quantité est trop petite",
    argent: "Aucun ordre n'a été placé.",
    suite: "Au moins 10 USDT, avec deux décimales au plus.",
  },
  "marché fermé": {
    titre: "Le marché est fermé pour le moment",
    argent: "Aucun ordre n'a été placé.",
    suite: "Réessayez dans quelques minutes.",
  },
  "cet ordre ne peut plus être annulé": {
    titre: "Cet ordre est déjà exécuté ou annulé",
    argent: "Ses fonds sont déjà réglés ou libérés.",
    suite: "Regardez son détail dans Mes ordres.",
    recommencer: false,
  },
  "code secret incorrect": {
    titre: "Code secret incorrect",
    argent: "Rien n'a bougé.",
    suite: "Réessayez. Après trois erreurs, le compte se verrouille 15 minutes.",
  },
  "compte verrouillé": {
    titre: "Compte verrouillé 15 minutes",
    argent: "Rien n'a bougé.",
    suite: "Trois codes faux : attendez avant de réessayer.",
  },
  "ce dépôt ne peut plus être annulé": {
    titre: "Ce dépôt est déjà réglé",
    argent: "S'il a été crédité, vos XAFe sont là.",
    suite: "Regardez-le dans Historique.",
    recommencer: false,
  },
  "aucun terminal disponible pour cet opérateur": {
    titre: "Aucun terminal ne porte cet opérateur en ce moment",
    argent: "Rien n'a bougé.",
    suite: "Réessayez dans quelques minutes ou passez par l'autre opérateur.",
  },
  "non connecté": {
    titre: "Votre session a expiré",
    argent: "Rien n'a bougé.",
    suite: "Reconnectez-vous pour continuer.",
  },
  "réseau": {
    titre: "Pas de réseau",
    argent: "On ne sait pas si la demande est partie. Ne la refaites pas tout de suite.",
    suite: "Regardez Historique dans une minute : si rien n'y est, recommencez.",
    recommencer: false,
  },
};

export function lisible(e: unknown): ErreurLisible {
  const message = (e instanceof Error ? e.message : typeof e === "string" ? e : String((e as { message?: string })?.message ?? "")).trim();
  const minuscule = message.toLowerCase();
  for (const cle of Object.keys(DICTIONNAIRE)) {
    if (minuscule.startsWith(cle)) {
      const d = DICTIONNAIRE[cle];
      return { ...d, recommencer: d.recommencer ?? true };
    }
  }
  if (/fetch|network|réseau|timeout|failed to/i.test(message)) {
    const d = DICTIONNAIRE["réseau"];
    return { ...d, recommencer: false };
  }
  return {
    titre: "Ça n'a pas marché",
    argent: "Rien n'a bougé si l'écran ne dit pas le contraire.",
    suite: message || "Réessayez dans un instant.",
    recommencer: true,
  };
}

export class ErreurMoteur extends Error {
  detail?: string;
  constructor(message: string, detail?: string) {
    super(message);
    this.detail = detail;
  }
}
