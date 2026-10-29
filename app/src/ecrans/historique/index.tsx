/*
 * L'Historique : tout ce qui a bougé, par jour ; ce qui est en attente ou en
 * cours toujours en tête. Une ligne → son Détail, avec le reçu.
 */
import ReceiptLongOutlined from "@mui/icons-material/ReceiptLongOutlined";
import ReplayRounded from "@mui/icons-material/ReplayRounded";
import DownloadRounded from "@mui/icons-material/DownloadRounded";
import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useCompte, useHistorique, useOperation } from "../../guichet";
import type { Operation } from "../../guichet/types";
import { baseDe } from "../../guichet/types";
import type { RecuDonnees } from "../../noyau/recu-pdf";
import { infoReseau, libelleReseau, operateur as opDe } from "../../noyau/argent";
import { enTranches, heureSecondes, jourRelatif, numeroEnTranches, quand, usdt as fUsdt, xaf } from "../../noyau/format";
import { motifLisible } from "../../noyau/serveur";
import { tones } from "../../theme";
import { Card, Chips, EtatVide, Line, List, Row, Screen, Squelette } from "../../ui";
import { SurLaChaine } from "../../ui/chaine";
import { telechargerRecu } from "../../ui/recu";
import { apparence, enSuspens, nomDeLEtat } from "../../ui/operation";
import { t } from "../../noyau/langue";

/* une clé par filtre (ce que le code compare), un nom par langue (ce qu'on lit) */
const FILTRES = ["tout", "entrees", "sorties", "ordres", "crypto"] as const;
type Filtre = (typeof FILTRES)[number];
const nomDuFiltre = (f: string): string =>
  ({ tout: t("Tout", "All"), entrees: t("Entrées", "Deposits"), sorties: t("Sorties", "Withdrawals"), ordres: t("Ordres", "Orders"), crypto: "Crypto" } as Record<string, string>)[f] ?? f; // langue-ok

const passeLeFiltre = (o: Operation, f: Filtre) =>
  f === "tout" || (f === "entrees" && (o.nature === "depot" || o.nature === "dotation")) || (f === "sorties" && o.nature === "sortie") || (f === "ordres" && o.nature === "ordre") || (f === "crypto" && o.nature === "crypto");

export function Historique() {
  const { data } = useHistorique();
  const [filtre, setFiltre] = useState<Filtre>("tout");
  const ops = (data ?? []).filter((o) => passeLeFiltre(o, filtre));
  const suspens = ops.filter(enSuspens);
  const groupes = new Map<string, Operation[]>();
  for (const o of ops.filter((x) => !enSuspens(x))) groupes.set(jourRelatif(o.quand), [...(groupes.get(jourRelatif(o.quand)) ?? []), o]);

  const ligne = (o: Operation) => {
    const a = apparence(o);
    const cible = o.nature === "ordre" ? `/marche/ordres/${o.reference}` : `/historique/${o.reference}`;
    return <Row key={`${o.nature}-${o.reference}`} icon={a.icone} tone={a.tone} primary={a.titre} secondary={a.sousTitre} right={a.droite} rightColor={a.couleur} to={cible} />;
  };

  return (
    <Screen tab="historique" title={t("Historique", "History")}>
      <Chips items={[...FILTRES]} libelle={nomDuFiltre} selected={filtre} onSelect={(f) => setFiltre(f as Filtre)} />
      {!data ? <Squelette hauteur={240} /> : data.length === 0 ? (
        <EtatVide icone={<ReceiptLongOutlined sx={{ fontSize: 36 }} />} tone="green" titre={t("Aucune opération pour l'instant", "No activity yet")}
          texte={t("Vos entrées, sorties, achats et ventes s'afficheront ici, avec leur reçu. Tout commence par une entrée de XAF.", "Your deposits, withdrawals, buys and sells will show up here, each with its receipt. It all starts with adding XAF.")}
          action={{ label: t("Entrer des XAF", "Add XAF"), to: "/entrer/operateur" }} />
      ) : ops.length === 0 ? (
        <EtatVide icone={<ReceiptLongOutlined sx={{ fontSize: 36 }} />} titre={t(`Aucune opération dans « ${nomDuFiltre(filtre)} »`, `No activity in “${nomDuFiltre(filtre)}”`)}
          texte={t("Les autres filtres en ont peut-être.", "Other filters may have some.")} action={{ label: t("Tout voir", "See all"), onClick: () => setFiltre("tout") }} />
      ) : (
        <>
          {suspens.length > 0 && (
            <>
              <Typography variant="subtitle1" sx={{ mt: 1 }}>{t("En cours", "In progress")}</Typography>
              <List>{suspens.map(ligne)}</List>
            </>
          )}
          {[...groupes].map(([jour, os]) => (
            <Box key={jour} sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <Typography variant="subtitle1" sx={{ mt: 1 }}>{jour}</Typography>
              <List>{os.map(ligne)}</List>
            </Box>
          ))}
        </>
      )}
    </Screen>
  );
}

/* ------------------------------------------------------------- détail */

/** Ce que le reçu PDF porte : le montant, les références, et pour un dépôt sa trace sur la blockchain. */
function donneesDuRecu(o: Operation, nom: string | null | undefined): Omit<RecuDonnees, "preuve" | "emisLe"> {
  const lignes: [string, string][] = [];
  let titre = t("Opération Glisil", "Glisil transaction");
  let montant = `${xaf(o.montant)} XAFe`;
  if (o.nature === "depot") {
    const op = opDe(o.detail.operateur).nom;
    titre = t(`Dépôt ${op}`, `${op} deposit`);
    montant = `+${xaf(o.detail.montantRecu)} XAFe`;
    lignes.push(["Float", `${op} · ${numeroEnTranches(o.detail.floatNumero)}`]); // langue-ok
    for (const d of o.detail.declarations.filter((x) => x.etat === "credite")) {
      if (d.numeroPayeur) lignes.push([t("Depuis", "From"), numeroEnTranches(d.numeroPayeur)]);
      lignes.push([`Transaction ID ${op.split(" ")[0]}`, `${d.transactionId} · ${xaf(d.montant ?? 0)} XAF`]); // langue-ok
      if (d.crediteLe) lignes.push([t("Crédité", "Credited"), quand(d.crediteLe)]);
    }
  } else if (o.nature === "sortie") {
    const op = opDe(o.detail.operateur).nom;
    titre = t(`Retrait vers ${op}`, `Withdrawal to ${op}`);
    /* en preuve, rien n'est encore « envoyé » : on dit ce qui part, pas 0 */
    montant = `${xaf(o.detail.etat === "envoyee" || o.detail.etat === "partielle" ? o.detail.montantEnvoye : o.detail.montantXaf)} XAF`;
    lignes.push([t("Vers", "To"), numeroEnTranches(o.detail.numero)], [t("XAFe débités", "XAFe debited"), xaf(o.detail.montant)], [t("Frais", "Fees"), `${xaf(o.detail.frais)} XAFe`]);
    if (o.detail.nomBeneficiaire) lignes.push([t("Au nom de", "Recipient name"), o.detail.nomBeneficiaire]);
    for (const tr of o.detail.transferts.filter((x) => x.referenceOperateur)) lignes.push(["Transaction ID", `${tr.referenceOperateur} · ${xaf(tr.envoi)} XAF`]); // langue-ok
    const paiements = o.detail.paiements ?? [];
    if (paiements.length) for (const p of paiements) lignes.push(["Transaction ID", paiements.length > 1 ? `${p.transactionId} · ${xaf(p.montant)} XAF` : p.transactionId]); // langue-ok
    else if (o.detail.transactionId) lignes.push(["Transaction ID", o.detail.transactionId]); // langue-ok
    if (o.detail.prouveeLe) lignes.push([t("Vérifié", "Verified"), quand(o.detail.prouveeLe)]);
  } else if (o.nature === "ordre") {
    const B = baseDe(o.detail.paire ?? "USDT/XAFe");
    titre = o.detail.cote === "achat" ? t(`Achat d'${B}`, `${B} purchase`) : t(`Vente d'${B}`, `${B} sale`);
    montant = `${fUsdt(o.detail.executee)} ${B}`;
    lignes.push([t("Pour", "For"), `${xaf(o.detail.totalXafe)} XAFe`]);
  } else if (o.nature === "dotation") {
    titre = t("Argent de test (bêta)", "Test money (beta)");
    montant = `+${xaf(o.detail.xafe)} XAFe`;
    if (o.detail.usdt > 0) lignes.push(["USDT", `+${enTranches(o.detail.usdt, 2)} USDT`]);
    lignes.push([t("Motif", "Reason"), motifLisible(o.detail.motif)], [t("Valeur", "Value"), t("aucune hors de la bêta", "none outside the beta")]);
  } else {
    titre = `${o.montant > 0 ? t("Dépôt", "Deposit") : t("Retrait", "Withdrawal")} ${o.actif} · ${infoReseau(o.detail.reseau).nom}`;
    montant = `${o.montant > 0 ? "+" : ""}${enTranches(o.montant, o.actif === "XAFe" ? 0 : 2)} ${o.actif}`;
    lignes.push([t("Adresse", "Address"), o.detail.adresse]);
    if ("txHash" in o.detail && o.detail.txHash) lignes.push(["Transaction", o.detail.txHash]); // langue-ok
  }
  return { reference: o.reference, titre, montant, quand: quand(o.quand), client: nom ?? null, lignes, chaine: o.nature === "depot" ? o.detail.chaine ?? [] : [] };
}

export function HistoriqueDetail() {
  const { ref } = useParams();
  const { data: o, isLoading } = useOperation(ref);
  const { data: compte } = useCompte();
  const [partage, setPartage] = useState<string | null>(null);

  if (isLoading && !o) return <Screen title={t("Détail", "Details")} back="/historique"><Squelette hauteur={260} /></Screen>;
  if (!o) return <Screen title={t("Introuvable", "Not found")} back="/historique"><Typography variant="body2">{t("Cette opération n'est pas sur votre compte.", "This transaction isn't on your account.")}</Typography></Screen>;
  if (o.nature === "ordre") return <Navigate to={`/marche/ordres/${o.reference}`} replace />;

  const a = apparence(o);
  /* un seul paiement crédité : le reçu de la maquette, ligne à ligne ; plusieurs : la liste des transaction ID */
  const seul = o.nature === "depot" && o.detail.declarations.length === 1 && o.detail.declarations[0].etat === "credite" ? o.detail.declarations[0] : null;
  const opCourt = o.nature === "depot" ? opDe(o.detail.operateur).nom.split(" ")[0] : "";
  /* le reçu se télécharge comme un fichier PDF : un lien ne survit pas au partage */
  const telecharger = async () => {
    setPartage(t("Préparation du reçu…", "Preparing receipt…"));
    try {
      await telechargerRecu(donneesDuRecu(o, compte?.nom));
      setPartage(t("Reçu téléchargé.", "Receipt downloaded."));
    } catch {
      setPartage(t("Le reçu n'a pas pu être préparé. Réessayez.", "The receipt couldn't be prepared. Please try again."));
    }
    setTimeout(() => setPartage(null), 2500);
  };

  return (
    <Screen title={a.titre} back="/historique">
      <Box textAlign="center" py={2}>
        <Typography variant="h3" sx={{ color: a.couleur ?? "text.primary", fontSize: a.droite.length > 12 ? 32 : 40 }}>{a.droite}</Typography>
        <Typography variant="body2">{o.nature === "crypto" ? "" : "XAFe · "}{quand(o.quand)}</Typography>
        <Chip label={nomDeLEtat(o.etat)} size="small" sx={{ mt: 1, bgcolor: tones[a.tone].bg, color: tones[a.tone].fg }} />
      </Box>

      {o.nature === "depot" && seul && (
        <Card>
          {seul.numeroPayeur && <Line label={t("Depuis", "From")} value={`${opCourt} · ${numeroEnTranches(seul.numeroPayeur)}`} />}
          {seul.luLe && <Line label={t("Lu par TOTEM", "Read by TOTEM")} value={heureSecondes(seul.luLe)} />}
          {seul.crediteLe && <Line label={t("Crédité", "Credited")} value={heureSecondes(seul.crediteLe)} />}
          <Line label={t("Référence XAFe", "XAFe reference")} value={o.reference} />
          <Line label={t(`Référence ${opCourt}`, `${opCourt} reference`)} value={seul.transactionId} />
        </Card>
      )}

      {o.nature === "depot" && !seul && (
        <Card>
          <Line label={t("Par", "Via")} value={`${opDe(o.detail.operateur).nom} · float ${numeroEnTranches(o.detail.floatNumero)}`} />
          <Line label={t("Référence XAFe", "XAFe reference")} value={o.reference} />
          {o.detail.declarations.map((d) => (
            <Line key={d.id} label={d.etat === "credite" ? `ID ${d.transactionId}` : d.etat === "refuse" ? t(`ID ${d.transactionId} · retenu`, `ID ${d.transactionId} · held`) : t(`ID ${d.transactionId} · en attente`, `ID ${d.transactionId} · pending`)} value={d.montant != null ? `${xaf(d.montant)} XAF${d.crediteLe ? ` · ${heureSecondes(d.crediteLe)}` : ""}` : t("SMS pas encore lu", "SMS not read yet")} mono />
          ))}
          {o.detail.declarations.some((d) => d.etat === "refuse") && <Typography variant="body2" color="error">{t("Un paiement dépasse votre palier : il est retenu et l'équipe vous rembourse. Signalez-le si rien ne bouge sous 24 h.", "A payment exceeds your tier limit: it is held and our team will refund you. Report it if nothing happens within 24 hours.")}</Typography>}
        </Card>
      )}

      {o.nature === "depot" && <SurLaChaine traces={o.detail.chaine} />}

      {o.nature === "sortie" && (
        <Card>
          <Line label={t("Vers", "To")} value={`${opDe(o.detail.operateur).nom.split(" ")[0]} · ${numeroEnTranches(o.detail.numero)}`} />
          <Line label="XAFe" value={xaf(o.detail.montant)} />
          <Line label={t("Frais", "Fees")} value={xaf(o.detail.frais)} />
          <Line label={t("Envoyé", "Sent")} value={`${xaf(o.detail.montantEnvoye)} XAF`} strong />
          {o.detail.montantRendu > 0 && <Line label={t("Revenu sur le compte", "Returned to account")} value={`${xaf(o.detail.montantRendu)} XAFe`} color={tones.amber.fg} />}
          <Line label={t("Référence", "Reference")} value={o.reference} mono />
          {o.detail.mode === "manuel" && o.detail.nomBeneficiaire && <Line label={t("Au nom de", "Recipient name")} value={o.detail.nomBeneficiaire} />}
          <Line label={t("État", "Status")} value={nomDeLEtat(o.detail.etat)} />
          {(o.detail.paiements?.length ? o.detail.paiements : o.detail.transactionId ? [{ transactionId: o.detail.transactionId, montant: o.detail.montantXaf }] : []).map((p) => (
            <Line key={p.transactionId} label={"Transaction ID" /* langue-ok */} value={(o.detail.paiements?.length ?? 0) > 1 ? `${p.transactionId} · ${xaf(p.montant)} XAF` : p.transactionId} mono />
          ))}
          {o.detail.payeeLe && <Line label={t("Payé", "Paid")} value={quand(o.detail.payeeLe)} />}
          {o.detail.prouveeLe && <Line label={t("Vérifié", "Verified")} value={quand(o.detail.prouveeLe)} />}
          {o.detail.etat === "en_preuve" && <Typography variant="body2">{t("L'équipe a payé ; Glisil vérifie ce paiement auprès de l'opérateur avant de le confirmer.", "The team has paid; Glisil is checking this payment with the operator before confirming it.")}</Typography>}
          {o.detail.motif && <Typography variant="body2" color="error">{t(`Refusée : ${o.detail.motif} Vos XAFe sont revenus.`, `Declined: ${motifLisible(o.detail.motif)} Your XAFe have been returned.`)}</Typography>}
          {o.detail.transferts.map((tr, i) => (
            <Line key={i} label={t(`Transfert ${i + 1} · ${nomDeLEtat(tr.etat)}`, `Transfer ${i + 1} · ${nomDeLEtat(tr.etat)}`)} value={tr.referenceOperateur ? `ID ${tr.referenceOperateur}` : `${xaf(tr.envoi)} XAF`} mono />
          ))}
          {o.detail.etat === "echouee" && <Typography variant="body2" color="error">{t(`${opDe(o.detail.operateur).nom} a refusé le transfert trois fois (numéro invalide ou réseau muet). Vos XAFe sont revenus.`, `${opDe(o.detail.operateur).nom} declined the transfer three times (invalid number or network not responding). Your XAFe have been returned.`)}</Typography>}
        </Card>
      )}

      {o.nature === "dotation" && (
        <Card>
          <Line label="XAFe" value={`+${xaf(o.detail.xafe)}`} />
          {o.detail.usdt > 0 && <Line label="USDT" value={`+${enTranches(o.detail.usdt, 2)}`} />}
          <Line label={t("Motif", "Reason")} value={motifLisible(o.detail.motif)} />
          <Line label={t("Référence", "Reference")} value={o.reference} mono />
          <Typography variant="body2">{t("C'est de l'argent de test de la bêta : il sert à essayer le marché et n'a aucune valeur hors de Glisil.", "This is beta test money: it's for trying out the market and has no value outside Glisil.")}</Typography>
        </Card>
      )}

      {o.nature === "crypto" && (
        <Card>
          <Line label={t("Réseau", "Network")} value={libelleReseau(infoReseau(o.detail.reseau))} />
          <Line label={t("Adresse", "Address")} value={o.detail.adresse} mono />
          {"frais" in o.detail && <Line label={t("Frais", "Fees")} value={`${enTranches(o.detail.frais, o.actif === "XAFe" ? 0 : 2)} ${o.actif}`} />}
          <Line label={"Transaction" /* langue-ok */} value={("txHash" in o.detail && o.detail.txHash) || t("en attente", "pending")} mono />
          <Line label={t("Référence", "Reference")} value={o.reference} mono />
        </Card>
      )}

      <Box sx={{ flex: 1 }} />
      <Stack gap={1}>
        {o.nature === "depot" && (o.etat === "en_attente" || o.detail.declarations.some((d) => d.etat === "attendu")) && (
          <Button variant="contained" startIcon={<ReplayRounded />} component={Link} to={`/entrer/transaction/${o.reference}`}>{t("Reprendre : entrer un transaction ID", "Resume: enter a transaction ID")}</Button>
        )}
        {!enSuspens(o) && <Button variant="outlined" startIcon={<DownloadRounded />} onClick={() => void telecharger()}>{partage ?? t("Télécharger le reçu (PDF)", "Download receipt (PDF)")}</Button>}
        <Button variant="text" component={Link} to={`/compte/aide?ref=${encodeURIComponent(o.reference)}`}>{t("Signaler un problème", "Report a problem")}</Button>
      </Stack>
    </Screen>
  );
}
