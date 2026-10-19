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
  /* ---- l'inscription et la connexion */
  "code incorrect ou expiré": {
    titre: "Ce code ne marche pas",
    argent: "Rien n'a bougé.",
    suite: "Vérifiez les six chiffres, ou demandez un nouveau code : un code reste valable quelques minutes.",
  },
  "trop de codes demandés : attendez une minute": {
    titre: "Trop de codes demandés",
    argent: "Rien n'a bougé.",
    suite: "Attendez une minute, puis demandez un nouveau code. Pensez à regarder dans vos courriers indésirables.",
  },
  "adresse e-mail invalide": {
    titre: "Cette adresse e-mail n'est pas valide",
    argent: "Rien n'a bougé.",
    suite: "Vérifiez qu'elle est écrite en entier, par exemple awa@exemple.com.",
  },
  "adresse e-mail non vérifiée": {
    titre: "Votre adresse e-mail n'est pas encore vérifiée",
    argent: "Aucun compte n'a été ouvert.",
    suite: "Reconnectez-vous avec le code reçu par e-mail.",
  },
  "il faut avoir 18 ans": {
    titre: "Il faut avoir 18 ans",
    argent: "Aucun compte n'a été ouvert.",
    suite: "Glisil est un service financier : il est réservé aux personnes majeures.",
    recommencer: false,
  },
  "date de naissance invalide": {
    titre: "Cette date de naissance n'est pas possible",
    argent: "Aucun compte n'a été ouvert.",
    suite: "Vérifiez le jour, le mois et l'année.",
  },
  "numéro de téléphone invalide": {
    titre: "Ce numéro de téléphone n'est pas valide",
    argent: "Aucun compte n'a été ouvert.",
    suite: "Choisissez le bon pays, puis tapez le numéro sans l'indicatif. Au Cameroun : 9 chiffres, comme 6 77 12 34 56.",
  },
  "ce numéro est déjà utilisé": {
    titre: "Ce numéro est déjà utilisé",
    argent: "Aucun compte n'a été ouvert.",
    suite: "Un numéro ne sert qu'à un seul compte. Si c'est le vôtre, connectez-vous avec l'adresse e-mail de ce compte, ou écrivez au support.",
    recommencer: false,
  },
  "ce numéro ou cette adresse est déjà utilisé": {
    titre: "Ce numéro ou cette adresse est déjà utilisé",
    argent: "Aucun compte n'a été ouvert.",
    suite: "Un numéro et une adresse ne servent qu'à un seul compte. Écrivez au support si c'est une erreur.",
    recommencer: false,
  },
  "prénom invalide": { titre: "Ce prénom n'est pas valide", argent: "Aucun compte n'a été ouvert.", suite: "Des lettres seulement, au moins deux." },
  "nom invalide": { titre: "Ce nom n'est pas valide", argent: "Aucun compte n'a été ouvert.", suite: "Des lettres seulement, au moins deux." },
  "ville invalide": { titre: "Cette ville n'est pas valide", argent: "Aucun compte n'a été ouvert.", suite: "Des lettres seulement, au moins deux." },
  "pays invalide": { titre: "Choisissez votre pays dans la liste", argent: "Aucun compte n'a été ouvert.", suite: "Tapez les premières lettres pour le trouver." },
  "compte déjà ouvert": {
    titre: "Votre compte est déjà ouvert",
    argent: "Rien n'a bougé.",
    suite: "Rechargez l'application : vous arriverez sur votre compte.",
    recommencer: false,
  },
  "compte pas encore ouvert": {
    titre: "Votre compte n'est pas encore ouvert",
    argent: "Rien n'a bougé.",
    suite: "Terminez votre inscription.",
  },
  "devis expiré": {
    titre: "Le prix a expiré",
    argent: "Rien n'a bougé.",
    suite: "Demandez un nouveau prix : il tient quelques secondes.",
  },
  "le prix a changé": {
    titre: "Le prix a changé",
    argent: "Rien n'a bougé : rien n'a été acheté ni vendu.",
    suite: "Le carnet a bougé pendant que vous confirmiez. Demandez un nouveau prix.",
  },
  "pas assez de vendeurs au carnet": {
    titre: "Pas assez de vendeurs",
    argent: "Rien n'a bougé.",
    suite: "Le carnet n'a pas assez d'USDT à vendre pour ce montant (10 USDT au moins). Essayez un autre montant.",
  },
  "pas assez d'acheteurs au carnet": {
    titre: "Pas assez d'acheteurs",
    argent: "Rien n'a bougé.",
    suite: "Le carnet ne prend pas autant d'USDT en ce moment. Essayez un montant plus petit.",
  },
  "achat rapide fermé": {
    titre: "L'achat rapide est fermé",
    argent: "Rien n'a bougé.",
    suite: "Le marché reste ouvert : vous pouvez y passer un ordre.",
    recommencer: false,
  },
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
    titre: "La quantité n'est pas valable",
    argent: "Aucun ordre n'a été placé.",
    suite: "Une quantité d'USDT s'écrit avec deux décimales au plus.",
  },
  "ordre trop petit": {
    titre: "Cet ordre est trop petit",
    argent: "Aucun ordre n'a été placé.",
    suite: "Un ordre vaut au moins 1 500 XAFe. Augmentez un peu la quantité.",
  },
  "quantité trop grande": {
    titre: "Cet ordre dépasse la taille maximale",
    argent: "Aucun ordre n'a été placé.",
    suite: "Découpez-le en plusieurs ordres. Les limites sont dans « Règles du marché ».",
  },
  "ordre au marché trop grand": {
    titre: "Trop grand pour un ordre au marché",
    argent: "Aucun ordre n'a été placé.",
    suite: "Au-delà du plafond, posez un ordre limite : vous fixez le prix, il attend au carnet.",
  },
  "prix hors de la bande": {
    titre: "Ce prix est trop loin du marché",
    argent: "Aucun ordre n'a été placé.",
    suite: "Un ordre se place près du prix de référence : la bande protège d'une faute de frappe. Rapprochez votre prix.",
  },
  "trop d'ordres ouverts": {
    titre: "Vous avez trop d'ordres ouverts",
    argent: "Aucun ordre n'a été placé ; les autres attendent toujours.",
    suite: "Annulez un ordre dans « Ordres ouverts », puis recommencez.",
  },
  "trop de signalements": {
    titre: "Vous avez déjà beaucoup signalé aujourd'hui",
    argent: "Rien n'a bougé sur votre compte.",
    suite: "Vingt signalements par jour au plus : pour la suite, écrivez au support par WhatsApp ou par e-mail, juste en dessous.",
    recommencer: false,
  },
  "texte invalide": {
    titre: "Dites-nous un peu plus",
    argent: "Rien n'a bougé sur votre compte.",
    suite: "Décrivez le problème en quelques mots (2 000 caractères au plus), puis renvoyez.",
  },
  "dépôts fermés pendant la bêta": {
    titre: "Les dépôts réels sont fermés pendant la bêta",
    argent: "Aucun dépôt n'a été ouvert : ne payez rien.",
    suite: "L'argent de la bêta est de l'argent de test. Les vrais dépôts ouvriront avec la version définitive.",
    recommencer: false,
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
  "aucun boîtier en ligne pour cet opérateur": {
    titre: "Nos cartes de cet opérateur ne répondent pas en ce moment",
    argent: "Rien n'a bougé : aucun XAFe n'a été bloqué.",
    suite: "Réessayez dans quelques minutes, ou sortez vers un numéro de l'autre opérateur.",
  },
  "aucun float disponible pour cet opérateur": {
    titre: "Aucun numéro de cet opérateur n'est ouvert aux dépôts",
    argent: "Rien n'a bougé. Ne payez aucun numéro pour l'instant.",
    suite: "Réessayez dans quelques minutes ou passez par l'autre opérateur.",
  },
  "compte désactivé": {
    titre: "Votre compte est suspendu",
    argent: "Vos soldes restent à vous ; aucun geste d'argent n'est possible pour l'instant.",
    suite: "Écrivez au support Glisil, depuis Compte → Aide.",
    recommencer: false,
  },
  "compte fermé": {
    titre: "Votre compte est fermé",
    argent: "Aucune opération n'est possible.",
    suite: "Pour le rouvrir, écrivez au support depuis l'adresse de ce compte.",
    recommencer: false,
  },
  "compte déjà fermé": {
    titre: "Votre compte est déjà fermé",
    argent: "Rien n'a bougé.",
    suite: "Pour le rouvrir, écrivez au support.",
    recommencer: false,
  },
  "il reste de l'argent sur le compte": {
    titre: "Il reste de l'argent sur votre compte",
    argent: "Rien n'a été fermé : votre argent est toujours là.",
    suite: "Sortez d'abord vos XAF et vos USDT, puis revenez fermer le compte.",
    recommencer: false,
  },
  "une opération est en cours": {
    titre: "Une opération est encore en cours",
    argent: "Rien n'a été fermé.",
    suite: "Attendez qu'elle se termine — ou annulez vos ordres ouverts — puis revenez.",
    recommencer: false,
  },
  "un remboursement vous est dû": {
    titre: "Un remboursement vous est dû",
    argent: "Rien n'a été fermé : l'équipe doit d'abord vous rendre cet argent.",
    suite: "Écrivez au support pour qu'il soit fait, puis revenez fermer le compte.",
    recommencer: false,
  },
  "conditions non acceptées": {
    titre: "Les conditions n'ont pas été acceptées",
    argent: "Rien n'a bougé.",
    suite: "Lisez les conditions d'utilisation en vigueur, cochez la case, puis recommencez. Si l'écran insiste, rechargez l'application : une nouvelle version est peut-être sortie.",
  },
  "transaction id déjà utilisé": {
    titre: "Ce transaction ID a déjà été crédité",
    argent: "Ce paiement ne peut créditer qu'une fois.",
    suite: "Vérifiez l'ID dans le SMS de l'opérateur. Si c'est bien le vôtre, écrivez à l'équipe.",
    recommencer: false,
  },
  "transaction id déjà déclaré": {
    titre: "Vous avez déjà tapé ce transaction ID",
    argent: "Il attend sur un autre de vos dépôts : rien n'est perdu.",
    suite: "Regardez vos dépôts en attente dans Historique.",
    recommencer: false,
  },
  "cette déclaration ne se retire plus": {
    titre: "Cet ID ne se retire plus",
    argent: "Il a été crédité, ou l'équipe le vérifie : rien n'est perdu.",
    suite: "Regardez son état dans le dépôt.",
    recommencer: false,
  },
  "transaction id inconnu sur ce dépôt": {
    titre: "Cet ID n'est plus sur ce dépôt",
    argent: "Rien n'a bougé.",
    suite: "La liste se met à jour.",
    recommencer: false,
  },
  "transaction id invalide": {
    titre: "Ce transaction ID n'est pas lisible",
    argent: "Rien n'a bougé.",
    suite: "Recopiez-le tel qu'il est écrit dans le SMS de l'opérateur, au moins six caractères.",
  },
  "trop de transaction id": {
    titre: "Trop de transaction ID en attente",
    argent: "Les ID déjà tapés restent valables : ils seront crédités dès leur SMS.",
    suite: "Attendez que les premiers soient lus. L'équipe peut rapprocher les autres.",
    recommencer: false,
  },
  "retraits crypto pas encore ouverts": {
    titre: "L'envoi sur la chaîne n'est pas encore ouvert",
    argent: "Rien n'a été bloqué : vos fonds restent disponibles.",
    suite: "Vous pouvez sortir vers MoMo, ou vendre au marché.",
    recommencer: false,
  },
  "pas de cours de référence": {
    titre: "Le marché n'a pas encore de cours",
    argent: "Rien n'a bougé.",
    suite: "Le plafond de votre palier se compte en XAF : il faut un premier échange pour convertir.",
    recommencer: false,
  },
  "code secret déjà choisi": {
    titre: "Votre code secret est déjà choisi",
    argent: "Rien n'a changé.",
    suite: "Il se change dans Compte → Code secret, avec l'ancien.",
    recommencer: false,
  },
  "code secret invalide": {
    titre: "Le code secret doit faire quatre chiffres",
    argent: "Rien n'a changé.",
    suite: "Tapez quatre chiffres, sans lettres.",
  },
  "code sms incorrect": {
    titre: "Ce code SMS n'est pas le bon",
    argent: "Rien n'a bougé.",
    suite: "Tapez les six chiffres reçus par SMS. Après cinq erreurs, demandez un nouveau code.",
  },
  "code sms expiré": {
    titre: "Ce code SMS n'est plus valable",
    argent: "Rien n'a bougé.",
    suite: "Appuyez sur « Renvoyer le code » : un nouveau SMS part.",
  },
  "un code vient de partir": {
    titre: "Un code vient de partir",
    argent: "Rien n'a bougé.",
    suite: "Attendez une minute : le SMS peut mettre un peu de temps.",
  },
  "trop de codes demandés": {
    titre: "Trop de codes demandés pour ce numéro",
    argent: "Rien n'a bougé.",
    suite: "Réessayez dans une heure.",
    recommencer: false,
  },
  "trop de numéros en attente de code": {
    titre: "Trois numéros attendent déjà leur code",
    argent: "Rien n'a bougé.",
    suite: "Confirmez-les, ou retirez ceux qui ne sont pas à vous, dans Compte → Mes numéros MoMo.",
    recommencer: false,
  },
  "ce numéro est déjà sur un autre compte": {
    titre: "Ce numéro est déjà vérifié sur un autre compte",
    argent: "Rien n'a bougé.",
    suite: "Un numéro n'appartient qu'à un compte. S'il est à vous, écrivez à l'équipe.",
    recommencer: false,
  },
  "numéro invalide": {
    titre: "Ce numéro n'est pas un numéro MoMo de cet opérateur",
    argent: "Rien n'a bougé.",
    suite: "Neuf chiffres. MTN : 650 à 654, 67…, 68… ; Orange : 655 à 659, 69….",
  },
  "pièce invalide": {
    titre: "Une pièce jointe n'a pas pu être lue",
    argent: "Rien n'a bougé.",
    suite: "Reprenez les photos depuis cet écran.",
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
