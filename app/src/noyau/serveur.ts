/*
 * LES TEXTES QUI VIENNENT DE LA BASE : les notifications (« XAFe crédités »,
 * « Sortie envoyée »…) et les motifs d'un refus (« le montant déclaré ne
 * correspond pas… »). Le moteur les écrit en français, une fois pour toutes,
 * dans ses lignes. En anglais, l'écran les relit ici, forme par forme : un
 * texte que la base n'a pas pu prévoir (un motif tapé par l'équipe) reste tel
 * qu'il a été écrit, plutôt qu'une traduction inventée.
 */
import { langue } from "./langue";

type Forme = [RegExp, string | ((...m: string[]) => string)];

/** « 80 000 000 » ou « 80,000,000 » (selon la base) → à l'anglaise. */
const nombre = (n: string) => n.replace(/[\s  ]/g, ",");

const TITRES: Record<string, string> = {
  "Envoi non parti": "Transfer not sent",
  "Ordre exécuté": "Order filled",
  "Paiement retenu": "Payment held",
  "Pièces reçues": "Documents received",
  "Sortie annulée": "Withdrawal canceled",
  "Sortie envoyée": "Withdrawal sent",
  "Sortie échouée": "Withdrawal failed",
  "Sortie partielle": "Partial withdrawal",
  "Sortie refusée": "Withdrawal declined",
  "Transaction ID en vérification": "Transaction ID under review",
  "Dépôt à vérifier": "Deposit to check",
  "Vérification acceptée": "Verification approved",
  "Vérification refusée": "Verification declined",
  "XAFe crédités": "XAFe credited",
  "USDT envoyés": "USDT sent",
  "XAFe envoyés": "XAFe sent",
  "Double authentification retirée": "Two-factor authentication removed",
};

// Les motifs du moteur (0013, 0028, 0032…), sans leur point final.
const MOTIFS: Forme[] = [
  [/^le numéro qui a payé est celui d'un autre compte : l'équipe vérifie$/i, "The number that paid belongs to another account: the team is checking"],
  [/^ce transaction ID a été tapé avant le paiement : l'équipe vérifie$/i, "This transaction ID was entered before the payment: the team is checking"],
  [/^le numéro déclaré ne correspond pas au paiement reçu : vérifiez-le$/i, "The number you entered does not match the payment received: please check it"],
  [/^le montant déclaré ne correspond pas au paiement reçu : vérifiez-le$/i, "The amount you entered does not match the payment received: please check it"],
  [/^trois déclarations ne correspondent pas au paiement reçu : l'équipe vérifie$/i, "Three entries do not match the payment received: the team is checking"],
  [/^plusieurs comptes ont tapé ce transaction ID : l'équipe vérifie$/i, "Several accounts entered this transaction ID: the team is checking"],
  [/^Démo : (.+)$/, (_, m) => `Demo: ${motifLisible(m)}`],
  [/^Solde insuffisant : ([\d\s  ,.]+) FCFA$/i, (_, n) => `Insufficient balance: ${nombre(n)} FCFA`],
  [/^Numero inconnu dans la demo : seules les cartes de demo se paient entre elles$/i, "Unknown number in the demo: demo cards can only pay each other"],
  [/^aucune carte float (\S+) dans la démo$/i, (_, op) => `No ${op} float card in the demo`],
  [/^le paiement de démo n'a pas pu partir$/i, "The demo payment could not be sent"],
  [/^le transfert de démo a été refusé$/i, "The demo transfer was declined"],
  [/^Les pièces ne permettent pas de vérifier votre dossier\. Réessayez avec des photos nettes$/i, "Your documents could not be verified. Please try again with clear photos"],
];

const TEXTES: Forme[] = [
  [/^\+([\d\s  ,.]+) XAFe reçus par (.+)\.$/, (_, n, op) => `+${nombre(n)} XAFe received via ${op}.`],
  [/^([\d\s  ,.]+) XAF reçus au-delà de votre palier : ils vous seront remboursés\.$/, (_, n) => `${nombre(n)} XAF received above your tier limit: they will be refunded.`],
  [/^([\d\s  ,.]+) XAF envoyés au (\d+)\. Transaction ID : (.+)\.$/, (_, n, num, id) => `${nombre(n)} XAF sent to ${num}. Transaction ID: ${id}.`],
  [/^([\d\s  ,.]+) XAF envoyés au (\d+)\.$/, (_, n, num) => `${nombre(n)} XAF sent to ${num}.`],
  [/^([\d\s  ,.]+) (XAFe|USDT) sont revenus sur votre compte\.(?: (.+))?$/, (_, n, a, reste) =>
    `${nombre(n)} ${a} are back in your account.${reste ? ` ${motifLisible(reste.replace(/\.$/, ""))}.` : ""}`],
  [/^(Achat|Vente) de ([\d.]+) USDT à ([\d.]+)\.$/, (_, cote, q, px) => `${cote === "Achat" ? "Bought" : "Sold"} ${q} USDT at ${px}.`],
  [/^([\d.]+) (XAFe|USDT) partis vers (.+) \((.+)\)\.$/, (_, n, a, adr, res) => `${n} ${a} sent to ${adr} (${res}).`],
  [/^L'équipe vérifie votre dossier, en général sous 24 h ouvrées\.$/, "The team is reviewing your file, usually within 24 business hours."],
  [/^Votre compte est au palier 0\.$/, "Your account is at tier 0."],
  [/^Votre identité est vérifiée : palier 1\.$/, "Your identity is verified: tier 1."],
  [/^Votre application d'authentification a été retirée de votre compte\. Si ce n'est pas vous, contactez l'équipe tout de suite\.$/,
    "Your authenticator app has been removed from your account. If this wasn't you, contact the team right away."],
  [/^Votre entreprise est vérifiée : palier 2(.*)$/, (_, reste) => `Your business is verified: tier 2${reste.startsWith(",") ? ", no limit." : "."}`],
];

function appliquer(formes: Forme[], texte: string): string | null {
  for (const [re, rendu] of formes) {
    const m = texte.match(re);
    if (m) return typeof rendu === "string" ? rendu : rendu(...m);
  }
  return null;
}

/** Un motif du moteur, dans la langue de l'écran (le point final, s'il y en a un, est gardé). */
export function motifLisible(motif: string | null | undefined): string {
  if (!motif) return "";
  if (langue() !== "en") return motif;
  const point = motif.endsWith(".");
  const corps = point ? motif.slice(0, -1) : motif;
  const en = appliquer(MOTIFS, corps);
  return en === null ? motif : en + (point ? "." : "");
}

/** Un texte du moteur (une phrase de notification, un motif), dans la langue de l'écran. */
export function texteDuServeur(texte: string | null | undefined): string {
  if (!texte) return "";
  if (langue() !== "en") return texte;
  return appliquer(TEXTES, texte) ?? motifLisible(texte);
}

/** Le titre d'une notification. « Palier 1 » → « Tier 1 ». */
export function titreDuServeur(titre: string | null | undefined): string {
  if (!titre) return "";
  if (langue() !== "en") return titre;
  const palier = titre.match(/^Palier (\d)$/);
  if (palier) return `Tier ${palier[1]}`;
  return TITRES[titre] ?? titre;
}
