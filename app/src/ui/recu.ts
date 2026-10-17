/*
 * Télécharger un reçu PDF : fabriqué dans le téléphone, puis remis comme un
 * FICHIER (la coque Android l'intercepte et ouvre la feuille de partage ; un
 * lien, lui, ne survivrait pas au partage). pdf-lib n'est chargé qu'au premier
 * reçu : l'application ne le porte pas à chaque ouverture.
 */
import type { RecuDonnees } from "../noyau/recu-pdf";

export async function telechargerRecu(d: Omit<RecuDonnees, "preuve" | "emisLe">): Promise<void> {
  const { fabriquerRecu } = await import("../noyau/recu-pdf");
  const octets = await fabriquerRecu({ ...d, preuve: `${window.location.origin}/preuve`, emisLe: new Date() });
  const fichier = new Blob([octets as BlobPart], { type: "application/pdf" });
  const lien = document.createElement("a");
  lien.href = URL.createObjectURL(fichier);
  lien.download = `Recu-${d.reference}.pdf`;
  lien.click();
  setTimeout(() => URL.revokeObjectURL(lien.href), 10_000);
}
