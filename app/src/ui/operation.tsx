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
import { tones, type Tone } from "../theme";

export const ETATS: Record<string, string> = {
  en_attente: "en attente", partiel: "partiel", credite: "crédité", expire: "expiré", annule: "annulé", en_cours: "en cours", envoyee: "envoyé", partielle: "partiel", echouee: "échoué",
  annulee: "annulé", ouvert: "ouvert", execute: "exécuté", confirme: "confirmé", echoue: "échoué",
};
export const enSuspens = (o: Operation) => ["en_attente", "partiel", "en_cours", "ouvert"].includes(o.etat);

export function apparence(o: Operation): { icone: JSX.Element; tone: Tone; titre: string; sousTitre: string; droite: string; couleur?: string } {
  const heureOuEtat = enSuspens(o) ? ETATS[o.etat] : `${heure(o.quand)} · ${ETATS[o.etat] ?? o.etat}`;
  switch (o.nature) {
    case "depot":
      return { icone: <ArrowDownwardRounded />, tone: o.etat === "credite" ? "green" : "amber", titre: `Entrée ${opDe(o.detail.operateur).nom}`, sousTitre: o.detail.declarations.length > 1 ? `${heureOuEtat} · ${o.detail.declarations.length} transferts` : heureOuEtat, droite: o.montant > 0 ? signe(o.montant) : "—", couleur: o.montant > 0 ? tones.green.fg : undefined };
    case "sortie":
      return { icone: <ArrowUpwardRounded />, tone: o.etat === "echouee" ? "red" : "amber", titre: `Sortie ${opDe(o.detail.operateur).nom}`, sousTitre: heureOuEtat, droite: signe(-o.detail.montant) };
    case "ordre": {
      const d = o.detail;
      return { icone: <SwapHorizRounded />, tone: "blue", titre: `${d.cote === "achat" ? "Achat" : "Vente"}${d.rapide ? " rapide" : ""} ${fUsdt(d.executee || d.quantite)} USDT`, sousTitre: d.rapide ? `${heureOuEtat} · frais compris` : d.prixMoyen != null ? `${heureOuEtat} · à ${fPrix(d.prixMoyen)}` : d.prix != null ? `${heureOuEtat} · limite ${fPrix(d.prix)}` : heureOuEtat, droite: d.totalXafe > 0 ? signe(o.montant) : "—", couleur: o.montant > 0 && d.totalXafe > 0 ? tones.green.fg : undefined };
    }
    case "crypto":
      return { icone: <CurrencyBitcoinRounded />, tone: "neutral", titre: `${o.montant > 0 ? "Dépôt" : "Retrait"} ${o.actif} · ${infoReseau(o.detail.reseau).nom}`, sousTitre: heureOuEtat, droite: `${signe(o.montant, o.actif === "USDT" ? 2 : 0)} ${o.actif}`, couleur: o.montant > 0 ? tones.green.fg : undefined };
    case "dotation":
      /* la bêta : de l'argent de test, dit comme tel */
      return { icone: <CardGiftcardRounded />, tone: "green", titre: "Argent de test reçu", sousTitre: `${heure(o.quand)} · ${o.detail.motif}${o.detail.usdt > 0 ? ` · +${enTranches(o.detail.usdt, 2)} USDT` : ""}`,
               droite: o.detail.xafe > 0 ? signe(o.detail.xafe) : `+${enTranches(o.detail.usdt, 2)} USDT`, couleur: tones.green.fg };
  }
}
