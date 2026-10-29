/*
 * Une erreur se dit en trois lignes : ce qui s'est passé, ce que ça change
 * pour l'argent, et quoi faire. Jamais un message technique brut.
 * Les phrases du moteur (RAISE EXCEPTION) sont les clés : elles restent en
 * français, car le moteur parle français. Seules les phrases MONTRÉES suivent
 * la langue de l'écran — le dictionnaire est donc une fonction, relue à
 * chaque erreur, et non une table figée au chargement.
 */
import { t } from "./langue";

export type ErreurLisible = {
  titre: string;
  argent: string;
  suite: string;
  /** vrai quand le geste n'a sûrement rien fait et peut être recommencé */
  recommencer: boolean;
};

type Entree = Omit<ErreurLisible, "recommencer"> & { recommencer?: boolean };

/* les lignes qui reviennent */
const rienNaBouge = () => t("Rien n'a bougé.", "Nothing has changed.");
const aucunCompte = () => t("Aucun compte n'a été ouvert.", "No account has been opened.");
const aucunOrdre = () => t("Aucun ordre n'a été placé.", "No order has been placed.");
const rienNaChange = () => t("Rien n'a changé.", "Nothing has changed.");
const desLettres = () => t("Des lettres seulement, au moins deux.", "Letters only, at least two.");

/** Les clés (à gauche) sont les phrases du moteur, en français : on ne les traduit jamais. L'ordre compte (« commence par »). */
function dictionnaire(): Record<string, Entree> {
  return {
    /* ---- l'inscription et la connexion */
    "code incorrect ou expiré": { // langue-ok
      titre: t("Ce code ne marche pas", "This code doesn't work"),
      argent: rienNaBouge(),
      suite: t("Vérifiez les six chiffres, ou demandez un nouveau code : un code reste valable quelques minutes.",
        "Check the six digits, or request a new code: a code is only valid for a few minutes."),
    },
    "trop de codes demandés : attendez une minute": { // langue-ok
      titre: t("Trop de codes demandés", "Too many codes requested"),
      argent: rienNaBouge(),
      suite: t("Attendez une minute, puis demandez un nouveau code. Pensez à regarder dans vos courriers indésirables.",
        "Wait a minute, then request a new code. Remember to check your spam folder."),
    },
    "adresse e-mail invalide": { // langue-ok
      titre: t("Cette adresse e-mail n'est pas valide", "This email address isn't valid"),
      argent: rienNaBouge(),
      suite: t("Vérifiez qu'elle est écrite en entier, par exemple awa@exemple.com.", "Make sure it's written out in full, for example awa@example.com."),
    },
    "adresse e-mail non vérifiée": { // langue-ok
      titre: t("Votre adresse e-mail n'est pas encore vérifiée", "Your email address isn't verified yet"),
      argent: aucunCompte(),
      suite: t("Reconnectez-vous avec le code reçu par e-mail.", "Sign in again with the code we emailed you."),
    },
    "adresse ou mot de passe incorrect": { // langue-ok
      titre: t("Adresse ou mot de passe incorrect", "Wrong email or password"),
      argent: rienNaBouge(),
      suite: t("Vérifiez l'adresse et le mot de passe (majuscules comprises). Vous ne vous en souvenez plus ? « Mot de passe oublié » vous en fait choisir un nouveau.",
        "Check the email address and the password (capital letters included). Can't remember it? \"Forgot password\" lets you choose a new one."),
    },
    "adresse e-mail non confirmée": { // langue-ok
      titre: t("Votre adresse n'est pas encore confirmée", "Your email address isn't confirmed yet"),
      argent: aucunCompte(),
      suite: t("Un nouveau code vient de partir : tapez-le pour confirmer l'adresse.", "A new code is on its way: enter it to confirm your address."),
    },
    "cette adresse a déjà un compte": { // langue-ok
      titre: t("Cette adresse a déjà un compte", "This email address already has an account"),
      argent: rienNaBouge(),
      suite: t("Connectez-vous avec son mot de passe, ou choisissez « Mot de passe oublié ».", "Sign in with its password, or choose \"Forgot password\"."),
      recommencer: false,
    },
    "cette adresse est déjà utilisée": { // langue-ok
      titre: t("Cette adresse est déjà utilisée", "This email address is already in use"),
      argent: aucunCompte(),
      suite: t("Une adresse ne sert qu'à un seul compte. Écrivez au support si c'est une erreur.", "An email address can only be used for one account. Contact support if this is a mistake."),
      recommencer: false,
    },
    "mot de passe trop faible": { // langue-ok
      titre: t("Ce mot de passe est trop faible", "This password is too weak"),
      argent: rienNaChange(),
      suite: t("Dix caractères au moins, avec des lettres et des chiffres, et qui n'a jamais fuité ailleurs. Une petite phrase marche bien.",
        "At least ten characters, with letters and digits, never leaked elsewhere. A short sentence works well."),
    },
    "choisissez un mot de passe différent": { // langue-ok
      titre: t("C'est déjà votre mot de passe", "That's already your password"),
      argent: rienNaChange(),
      suite: t("Choisissez-en un autre.", "Choose a different one."),
    },
    "confirmation par e-mail nécessaire": { // langue-ok
      titre: t("Confirmez avec le code reçu par e-mail", "Confirm with the code we emailed you"),
      argent: rienNaChange(),
      suite: t("Un code vient de partir à votre adresse : tapez-le pour changer le mot de passe.", "A code has just been sent to your address: enter it to change your password."),
    },
    "trop de demandes : attendez une minute": { // langue-ok
      titre: t("Trop de demandes", "Too many requests"),
      argent: rienNaBouge(),
      suite: t("Attendez une minute, puis réessayez.", "Wait a minute, then try again."),
    },
    "connexion google annulée": { // langue-ok
      titre: t("La connexion avec Google n'a pas abouti", "Signing in with Google didn't complete"),
      argent: rienNaBouge(),
      suite: t("Recommencez, ou entrez avec votre adresse e-mail et un mot de passe.", "Try again, or sign in with your email address and a password."),
    },
    "mot de passe à choisir": { // langue-ok
      titre: t("Choisissez d'abord un mot de passe", "Choose a password first"),
      argent: rienNaBouge(),
      suite: t("Il est demandé avant chaque sortie d'argent. Il se choisit dans Compte → Sécurité.", "It's required before every withdrawal. You can set it in Account → Security."),
      recommencer: false,
    },
    "double authentification requise": { // langue-ok
      titre: t("Entrez le code de votre application", "Enter the code from your authenticator app"),
      argent: rienNaBouge(),
      suite: t("Votre session doit être confirmée par l'application d'authentification avant de continuer.", "Your session must be confirmed with your authenticator app before you continue."),
      recommencer: false,
    },
    "code de l'application d'authentification à saisir": { // langue-ok
      titre: t("Un code tout neuf de votre application", "A fresh code from your authenticator app"),
      argent: rienNaBouge(),
      suite: t("Tapez les six chiffres affichés maintenant par votre application d'authentification.", "Enter the six digits your authenticator app shows right now."),
    },
    "code de l'application incorrect": { // langue-ok
      titre: t("Ce code de l'application ne marche pas", "This authenticator code doesn't work"),
      argent: rienNaBouge(),
      suite: t("Tapez les six chiffres affichés maintenant : ils changent toutes les trente secondes. L'heure du téléphone doit être juste.",
        "Enter the six digits shown right now: they change every thirty seconds. Your phone's clock must be correct."),
    },
    "aucune application d'authentification": { // langue-ok
      titre: t("Aucune application d'authentification", "No authenticator app"),
      argent: rienNaBouge(),
      suite: t("Reconnectez-vous : Glisil vous fera enrôler une application.", "Sign in again: Glisil will have you set up an authenticator app."),
      recommencer: false,
    },
    "codes de secours à noter": { // langue-ok
      titre: t("Notez d'abord vos codes de secours", "Write down your recovery codes first"),
      argent: aucunCompte(),
      suite: t("Ils vous rendent l'accès si vous perdez votre téléphone.", "They give you access back if you lose your phone."),
      recommencer: false,
    },
    "confirmez avec votre application d'authentification": { // langue-ok
      titre: t("Confirmez avec votre application", "Confirm with your authenticator app"),
      argent: rienNaChange(),
      suite: t("Tapez un code tout neuf de l'application, puis recommencez.", "Enter a fresh code from the app, then try again."),
    },
    "code de secours incorrect": { // langue-ok
      titre: t("Ce code de secours ne marche pas", "This recovery code doesn't work"),
      argent: rienNaBouge(),
      suite: t("Recopiez un code de votre liste, tel qu'il est écrit. Un code ne sert qu'une fois.", "Copy a code from your list exactly as written. Each code works only once."),
    },
    "trop d'essais": { // langue-ok
      titre: t("Trop d'essais", "Too many attempts"),
      argent: rienNaBouge(),
      suite: t("Les codes de secours sont bloqués un quart d'heure. Réessayez ensuite, ou écrivez au support.", "Recovery codes are blocked for fifteen minutes. Try again later, or contact support."),
      recommencer: false,
    },
    "aucun code de secours": { // langue-ok
      titre: t("Aucun code de secours", "No recovery codes"),
      argent: rienNaBouge(),
      suite: t("Ce compte n'a pas de codes de secours. Écrivez au support, qui vérifiera votre identité.", "This account has no recovery codes. Contact support, who will verify your identity."),
      recommencer: false,
    },
    "réessayez dans un instant": { // langue-ok
      titre: t("Ça n'a pas pu se faire", "That couldn't be done"),
      argent: rienNaBouge(),
      suite: t("Réessayez dans un instant : votre code de secours n'a pas été consommé.", "Try again in a moment: your recovery code hasn't been used up."),
    },
    "il faut avoir 18 ans": { // langue-ok
      titre: t("Il faut avoir 18 ans", "You must be 18 or older"),
      argent: aucunCompte(),
      suite: t("Glisil est un service financier : il est réservé aux personnes majeures.", "Glisil is a financial service: it's only open to adults."),
      recommencer: false,
    },
    "date de naissance invalide": { // langue-ok
      titre: t("Cette date de naissance n'est pas possible", "This date of birth isn't possible"),
      argent: aucunCompte(),
      suite: t("Vérifiez le jour, le mois et l'année.", "Check the day, month and year."),
    },
    "numéro de téléphone invalide": { // langue-ok
      titre: t("Ce numéro de téléphone n'est pas valide", "This phone number isn't valid"),
      argent: aucunCompte(),
      suite: t("Choisissez le bon pays, puis tapez le numéro sans l'indicatif. Au Cameroun : 9 chiffres, comme 6 77 12 34 56.",
        "Choose the right country, then type the number without the country code. In Cameroon: 9 digits, like 6 77 12 34 56."),
    },
    "ce numéro est déjà utilisé": { // langue-ok
      titre: t("Ce numéro est déjà utilisé", "This number is already in use"),
      argent: aucunCompte(),
      suite: t("Un numéro ne sert qu'à un seul compte. Si c'est le vôtre, connectez-vous avec l'adresse e-mail de ce compte, ou écrivez au support.",
        "A number can only be used for one account. If it's yours, sign in with that account's email address, or contact support."),
      recommencer: false,
    },
    "ce numéro ou cette adresse est déjà utilisé": { // langue-ok
      titre: t("Ce numéro ou cette adresse est déjà utilisé", "This number or email address is already in use"),
      argent: aucunCompte(),
      suite: t("Un numéro et une adresse ne servent qu'à un seul compte. Écrivez au support si c'est une erreur.",
        "A number and an email address can only be used for one account. Contact support if this is a mistake."),
      recommencer: false,
    },
    "prénom invalide": { titre: t("Ce prénom n'est pas valide", "This first name isn't valid"), argent: aucunCompte(), suite: desLettres() }, // langue-ok
    "nom invalide": { titre: t("Ce nom n'est pas valide", "This last name isn't valid"), argent: aucunCompte(), suite: desLettres() }, // langue-ok
    "ville invalide": { titre: t("Cette ville n'est pas valide", "This city isn't valid"), argent: aucunCompte(), suite: desLettres() }, // langue-ok
    "pays invalide": { // langue-ok
      titre: t("Choisissez votre pays dans la liste", "Choose your country from the list"),
      argent: aucunCompte(),
      suite: t("Tapez les premières lettres pour le trouver.", "Type the first few letters to find it."),
    },
    "compte déjà ouvert": { // langue-ok
      titre: t("Votre compte est déjà ouvert", "Your account is already open"),
      argent: rienNaBouge(),
      suite: t("Rechargez l'application : vous arriverez sur votre compte.", "Reload the app: you'll land on your account."),
      recommencer: false,
    },
    "compte pas encore ouvert": { // langue-ok
      titre: t("Votre compte n'est pas encore ouvert", "Your account isn't open yet"),
      argent: rienNaBouge(),
      suite: t("Terminez votre inscription.", "Finish signing up."),
    },
    "devis expiré": { // langue-ok
      titre: t("Le prix a expiré", "The price has expired"),
      argent: rienNaBouge(),
      suite: t("Demandez un nouveau prix : il tient quelques secondes.", "Request a new price: it holds for a few seconds."),
    },
    "le prix a changé": { // langue-ok
      titre: t("Le prix a changé", "The price has changed"),
      argent: t("Rien n'a bougé : rien n'a été acheté ni vendu.", "Nothing has changed: nothing was bought or sold."),
      suite: t("Le carnet a bougé pendant que vous confirmiez. Demandez un nouveau prix.", "The order book moved while you were confirming. Request a new price."),
    },
    "pas assez de vendeurs au carnet": { // langue-ok
      titre: t("Pas assez de vendeurs", "Not enough sellers"),
      argent: rienNaBouge(),
      suite: t("Le carnet n'a pas assez à vendre pour ce montant (10 USDT ou USDC au moins). Essayez un autre montant.",
        "The order book doesn't have enough for sale for this amount (10 USDT or USDC minimum). Try a different amount."),
    },
    "pas assez d'acheteurs au carnet": { // langue-ok
      titre: t("Pas assez d'acheteurs", "Not enough buyers"),
      argent: rienNaBouge(),
      suite: t("Le carnet ne prend pas autant en ce moment. Essayez un montant plus petit.",
        "The order book can't take that much right now. Try a smaller amount."),
    },
    "achat rapide fermé": { // langue-ok
      titre: t("L'achat rapide est fermé", "Quick buy is closed"),
      argent: rienNaBouge(),
      suite: t("Le marché reste ouvert : vous pouvez y passer un ordre.", "The market is still open: you can place an order there."),
      recommencer: false,
    },
    "solde insuffisant": { // langue-ok
      titre: t("Le solde ne suffit pas", "Your balance isn't enough"),
      argent: t("Rien n'a bougé : rien n'a été bloqué sur votre compte.", "Nothing has changed: nothing was locked on your account."),
      suite: t("Baissez le montant ou entrez des XAF d'abord.", "Lower the amount, or deposit XAF first."),
    },
    "plafond du palier atteint": { // langue-ok
      titre: t("Votre palier ne permet pas ce montant aujourd'hui", "Your tier doesn't allow this amount today"),
      argent: rienNaBouge(),
      suite: t("Passez au palier suivant dans Compte → Paliers, ou attendez demain.", "Move up to the next tier in Account → Tiers, or wait until tomorrow."),
    },
    "numéro pas encore actif": { // langue-ok
      titre: t("Ce numéro n'est pas encore utilisable", "This number can't be used yet"),
      argent: rienNaBouge(),
      suite: t("Un numéro ajouté devient actif 24 h après sa vérification.", "A new number becomes active 24 hours after it's verified."),
    },
    "numéro inconnu sur ce compte": { // langue-ok
      titre: t("Ce numéro n'est pas sur votre compte", "This number isn't on your account"),
      argent: rienNaBouge(),
      suite: t("Ajoutez-le dans Compte → Mes numéros MoMo.", "Add it in Account → My MoMo numbers."),
    },
    "prix invalide": { // langue-ok
      titre: t("Le prix doit être un multiple de 0,05", "The price must be a multiple of 0.05"),
      argent: aucunOrdre(),
      suite: t("Corrigez le prix, par exemple 618,40 plutôt que 618,41.", "Correct the price, for example 618.40 instead of 618.41."),
    },
    "quantité invalide": { // langue-ok
      titre: t("La quantité n'est pas valable", "The quantity isn't valid"),
      argent: aucunOrdre(),
      suite: t("Une quantité d'USDT ou d'USDC s'écrit avec deux décimales au plus.", "A USDT or USDC quantity can have at most two decimal places."),
    },
    "ordre trop petit": { // langue-ok
      titre: t("Cet ordre est trop petit", "This order is too small"),
      argent: aucunOrdre(),
      suite: t("Un ordre vaut au moins 1 500 XAFe. Augmentez un peu la quantité.", "An order must be worth at least 1,500 XAFe. Increase the quantity a little."),
    },
    "quantité trop grande": { // langue-ok
      titre: t("Cet ordre dépasse la taille maximale", "This order is over the maximum size"),
      argent: aucunOrdre(),
      suite: t("Découpez-le en plusieurs ordres. Les limites sont dans « Règles du marché ».", "Split it into several orders. The limits are in \"Market rules\"."),
    },
    "ordre au marché trop grand": { // langue-ok
      titre: t("Trop grand pour un ordre au marché", "Too large for a market order"),
      argent: aucunOrdre(),
      suite: t("Au-delà du plafond, posez un ordre limite : vous fixez le prix, il attend au carnet.",
        "Above the cap, place a limit order: you set the price, and it waits in the order book."),
    },
    "prix hors de la bande": { // langue-ok
      titre: t("Ce prix est trop loin du marché", "This price is too far from the market"),
      argent: aucunOrdre(),
      suite: t("Un ordre se place près du prix de référence : la bande protège d'une faute de frappe. Rapprochez votre prix.",
        "Orders must be placed near the reference price: the price band protects you from typos. Move your price closer."),
    },
    "trop d'ordres ouverts": { // langue-ok
      titre: t("Vous avez trop d'ordres ouverts", "You have too many open orders"),
      argent: t("Aucun ordre n'a été placé ; les autres attendent toujours.", "No order has been placed; your other orders are still waiting."),
      suite: t("Annulez un ordre dans « Ordres ouverts », puis recommencez.", "Cancel an order in \"Open orders\", then try again."),
    },
    "trop de signalements": { // langue-ok
      titre: t("Vous avez déjà beaucoup signalé aujourd'hui", "You've already sent a lot of reports today"),
      argent: t("Rien n'a bougé sur votre compte.", "Nothing has changed on your account."),
      suite: t("Vingt signalements par jour au plus : pour la suite, écrivez au support par WhatsApp ou par e-mail, juste en dessous.",
        "The limit is twenty reports a day: for anything else, contact support by WhatsApp or email, just below."),
      recommencer: false,
    },
    "texte invalide": { // langue-ok
      titre: t("Dites-nous un peu plus", "Tell us a little more"),
      argent: t("Rien n'a bougé sur votre compte.", "Nothing has changed on your account."),
      suite: t("Décrivez le problème en quelques mots (2 000 caractères au plus), puis renvoyez.",
        "Describe the problem in a few words (2,000 characters max), then send it again."),
    },
    "dépôts fermés pendant la bêta": { // langue-ok
      titre: t("Les dépôts réels sont fermés pendant la bêta", "Real deposits are closed during the Beta"),
      argent: t("Aucun dépôt n'a été ouvert : ne payez rien.", "No deposit has been opened: don't pay anything."),
      suite: t("L'argent de la bêta est de l'argent de test. Les vrais dépôts ouvriront avec la version définitive.",
        "Money in the Beta is test money. Real deposits will open with the final version."),
      recommencer: false,
    },
    "marché fermé": { // langue-ok
      titre: t("Le marché est fermé pour le moment", "The market is closed for now"),
      argent: aucunOrdre(),
      suite: t("Réessayez dans quelques minutes, ou passez par l'autre carnet (USDT ou USDC).", "Try again in a few minutes, or use the other order book (USDT or USDC)."),
    },
    "paire inconnue": { // langue-ok
      titre: t("Ce carnet n'existe pas", "This order book doesn't exist"),
      argent: aucunOrdre(),
      suite: t("Choisissez USDT/XAFe ou USDC/XAFe en haut du marché.", "Choose USDT/XAFe or USDC/XAFe at the top of the market."),
      recommencer: false,
    },
    "actif absent de ce réseau": { // langue-ok
      titre: t("Ce jeton ne passe pas par ce réseau", "This token isn't available on this network"),
      argent: rienNaBouge(),
      suite: t("L'USDC passe par BNB Chain et Ethereum, pas par Tron. Choisissez un autre réseau.", "USDC is available on BNB Chain and Ethereum, not on Tron. Choose another network."),
      recommencer: false,
    },
    "cet ordre ne peut plus être annulé": { // langue-ok
      titre: t("Cet ordre est déjà exécuté ou annulé", "This order has already been filled or canceled"),
      argent: t("Ses fonds sont déjà réglés ou libérés.", "Its funds have already been settled or released."),
      suite: t("Regardez son détail dans Mes ordres.", "See its details in My orders."),
      recommencer: false,
    },
    /* ---- la vérification avant sortie (0036) : rien ne bouge tant qu'elle n'est pas passée */
    "vérifications verrouillées": { // langue-ok
      titre: t("Sorties bloquées une heure", "Withdrawals blocked for an hour"),
      argent: t("Rien n'a bougé : votre argent reste sur votre compte.", "Nothing has changed: your money stays in your account."),
      suite: t("Trop de mots de passe ou de codes faux. Si ce n'est pas vous, changez votre mot de passe et écrivez au support.",
        "Too many wrong passwords or codes. If this wasn't you, change your password and contact support."),
      recommencer: false,
    },
    "trop de vérifications demandées": { // langue-ok
      titre: t("Trop de codes demandés", "Too many codes requested"),
      argent: rienNaBouge(),
      suite: t("Attendez un peu avant de demander un nouveau code par e-mail.", "Wait a little before requesting a new code by email."),
      recommencer: false,
    },
    "vérification inconnue": { // langue-ok
      titre: t("Ce code ne vaut pas pour cette session", "This code isn't valid for this session"),
      argent: rienNaBouge(),
      suite: t("Demandez un nouveau code par e-mail.", "Request a new code by email."),
    },
    "vérification expirée": { // langue-ok
      titre: t("Le code e-mail a expiré", "The email code has expired"),
      argent: rienNaBouge(),
      suite: t("Un code vaut dix minutes. Demandez-en un nouveau.", "A code is valid for ten minutes. Request a new one."),
    },
    "vérification épuisée": { // langue-ok
      titre: t("Trop d'essais pour ce code", "Too many attempts for this code"),
      argent: rienNaBouge(),
      suite: t("Demandez un nouveau code par e-mail.", "Request a new code by email."),
    },
    "vérification remplacée par un code plus récent": { // langue-ok
      titre: t("Un code plus récent est parti", "A newer code has been sent"),
      argent: rienNaBouge(),
      suite: t("Seul le dernier code reçu par e-mail compte.", "Only the latest code you received by email counts."),
    },
    "vérification déjà utilisée": { // langue-ok
      titre: t("Ce code a déjà servi", "This code has already been used"),
      argent: t("Regardez Historique : l'opération est peut-être déjà partie.", "Check History: the operation may already have gone through."),
      suite: t("Un code ne sert qu'une fois. Demandez-en un nouveau pour une autre opération.", "Each code works only once. Request a new one for another operation."),
      recommencer: false,
    },
    "la vérification ne correspond pas à cette opération": { // langue-ok
      titre: t("Ce code vaut pour une autre opération", "This code is for a different operation"),
      argent: rienNaBouge(),
      suite: t("Le montant ou la destination a changé : un nouveau code est nécessaire.", "The amount or destination changed: a new code is needed."),
    },
    "mot de passe incorrect": { // langue-ok
      titre: t("Mot de passe incorrect", "Wrong password"),
      argent: rienNaBouge(),
      suite: t("Tapez le mot de passe de votre compte Glisil.", "Enter your Glisil account password."),
    },
    "code e-mail incorrect": { // langue-ok
      titre: t("Ce code e-mail n'est pas le bon", "This email code is incorrect"),
      argent: rienNaBouge(),
      suite: t("Tapez les six chiffres du dernier e-mail reçu.", "Enter the six digits from the latest email."),
    },
    "vérification du mot de passe indisponible": { // langue-ok
      titre: t("Le mot de passe ne peut pas être vérifié", "Your password can't be checked right now"),
      argent: rienNaBouge(),
      suite: t("Écrivez au support : rien n'a été compté contre vous.", "Contact support: nothing has been counted against you."),
      recommencer: false,
    },
    "opération inconnue": { // langue-ok
      titre: t("Cette opération n'existe pas", "This operation doesn't exist"),
      argent: rienNaBouge(),
      suite: t("Rechargez l'application, puis recommencez.", "Reload the app, then try again."),
      recommencer: false,
    },
    "ce dépôt ne peut plus être annulé": { // langue-ok
      titre: t("Ce dépôt est déjà réglé", "This deposit has already been settled"),
      argent: t("S'il a été crédité, vos XAFe sont là.", "If it was credited, your XAFe are in your account."),
      suite: t("Regardez-le dans Historique.", "Check it in History."),
      recommencer: false,
    },
    "aucun boîtier en ligne pour cet opérateur": { // langue-ok
      titre: t("Nos cartes de cet opérateur ne répondent pas en ce moment", "Our SIM cards for this operator aren't responding right now"),
      argent: t("Rien n'a bougé : aucun XAFe n'a été bloqué.", "Nothing has changed: no XAFe has been locked."),
      suite: t("Réessayez dans quelques minutes, ou sortez vers un numéro de l'autre opérateur.",
        "Try again in a few minutes, or withdraw to a number with the other operator."),
    },
    "aucun float disponible pour cet opérateur": { // langue-ok
      titre: t("Aucun numéro de cet opérateur n'est ouvert aux dépôts", "No number for this operator is open for deposits"),
      argent: t("Rien n'a bougé. Ne payez aucun numéro pour l'instant.", "Nothing has changed. Don't pay any number for now."),
      suite: t("Réessayez dans quelques minutes ou passez par l'autre opérateur.", "Try again in a few minutes, or use the other operator."),
    },
    "compte désactivé": { // langue-ok
      titre: t("Votre compte est suspendu", "Your account is suspended"),
      argent: t("Vos soldes restent à vous ; aucun geste d'argent n'est possible pour l'instant.",
        "Your balances are still yours; no money transactions are possible for now."),
      suite: t("Écrivez au support Glisil, depuis Compte → Aide.", "Contact Glisil support from Account → Help."),
      recommencer: false,
    },
    "compte fermé": { // langue-ok
      titre: t("Votre compte est fermé", "Your account is closed"),
      argent: t("Aucune opération n'est possible.", "No transactions are possible."),
      suite: t("Pour le rouvrir, écrivez au support depuis l'adresse de ce compte.", "To reopen it, contact support from this account's email address."),
      recommencer: false,
    },
    "compte déjà fermé": { // langue-ok
      titre: t("Votre compte est déjà fermé", "Your account is already closed"),
      argent: rienNaBouge(),
      suite: t("Pour le rouvrir, écrivez au support.", "To reopen it, contact support."),
      recommencer: false,
    },
    "il reste de l'argent sur le compte": { // langue-ok
      titre: t("Il reste de l'argent sur votre compte", "There's still money in your account"),
      argent: t("Rien n'a été fermé : votre argent est toujours là.", "Nothing was closed: your money is still there."),
      suite: t("Sortez d'abord vos XAF, vos USDT et vos USDC, puis revenez fermer le compte.", "Withdraw your XAF, USDT and USDC first, then come back to close the account."),
      recommencer: false,
    },
    "une opération est en cours": { // langue-ok
      titre: t("Une opération est encore en cours", "A transaction is still in progress"),
      argent: t("Rien n'a été fermé.", "Nothing was closed."),
      suite: t("Attendez qu'elle se termine — ou annulez vos ordres ouverts — puis revenez.",
        "Wait for it to finish — or cancel your open orders — then come back."),
      recommencer: false,
    },
    "un remboursement vous est dû": { // langue-ok
      titre: t("Un remboursement vous est dû", "You're owed a refund"),
      argent: t("Rien n'a été fermé : l'équipe doit d'abord vous rendre cet argent.", "Nothing was closed: our team must first return this money to you."),
      suite: t("Écrivez au support pour qu'il soit fait, puis revenez fermer le compte.", "Contact support to have it sent, then come back to close the account."),
      recommencer: false,
    },
    "conditions non acceptées": { // langue-ok
      titre: t("Les conditions n'ont pas été acceptées", "The terms haven't been accepted"),
      argent: rienNaBouge(),
      suite: t("Lisez les conditions d'utilisation en vigueur, cochez la case, puis recommencez. Si l'écran insiste, rechargez l'application : une nouvelle version est peut-être sortie.",
        "Read the current terms of use, check the box, then try again. If this screen keeps appearing, reload the app: a new version may be out."),
    },
    "transaction id déjà utilisé": { // langue-ok
      titre: t("Ce transaction ID a déjà été crédité", "This transaction ID has already been credited"),
      argent: t("Ce paiement ne peut créditer qu'une fois.", "A payment can only be credited once."),
      suite: t("Vérifiez l'ID dans le SMS de l'opérateur. Si c'est bien le vôtre, écrivez à l'équipe.",
        "Check the ID in the operator's SMS. If it really is yours, contact our team."),
      recommencer: false,
    },
    "transaction id déjà déclaré": { // langue-ok
      titre: t("Vous avez déjà tapé ce transaction ID", "You've already entered this transaction ID"),
      argent: t("Il attend sur un autre de vos dépôts : rien n'est perdu.", "It's waiting on another of your deposits: nothing is lost."),
      suite: t("Regardez vos dépôts en attente dans Historique.", "Check your pending deposits in History."),
      recommencer: false,
    },
    "cette déclaration ne se retire plus": { // langue-ok
      titre: t("Cet ID ne se retire plus", "This ID can no longer be removed"),
      argent: t("Il a été crédité, ou l'équipe le vérifie : rien n'est perdu.", "It has been credited, or our team is checking it: nothing is lost."),
      suite: t("Regardez son état dans le dépôt.", "Check its status in the deposit."),
      recommencer: false,
    },
    "transaction id inconnu sur ce dépôt": { // langue-ok
      titre: t("Cet ID n'est plus sur ce dépôt", "This ID is no longer on this deposit"),
      argent: rienNaBouge(),
      suite: t("La liste se met à jour.", "The list is updating."),
      recommencer: false,
    },
    "transaction id invalide": { // langue-ok
      titre: t("Ce transaction ID n'est pas lisible", "This transaction ID can't be read"),
      argent: rienNaBouge(),
      suite: t("Recopiez-le tel qu'il est écrit dans le SMS de l'opérateur, au moins six caractères.",
        "Copy it exactly as it appears in the operator's SMS, at least six characters."),
    },
    "trop de transaction id": { // langue-ok
      titre: t("Trop de transaction ID en attente", "Too many transaction IDs pending"),
      argent: t("Les ID déjà tapés restent valables : ils seront crédités dès leur SMS.",
        "The IDs you already entered are still valid: they'll be credited as soon as their SMS arrives."),
      suite: t("Attendez que les premiers soient lus. L'équipe peut rapprocher les autres.", "Wait for the first ones to be read. Our team can match the others."),
      recommencer: false,
    },
    "retraits crypto pas encore ouverts": { // langue-ok
      titre: t("L'envoi sur la chaîne n'est pas encore ouvert", "On-chain withdrawals aren't open yet"),
      argent: t("Rien n'a été bloqué : vos fonds restent disponibles.", "Nothing was locked: your funds are still available."),
      suite: t("Vous pouvez sortir vers MoMo, ou vendre au marché.", "You can withdraw to MoMo, or sell on the market."),
      recommencer: false,
    },
    "pas de cours de référence": { // langue-ok
      titre: t("Le marché n'a pas encore de cours", "The market doesn't have a price yet"),
      argent: rienNaBouge(),
      suite: t("Le plafond de votre palier se compte en XAF : il faut un premier échange pour convertir.",
        "Your tier limit is counted in XAF: a first trade is needed to convert."),
      recommencer: false,
    },
    "code sms incorrect": { // langue-ok
      titre: t("Ce code SMS n'est pas le bon", "This SMS code is incorrect"),
      argent: rienNaBouge(),
      suite: t("Tapez les six chiffres reçus par SMS. Après cinq erreurs, demandez un nouveau code.",
        "Enter the six digits you received by SMS. After five wrong attempts, request a new code."),
    },
    "code sms expiré": { // langue-ok
      titre: t("Ce code SMS n'est plus valable", "This SMS code has expired"),
      argent: rienNaBouge(),
      suite: t("Appuyez sur « Renvoyer le code » : un nouveau SMS part.", "Tap \"Resend code\": a new SMS will be sent."),
    },
    "un code vient de partir": { // langue-ok
      titre: t("Un code vient de partir", "A code was just sent"),
      argent: rienNaBouge(),
      suite: t("Attendez une minute : le SMS peut mettre un peu de temps.", "Wait a minute: the SMS can take a little while."),
    },
    "trop de codes demandés": { // langue-ok
      titre: t("Trop de codes demandés pour ce numéro", "Too many codes requested for this number"),
      argent: rienNaBouge(),
      suite: t("Réessayez dans une heure.", "Try again in an hour."),
      recommencer: false,
    },
    "trop de numéros en attente de code": { // langue-ok
      titre: t("Trois numéros attendent déjà leur code", "Three numbers are already waiting for their code"),
      argent: rienNaBouge(),
      suite: t("Confirmez-les, ou retirez ceux qui ne sont pas à vous, dans Compte → Mes numéros MoMo.",
        "Confirm them, or remove the ones that aren't yours, in Account → My MoMo numbers."),
      recommencer: false,
    },
    "ce numéro est déjà sur un autre compte": { // langue-ok
      titre: t("Ce numéro est déjà vérifié sur un autre compte", "This number is already verified on another account"),
      argent: rienNaBouge(),
      suite: t("Un numéro n'appartient qu'à un compte. S'il est à vous, écrivez à l'équipe.", "A number can belong to only one account. If it's yours, contact our team."),
      recommencer: false,
    },
    "numéro invalide": { // langue-ok
      titre: t("Ce numéro n'est pas un numéro MoMo de cet opérateur", "This isn't a MoMo number for this operator"),
      argent: rienNaBouge(),
      suite: t("Neuf chiffres. MTN : 650 à 654, 67…, 68… ; Orange : 655 à 659, 69….", "Nine digits. MTN: 650 to 654, 67…, 68…; Orange: 655 to 659, 69…."),
    },
    "pièce invalide": { // langue-ok
      titre: t("Une pièce jointe n'a pas pu être lue", "An attachment couldn't be read"),
      argent: rienNaBouge(),
      suite: t("Reprenez les photos depuis cet écran.", "Retake the photos from this screen."),
    },
    "non connecté": { // langue-ok
      titre: t("Votre session a expiré", "Your session has expired"),
      argent: rienNaBouge(),
      suite: t("Reconnectez-vous pour continuer.", "Sign in again to continue."),
    },
    "réseau": { // langue-ok
      titre: t("Pas de réseau", "No connection"),
      argent: t("On ne sait pas si la demande est partie. Ne la refaites pas tout de suite.",
        "We can't tell if your request went through. Don't repeat it right away."),
      suite: t("Regardez Historique dans une minute : si rien n'y est, recommencez.", "Check History in a minute: if nothing is there, try again."),
      recommencer: false,
    },
  };
}

/** Les messages de l'application elle-même (pas du moteur) qui n'ont pas de fiche : dits tels quels, dans la langue de l'écran. */
function messageConnu(message: string): string | null {
  switch (message.toLowerCase()) {
    case "les inscriptions sont fermées pour le moment": // langue-ok
      return t("Les inscriptions ouvrent très bientôt.", "Sign-ups open very soon.");
    case "dépôt inconnu": // langue-ok
      return t("dépôt inconnu", "Unknown deposit.");
    default:
      return null;
  }
}

export function lisible(e: unknown): ErreurLisible {
  const message = (e instanceof Error ? e.message : typeof e === "string" ? e : String((e as { message?: string })?.message ?? "")).trim();
  const minuscule = message.toLowerCase();
  const dico = dictionnaire();
  for (const cle of Object.keys(dico)) {
    if (minuscule.startsWith(cle)) {
      const d = dico[cle];
      return { ...d, recommencer: d.recommencer ?? true };
    }
  }
  if (/fetch|network|réseau|timeout|failed to/i.test(message)) {
    const d = dico["réseau"];
    return { ...d, recommencer: false };
  }
  return {
    titre: t("Ça n'a pas marché", "That didn't work"),
    argent: t("Rien n'a bougé si l'écran ne dit pas le contraire.", "Nothing has changed unless the screen says otherwise."),
    suite: messageConnu(message) ?? (message || t("Réessayez dans un instant.", "Please try again in a moment.")),
    recommencer: true,
  };
}

/** Ce qu'un refus compté rend en plus de sa phrase (un code faux, une vérification) : les essais qui restent, le verrou, le facteur en cause. */
export type DonneesDuRefus = { essaisRestants?: number | null; verrouJusqua?: string | null; facteur?: string | null };

export class ErreurMoteur extends Error {
  detail?: string;
  donnees?: DonneesDuRefus;
  constructor(message: string, detail?: string, donnees?: DonneesDuRefus) {
    super(message);
    this.detail = detail;
    this.donnees = donnees;
  }
}
