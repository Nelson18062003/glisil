/*
 * La blockchain, dite pour un client : où voir une transaction, comment lire
 * son état, quel nom donner au réseau. Une seule écriture pour l'écran, le
 * reçu PDF et la page publique de la preuve.
 */
import type { Reseau, TraceChaine } from "../guichet/types";
import { infoReseau } from "./argent";

const EXPLORATEURS: Record<string, string> = {
  bep20: "BscScan", trc20: "Tronscan", erc20: "Etherscan", base: "BaseScan", polygon: "PolygonScan", solana: "Solscan",
};

/** Le nom d'un réseau pour un client (« BNB Smart Chain ») et celui de son explorateur (« BscScan »). */
export function nomsReseau(reseau: Reseau): { nom: string; explorateur: string } {
  return { nom: infoReseau(reseau).chaine, explorateur: EXPLORATEURS[reseau] ?? "l'explorateur" };
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
export function etatDeTrace(t: TraceChaine): EtatDeTrace {
  const verbe = t.operation === "frapper" ? "créés" : "détruits";
  switch (t.etat) {
    case "confirme":
      return { titre: `XAFe ${verbe} sur la blockchain`, ton: "green",
               phrase: `${t.bloc != null ? `Inscrit au bloc ${t.bloc.toLocaleString("fr-FR")}` : "Inscrit"} de ${nomsReseau(t.reseau).nom}, sous la référence ${t.reference}.` };
    case "envoye":
      return { titre: "En route vers la blockchain", ton: "blue", phrase: "La transaction est partie ; elle attend d'être confirmée par le réseau (moins d'une minute en général)." };
    case "echoue":
      return { titre: "Refusée par la blockchain", ton: "red", phrase: "Le réseau a refusé la transaction. Vos XAFe sont bien sur votre compte ; l'équipe la rejoue." };
    default:
      return { titre: "Bientôt sur la blockchain", ton: "amber", phrase: "Vos XAFe sont crédités ; leur création sur la blockchain part dans la minute." };
  }
}
