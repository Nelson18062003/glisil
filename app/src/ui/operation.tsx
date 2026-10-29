/*
 * UNE OPÉRATION, UNE FAÇON DE LA DIRE. L'accueil et l'historique montraient la
 * même ligne chacun à sa manière : l'argent de test reçu en USDT s'affichait
 * « +20 000 USDT » dans l'historique et « — » sur l'accueil. Les deux écrans
 * passent maintenant par ici.
 */
import ArrowDownwardRounded from "@mui/icons-material/ArrowDownwardRounded";
import ArrowUpwardRounded from "@mui/icons-material/ArrowUpwardRounded";
import CardGiftcardRounded from "@mui/icons-material/CardGiftcardRounded";
import CurrencyBitcoinRounded from "@mui/icons-material/CurrencyBitcoinRounded";
import SwapHorizRounded from "@mui/icons-material/SwapHorizRounded";
import type { Operation } from "../guichet/types";
import { infoReseau, operateur as opDe } from "../noyau/argent";
import { enTranches, heure, prix as fPrix, signe, usdt as fUsdt } from "../noyau/format";
import { motifLisible } from "../noyau/serveur";
import { t } from "../noyau/langue";
import { tones, type Tone } from "../theme";

/* Le nom d'un état, dans la langue de l'écran : calculé à chaque lecture (une constante figée à l'import
   garderait la langue du démarrage). Un état inconnu se dit tel quel. */
const NOMS_DES_ETATS: Record<string, () => string> = {
  en_attente: () => t("en attente", "pending"), partiel: () => t("partiel", "partial"), credite: () => t("crédité", "credited"),
  expire: () => t("expiré", "expired"), annule: () => t("annulé", "canceled"), en_cours: () => t("en cours", "in progress"),
  en_preuve: () => t("en vérification", "being verified"), envoyee: () => t("envoyé", "sent"), partielle: () => t("partiel", "partial"), echouee: () => t("échoué", "failed"),
  annulee: () => t("annulé", "canceled"), ouvert: () => t("ouvert", "open"), execute: () => t("exécuté", "filled"),
  confirme: () => t("confirmé", "confirmed"), echoue: () => t("échoué", "failed"),
};
export function nomDeLEtat(etat: string): string {
  return NOMS_DES_ETATS[etat]?.() ?? etat;
}
export const enSuspens = (o: Operation) => ["en_attente", "partiel", "en_cours", "en_preuve", "ouvert"].includes(o.etat);

export function apparence(o: Operation): { icone: JSX.Element; tone: Tone; titre: string; sousTitre: string; droite: string; couleur?: string } {
  const heureOuEtat = enSuspens(o) ? nomDeLEtat(o.etat) : `${heure(o.quand)} · ${nomDeLEtat(o.etat)}`;
  switch (o.nature) {
    case "depot":
      return { icone: <ArrowDownwardRounded />, tone: o.etat === "credite" ? "green" : "amber", titre: t(`Entrée ${opDe(o.detail.operateur).nom}`, `${opDe(o.detail.operateur).nom} deposit`), sousTitre: o.detail.declarations.length > 1 ? t(`${heureOuEtat} · ${o.detail.declarations.length} transferts`, `${heureOuEtat} · ${o.detail.declarations.length} transfers`) : heureOuEtat, droite: o.montant > 0 ? signe(o.montant) : "—", couleur: o.montant > 0 ? tones.green.fg : undefined };
    case "sortie":
      return { icone: <ArrowUpwardRounded />, tone: o.etat === "echouee" ? "red" : "amber", titre: t(`Sortie ${opDe(o.detail.operateur).nom}`, `${opDe(o.detail.operateur).nom} withdrawal`), sousTitre: heureOuEtat, droite: signe(-o.detail.montant) };
    case "ordre": {
      const d = o.detail;
      return { icone: <SwapHorizRounded />, tone: "blue", titre: t(`${d.cote === "achat" ? "Achat" : "Vente"}${d.rapide ? " rapide" : ""} ${fUsdt(d.executee || d.quantite)} USDT`,
             `${d.rapide ? (d.cote === "achat" ? "Quick buy" : "Quick sell") : d.cote === "achat" ? "Buy" : "Sell"} ${fUsdt(d.executee || d.quantite)} USDT`),
             sousTitre: d.rapide ? t(`${heureOuEtat} · frais compris`, `${heureOuEtat} · fees included`) : d.prixMoyen != null ? t(`${heureOuEtat} · à ${fPrix(d.prixMoyen)}`, `${heureOuEtat} · at ${fPrix(d.prixMoyen)}`) : d.prix != null ? t(`${heureOuEtat} · limite ${fPrix(d.prix)}`, `${heureOuEtat} · limit ${fPrix(d.prix)}`) : heureOuEtat, droite: d.totalXafe > 0 ? signe(o.montant) : "—", couleur: o.montant > 0 && d.totalXafe > 0 ? tones.green.fg : undefined };
    }
    case "crypto":
      return { icone: <CurrencyBitcoinRounded />, tone: "neutral", titre: `${o.montant > 0 ? t("Dépôt", "Deposit") : t("Retrait", "Withdrawal")} ${o.actif} · ${infoReseau(o.detail.reseau).nom}`, sousTitre: heureOuEtat, droite: `${signe(o.montant, o.actif === "USDT" ? 2 : 0)} ${o.actif}`, couleur: o.montant > 0 ? tones.green.fg : undefined };
    case "dotation":
      /* la bêta : de l'argent de test, dit comme tel */
      return { icone: <CardGiftcardRounded />, tone: "green", titre: t("Argent de test reçu", "Test money received"), sousTitre: `${heure(o.quand)} · ${motifLisible(o.detail.motif)}${o.detail.usdt > 0 ? ` · +${enTranches(o.detail.usdt, 2)} USDT` : ""}`,
               droite: o.detail.xafe > 0 ? signe(o.detail.xafe) : `+${enTranches(o.detail.usdt, 2)} USDT`, couleur: tones.green.fg };
  }
}
