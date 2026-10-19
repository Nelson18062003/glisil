/*
 * La blockchain, dite pour un client : où voir une transaction, comment lire
 * son état, quel nom donner au réseau. Une seule écriture pour l'écran, le
 * reçu PDF et la page publique de la preuve.
 */
import type { Reseau, TraceChaine } from "../guichet/types";
import { infoReseau } from "./argent";
import { enTranches } from "./format";
import { t } from "./langue";

const EXPLORATEURS: Record<string, string> = {
  bep20: "BscScan", trc20: "Tronscan", erc20: "Etherscan", base: "BaseScan", polygon: "PolygonScan", solana: "Solscan", // langue-ok
};

/** Le nom d'un réseau pour un client (« BNB Smart Chain ») et celui de son explorateur (« BscScan »). */
export function nomsReseau(reseau: Reseau): { nom: string; explorateur: string } {
  return { nom: infoReseau(reseau).chaine, explorateur: EXPLORATEURS[reseau] ?? t("l'explorateur", "the explorer") };
}

/** L'adresse d'une transaction dans l'explorateur du réseau (Tronscan : /transaction/, les autres : /tx/). */
export function lienTransaction(explorateur: string | null | undefined, reseau: Reseau, tx: string | null | undefined): string | null {
  if (!explorateur || !tx) return null;
  return `${explorateur.replace(/\/$/, "")}/${infoReseau(reseau).famille === "tron" ? "transaction" : "tx"}/${tx}`;
}

/** L'adresse du contrat XAFe dans l'explorateur : son offre totale s'y lit. */
export function lienContrat(explorateur: string | null | undefined, reseau: Reseau, contrat: string | null | undefined): string | null {
  if (!explorateur || !contrat) return null;
  return `${explorateur.replace(/\/$/, "")}/${infoReseau(reseau).famille === "tron" ? "token20" : "token"}/${contrat}`;
}

/** « 0xbe6acf4f…57c917 » : assez pour reconnaître, pas assez pour encombrer. */
export function hashCourt(h: string | null | undefined, debut = 10, fin = 6): string {
  if (!h) return "—";
  return h.length <= debut + fin + 1 ? h : `${h.slice(0, debut)}…${h.slice(-fin)}`;
}

export type EtatDeTrace = { titre: string; phrase: string; ton: "green" | "blue" | "amber" | "red" };

/** Ce qu'un client doit comprendre de l'état d'une frappe, sans un mot de jargon de plus que nécessaire. */
export function etatDeTrace(trace: TraceChaine): EtatDeTrace {
  const frappe = trace.operation === "frapper";
  switch (trace.etat) {
    case "confirme": {
      const reseau = nomsReseau(trace.reseau).nom;
      const bloc = trace.bloc != null ? enTranches(trace.bloc) : null;
      return { titre: frappe ? t("XAFe créés sur la blockchain", "XAFe minted on the blockchain") : t("XAFe détruits sur la blockchain", "XAFe burned on the blockchain"), ton: "green",
               phrase: bloc != null
                 ? t(`Inscrit au bloc ${bloc} de ${reseau}, sous la référence ${trace.reference}.`, `Recorded in block ${bloc} on ${reseau}, under reference ${trace.reference}.`)
                 : t(`Inscrit de ${reseau}, sous la référence ${trace.reference}.`, `Recorded on ${reseau}, under reference ${trace.reference}.`) };
    }
    case "envoye":
      return { titre: t("En route vers la blockchain", "On its way to the blockchain"), ton: "blue",
               phrase: t("La transaction est partie ; elle attend d'être confirmée par le réseau (moins d'une minute en général).",
                 "The transaction has been sent; it's waiting to be confirmed by the network (usually less than a minute).") };
    case "echoue":
      return { titre: t("Refusée par la blockchain", "Rejected by the blockchain"), ton: "red",
               phrase: t("Le réseau a refusé la transaction. Vos XAFe sont bien sur votre compte ; l'équipe la rejoue.",
                 "The network rejected the transaction. Your XAFe are safely in your account; our team will resend it.") };
    default:
      return { titre: t("Bientôt sur la blockchain", "Coming to the blockchain soon"), ton: "amber",
               phrase: t("Vos XAFe sont crédités ; leur création sur la blockchain part dans la minute.",
                 "Your XAFe have been credited; they'll be minted on the blockchain within a minute.") };
  }
}
