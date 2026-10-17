/*
 * LE REÇU, EN PDF. Un document qu'on garde, qu'on envoie à son comptable, qu'on
 * montre en cas de litige : le montant, les références de l'opérateur, et —
 * pour un dépôt — la PREUVE sur la blockchain : la transaction qui a créé ces
 * XAFe, son bloc, l'empreinte de la référence que le contrat a scellée, et un
 * code à scanner qui ouvre la transaction dans l'explorateur. Personne n'a à
 * croire Glisil sur parole : le reçu dit où vérifier.
 *
 * Fabriqué dans le téléphone, sans serveur : pdf-lib et ses polices standard
 * (Helvetica, Courier). Elles ne connaissent que l'alphabet « WinAnsi » : les
 * espaces fines des montants et le signe moins typographique y sont ramenés.
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import type { TraceChaine } from "../guichet/types";
import { etatDeTrace, lienContrat, lienTransaction, NOMS_RESEAUX } from "./chaine";

export type RecuDonnees = {
  reference: string;
  /** l'opération, en clair : « Dépôt MTN MoMo » */
  titre: string;
  /** « +1 000 XAFe » */
  montant: string;
  /** la date de l'opération, déjà écrite pour un humain */
  quand: string;
  client: string | null;
  lignes: [string, string][];
  chaine: TraceChaine[];
  /** l'adresse publique de la preuve de réserve (app.glisil.com/preuve) */
  preuve: string;
  emisLe: Date;
};

const VERT = rgb(11 / 255, 107 / 255, 58 / 255);
const OR = rgb(232 / 255, 163 / 255, 61 / 255);
const ENCRE = rgb(0.11, 0.13, 0.12);
const GRIS = rgb(0.42, 0.45, 0.43);
const FILET = rgb(0.86, 0.88, 0.86);
const FOND = rgb(0.95, 0.97, 0.95);

/** Ce que les polices standard savent écrire : le reste est ramené, jamais perdu en silence. */
export function enWinAnsi(t: string): string {
  return t
    .replace(/[    ]/g, " ")
    .replace(/[−–]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E -ÿ€…•·—«»]/g, "?");
}

/** Couper un texte trop long pour sa colonne, mot à mot (ou caractère par caractère pour un hash). */
function couper(texte: string, police: PDFFont, taille: number, largeur: number): string[] {
  const t = enWinAnsi(texte);
  if (police.widthOfTextAtSize(t, taille) <= largeur) return [t];
  const morceaux = /\s/.test(t) ? t.split(/(\s+)/) : [...t];
  const lignes: string[] = [];
  let courant = "";
  for (const m of morceaux) {
    if (police.widthOfTextAtSize(courant + m, taille) > largeur && courant.trim()) { lignes.push(courant.trimEnd()); courant = m.trimStart(); }
    else courant += m;
  }
  if (courant) lignes.push(courant);
  return lignes;
}

/** Le jeton XAFe, dessiné comme dans l'application : disque vert, X blanc, pièce d'or. */
function jeton(page: PDFPage, x: number, y: number, r: number) {
  page.drawCircle({ x, y, size: r, color: VERT });
  const d = r * 0.38;
  page.drawLine({ start: { x: x - d, y: y + d }, end: { x: x + d, y: y - d }, thickness: r * 0.26, color: rgb(1, 1, 1) });
  page.drawLine({ start: { x: x + d, y: y + d }, end: { x: x - d, y: y - d }, thickness: r * 0.26, color: rgb(1, 1, 1) });
  page.drawCircle({ x, y, size: r * 0.27, color: VERT });
  page.drawCircle({ x, y, size: r * 0.2, color: OR });
}

function qr(page: PDFPage, texte: string, x: number, y: number, cote: number) {
  const code = QRCode.create(texte, { errorCorrectionLevel: "M" });
  const n = code.modules.size;
  const pas = cote / (n + 2);
  page.drawRectangle({ x, y, width: cote, height: cote, color: rgb(1, 1, 1) });
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (code.modules.get(i, j)) page.drawRectangle({ x: x + (j + 1) * pas, y: y + cote - (i + 2) * pas, width: pas + 0.05, height: pas + 0.05, color: ENCRE });
    }
  }
}

export async function fabriquerRecu(d: RecuDonnees): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Reçu ${d.reference}`);
  doc.setAuthor("Glisil");
  doc.setSubject(d.titre);
  doc.setCreationDate(d.emisLe);
  const page = doc.addPage([595.28, 841.89]);
  const { width: L, height: H } = page.getSize();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const gras = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const M = 48;
  const ecrire = (t: string, x: number, y: number, taille: number, police = normal, couleur = ENCRE) => page.drawText(enWinAnsi(t), { x, y, size: taille, font: police, color: couleur });
  const aDroite = (t: string, xDroite: number, y: number, taille: number, police = normal, couleur = ENCRE) => ecrire(t, xDroite - police.widthOfTextAtSize(enWinAnsi(t), taille), y, taille, police, couleur);

  /* le bandeau */
  page.drawRectangle({ x: 0, y: H - 96, width: L, height: 96, color: VERT });
  ecrire("glisil", M, H - 58, 30, gras, rgb(1, 1, 1));
  page.drawCircle({ x: M + gras.widthOfTextAtSize("glisil", 30) + 9, y: H - 37, size: 4.5, color: OR });
  aDroite("REÇU", L - M, H - 46, 11, gras, rgb(1, 1, 1));
  aDroite(d.reference, L - M, H - 64, 13, mono, rgb(1, 1, 1));

  /* le montant */
  let y = H - 140;
  ecrire(d.titre, M, y, 13, normal, GRIS);
  y -= 40;
  ecrire(d.montant, M, y, 32, gras, VERT);
  y -= 22;
  ecrire(d.quand, M, y, 11, normal, GRIS);

  /* le détail */
  y -= 30;
  const ligne = (label: string, valeur: string, police = normal) => {
    const morceaux = couper(valeur, police, 11, L - 2 * M - 170);
    page.drawLine({ start: { x: M, y: y + 16 }, end: { x: L - M, y: y + 16 }, thickness: 0.6, color: FILET });
    ecrire(label, M, y, 10, normal, GRIS);
    morceaux.forEach((m, i) => aDroite(m, L - M, y - i * 14, 11, police));
    y -= 14 * morceaux.length + 12;
  };
  if (d.client) ligne("Client", d.client);
  ligne("Référence Glisil", d.reference, mono);
  for (const [l, v] of d.lignes) ligne(l, v, /^(ID|Transaction|Référence)/.test(l) ? mono : normal);

  /* la blockchain : la boîte se mesure avant de se dessiner, les champs n'en débordent jamais */
  for (const t of d.chaine) {
    const e = etatDeTrace(t);
    const lien = lienTransaction(t.explorateur, t.reseau, t.txHash);
    const largeurValeur = L - 2 * M - 140 - 96;
    const champs: { label: string; morceaux: string[]; police: PDFFont; taille: number }[] = [];
    const champ = (label: string, valeur: string, police = mono, taille = 9) => champs.push({ label, morceaux: couper(valeur, police, taille, largeurValeur), police, taille });
    champ("Réseau", `${NOMS_RESEAUX[t.reseau].nom}${t.essai ? " (réseau d'essai)" : ""}`, normal, 10);
    champ("Opération", `${t.operation === "frapper" ? "Frappe" : "Destruction"} de ${t.montant.toLocaleString("fr-FR")} XAFe`, normal, 10);
    champ("Transaction", t.txHash ?? "pas encore signée");
    if (t.bloc != null) champ("Bloc", t.bloc.toLocaleString("fr-FR"), normal, 10);
    champ("Référence scellée", t.reference);
    if (t.empreinte) champ("Empreinte", t.empreinte);
    if (t.contrat) champ("Contrat XAFe", t.contrat);
    const corps = champs.reduce((h, c) => h + 12 * c.morceaux.length + 7, 0);
    const hauteur = Math.max(corps, lien ? 132 : 0) + 58;
    y -= 30;
    const haut = y + 28;
    page.drawRectangle({ x: M - 12, y: haut - hauteur, width: L - 2 * M + 24, height: hauteur, color: FOND, borderColor: FILET, borderWidth: 0.8 });
    jeton(page, M + 10, y + 6, 13);
    ecrire("Sur la blockchain", M + 32, y + 8, 14, gras);
    ecrire(e.titre, M + 32, y - 8, 10, normal, e.ton === "green" ? VERT : e.ton === "red" ? rgb(0.7, 0.15, 0.12) : GRIS);
    y -= 34;
    const debutChamps = y;
    for (const c of champs) {
      ecrire(c.label, M, y, 9, normal, GRIS);
      c.morceaux.forEach((m, i) => ecrire(m, M + 96, y - i * 12, c.taille, c.police));
      y -= 12 * c.morceaux.length + 7;
    }
    if (lien) {
      qr(page, lien, L - M - 112, debutChamps - 104, 112);
      aDroite(`Scannez : la transaction sur ${NOMS_RESEAUX[t.reseau].explorateur}`, L - M, debutChamps - 116, 7.5, normal, GRIS);
    }
    y = haut - hauteur - 8;
  }

  /* le pied */
  const essai = d.chaine.some((t) => t.essai);
  const verifier = d.chaine.length
    ? `Vérifiez sans nous croire sur parole : l'empreinte est keccak256 du texte « ${d.chaine[0].reference} », et le contrat refuse de créer deux fois des XAFe sous la même. L'offre totale du jeton se lit sur ${lienContrat(d.chaine[0].explorateur, d.chaine[0].reseau, d.chaine[0].contrat) ?? "l'explorateur"}.`
    : "";
  let yp = 112;
  for (const m of couper(verifier, normal, 8.5, L - 2 * M)) { ecrire(m, M, yp, 8.5, normal, GRIS); yp -= 12; }
  page.drawLine({ start: { x: M, y: 64 }, end: { x: L - M, y: 64 }, thickness: 0.6, color: FILET });
  ecrire("1 XAFe = 1 XAF. Chaque XAFe existe aussi sur la blockchain ; la preuve de réserve est publique :", M, 48, 8.5, normal, GRIS);
  ecrire(d.preuve, M, 36, 8.5, gras, VERT);
  aDroite(`Émis le ${d.emisLe.toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })}${essai ? " · réseau d'essai : sans valeur" : ""}`, L - M, 36, 8, normal, GRIS);
  return doc.save();
}
