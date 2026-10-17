/*
 * L'Historique : tout ce qui a bougé, par jour ; ce qui est en attente ou en
 * cours toujours en tête. Une ligne → son Détail, avec le reçu.
 */
import ArrowDownwardRounded from "@mui/icons-material/ArrowDownwardRounded";
import ArrowUpwardRounded from "@mui/icons-material/ArrowUpwardRounded";
import CurrencyBitcoinRounded from "@mui/icons-material/CurrencyBitcoinRounded";
import ReceiptLongOutlined from "@mui/icons-material/ReceiptLongOutlined";
import ReplayRounded from "@mui/icons-material/ReplayRounded";
import DownloadRounded from "@mui/icons-material/DownloadRounded";
import SwapHorizRounded from "@mui/icons-material/SwapHorizRounded";
import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useCompte, useHistorique, useOperation } from "../../guichet";
import type { Operation } from "../../guichet/types";
import type { RecuDonnees } from "../../noyau/recu-pdf";
import { infoReseau, libelleReseau, operateur as opDe } from "../../noyau/argent";
import { enTranches, heure, heureSecondes, jourRelatif, numeroEnTranches, prix as fPrix, quand, signe, usdt as fUsdt, xaf } from "../../noyau/format";
import { tones, type Tone } from "../../theme";
import { Card, Chips, EtatVide, Line, List, Row, Screen, Squelette } from "../../ui";
import { SurLaChaine } from "../../ui/chaine";
import { telechargerRecu } from "../../ui/recu";

const FILTRES = ["Tout", "Entrées", "Sorties", "Ordres", "Crypto"] as const;
type Filtre = (typeof FILTRES)[number];

const ETATS: Record<string, string> = {
  en_attente: "en attente", partiel: "partiel", credite: "crédité", expire: "expiré", annule: "annulé", en_cours: "en cours", envoyee: "envoyé", partielle: "partiel", echouee: "échoué",
  annulee: "annulé", ouvert: "ouvert", execute: "exécuté", confirme: "confirmé", echoue: "échoué",
};
const enSuspens = (o: Operation) => ["en_attente", "partiel", "en_cours", "ouvert"].includes(o.etat);

function apparence(o: Operation): { icone: JSX.Element; tone: Tone; titre: string; sousTitre: string; droite: string; couleur?: string } {
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
  }
}

const passeLeFiltre = (o: Operation, f: Filtre) =>
  f === "Tout" || (f === "Entrées" && o.nature === "depot") || (f === "Sorties" && o.nature === "sortie") || (f === "Ordres" && o.nature === "ordre") || (f === "Crypto" && o.nature === "crypto");

export function Historique() {
  const { data } = useHistorique();
  const [filtre, setFiltre] = useState<Filtre>("Tout");
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
    <Screen tab="historique" title="Historique">
      <Chips items={[...FILTRES]} selected={filtre} onSelect={(f) => setFiltre(f as Filtre)} />
      {!data ? <Squelette hauteur={240} /> : data.length === 0 ? (
        <EtatVide icone={<ReceiptLongOutlined sx={{ fontSize: 36 }} />} tone="green" titre="Aucune opération pour l'instant"
          texte="Vos entrées, sorties, achats et ventes s'afficheront ici, avec leur reçu. Tout commence par une entrée de XAF."
          action={{ label: "Entrer des XAF", to: "/entrer/operateur" }} />
      ) : ops.length === 0 ? (
        <EtatVide icone={<ReceiptLongOutlined sx={{ fontSize: 36 }} />} titre={`Aucune opération dans « ${filtre} »`}
          texte="Les autres filtres en ont peut-être." action={{ label: "Tout voir", onClick: () => setFiltre("Tout") }} />
      ) : (
        <>
          {suspens.length > 0 && (
            <>
              <Typography variant="subtitle1" sx={{ mt: 1 }}>En cours</Typography>
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
  let titre = "Opération Glisil";
  let montant = `${xaf(o.montant)} XAFe`;
  if (o.nature === "depot") {
    const op = opDe(o.detail.operateur).nom;
    titre = `Dépôt ${op}`;
    montant = `+${xaf(o.detail.montantRecu)} XAFe`;
    lignes.push(["Float", `${op} · ${numeroEnTranches(o.detail.floatNumero)}`]);
    for (const d of o.detail.declarations.filter((x) => x.etat === "credite")) {
      if (d.numeroPayeur) lignes.push(["Depuis", numeroEnTranches(d.numeroPayeur)]);
      lignes.push([`Transaction ID ${op.split(" ")[0]}`, `${d.transactionId} · ${xaf(d.montant ?? 0)} XAF`]);
      if (d.crediteLe) lignes.push(["Crédité", quand(d.crediteLe)]);
    }
  } else if (o.nature === "sortie") {
    const op = opDe(o.detail.operateur).nom;
    titre = `Retrait vers ${op}`;
    montant = `${xaf(o.detail.montantEnvoye)} XAF`;
    lignes.push(["Vers", numeroEnTranches(o.detail.numero)], ["XAFe débités", xaf(o.detail.montant)], ["Frais", `${xaf(o.detail.frais)} XAFe`]);
    if (o.detail.nomBeneficiaire) lignes.push(["Au nom de", o.detail.nomBeneficiaire]);
    for (const t of o.detail.transferts.filter((x) => x.referenceOperateur)) lignes.push(["Transaction ID", `${t.referenceOperateur} · ${xaf(t.envoi)} XAF`]);
    if (o.detail.transactionId) lignes.push(["Transaction ID", o.detail.transactionId]);
  } else if (o.nature === "ordre") {
    titre = o.detail.cote === "achat" ? "Achat d'USDT" : "Vente d'USDT";
    montant = `${fUsdt(o.detail.executee)} USDT`;
    lignes.push(["Pour", `${xaf(o.detail.totalXafe)} XAFe`]);
  } else {
    titre = `${o.montant > 0 ? "Dépôt" : "Retrait"} ${o.actif} · ${infoReseau(o.detail.reseau).nom}`;
    montant = `${o.montant > 0 ? "+" : ""}${enTranches(o.montant, o.actif === "USDT" ? 2 : 0)} ${o.actif}`;
    lignes.push(["Adresse", o.detail.adresse]);
    if ("txHash" in o.detail && o.detail.txHash) lignes.push(["Transaction", o.detail.txHash]);
  }
  return { reference: o.reference, titre, montant, quand: quand(o.quand), client: nom ?? null, lignes, chaine: o.nature === "depot" ? o.detail.chaine ?? [] : [] };
}

export function HistoriqueDetail() {
  const { ref } = useParams();
  const { data: o, isLoading } = useOperation(ref);
  const { data: compte } = useCompte();
  const [partage, setPartage] = useState<string | null>(null);

  if (isLoading && !o) return <Screen title="Détail" back="/historique"><Squelette hauteur={260} /></Screen>;
  if (!o) return <Screen title="Introuvable" back="/historique"><Typography variant="body2">Cette opération n'est pas sur votre compte.</Typography></Screen>;
  if (o.nature === "ordre") return <Navigate to={`/marche/ordres/${o.reference}`} replace />;

  const a = apparence(o);
  /* un seul paiement crédité : le reçu de la maquette, ligne à ligne ; plusieurs : la liste des transaction ID */
  const seul = o.nature === "depot" && o.detail.declarations.length === 1 && o.detail.declarations[0].etat === "credite" ? o.detail.declarations[0] : null;
  const opCourt = o.nature === "depot" ? opDe(o.detail.operateur).nom.split(" ")[0] : "";
  /* le reçu se télécharge comme un fichier PDF : un lien ne survit pas au partage */
  const telecharger = async () => {
    setPartage("Préparation du reçu…");
    try {
      await telechargerRecu(donneesDuRecu(o, compte?.nom));
      setPartage("Reçu téléchargé.");
    } catch {
      setPartage("Le reçu n'a pas pu être préparé. Réessayez.");
    }
    setTimeout(() => setPartage(null), 2500);
  };

  return (
    <Screen title={a.titre} back="/historique">
      <Box textAlign="center" py={2}>
        <Typography variant="h3" sx={{ color: a.couleur ?? "text.primary", fontSize: a.droite.length > 12 ? 32 : 40 }}>{a.droite}</Typography>
        <Typography variant="body2">{o.nature === "crypto" ? "" : "XAFe · "}{quand(o.quand)}</Typography>
        <Chip label={ETATS[o.etat] ?? o.etat} size="small" sx={{ mt: 1, bgcolor: tones[a.tone].bg, color: tones[a.tone].fg }} />
      </Box>

      {o.nature === "depot" && seul && (
        <Card>
          {seul.numeroPayeur && <Line label="Depuis" value={`${opCourt} · ${numeroEnTranches(seul.numeroPayeur)}`} />}
          {seul.luLe && <Line label="Lu par TOTEM" value={heureSecondes(seul.luLe)} />}
          {seul.crediteLe && <Line label="Crédité" value={heureSecondes(seul.crediteLe)} />}
          <Line label="Référence XAFe" value={o.reference} />
          <Line label={`Référence ${opCourt}`} value={seul.transactionId} />
        </Card>
      )}

      {o.nature === "depot" && !seul && (
        <Card>
          <Line label="Par" value={`${opDe(o.detail.operateur).nom} · float ${numeroEnTranches(o.detail.floatNumero)}`} />
          <Line label="Référence XAFe" value={o.reference} />
          {o.detail.declarations.map((d) => (
            <Line key={d.id} label={d.etat === "credite" ? `ID ${d.transactionId}` : d.etat === "refuse" ? `ID ${d.transactionId} · retenu` : `ID ${d.transactionId} · en attente`} value={d.montant != null ? `${xaf(d.montant)} XAF${d.crediteLe ? ` · ${heureSecondes(d.crediteLe)}` : ""}` : "SMS pas encore lu"} mono />
          ))}
          {o.detail.declarations.some((d) => d.etat === "refuse") && <Typography variant="body2" color="error">Un paiement dépasse votre palier : il est retenu et l'équipe vous rembourse. Signalez-le si rien ne bouge sous 24 h.</Typography>}
        </Card>
      )}

      {o.nature === "depot" && <SurLaChaine traces={o.detail.chaine} />}

      {o.nature === "sortie" && (
        <Card>
          <Line label="Vers" value={`${opDe(o.detail.operateur).nom.split(" ")[0]} · ${numeroEnTranches(o.detail.numero)}`} />
          <Line label="XAFe" value={xaf(o.detail.montant)} />
          <Line label="Frais" value={xaf(o.detail.frais)} />
          <Line label="Envoyé" value={`${xaf(o.detail.montantEnvoye)} XAF`} strong />
          {o.detail.montantRendu > 0 && <Line label="Revenu sur le compte" value={`${xaf(o.detail.montantRendu)} XAFe`} color={tones.amber.fg} />}
          <Line label="Référence" value={o.reference} mono />
          {o.detail.mode === "manuel" && o.detail.nomBeneficiaire && <Line label="Au nom de" value={o.detail.nomBeneficiaire} />}
          {o.detail.transactionId && <Line label="Transaction ID" value={o.detail.transactionId} mono />}
          {o.detail.payeeLe && <Line label="Payé" value={quand(o.detail.payeeLe)} />}
          {o.detail.motif && <Typography variant="body2" color="error">Refusée : {o.detail.motif} Vos XAFe sont revenus.</Typography>}
          {o.detail.transferts.map((t, i) => (
            <Line key={i} label={`Transfert ${i + 1} · ${ETATS[t.etat] ?? t.etat}`} value={t.referenceOperateur ? `ID ${t.referenceOperateur}` : `${xaf(t.envoi)} XAF`} mono />
          ))}
          {o.detail.etat === "echouee" && <Typography variant="body2" color="error">{opDe(o.detail.operateur).nom} a refusé le transfert trois fois (numéro invalide ou réseau muet). Vos XAFe sont revenus.</Typography>}
        </Card>
      )}

      {o.nature === "crypto" && (
        <Card>
          <Line label="Réseau" value={libelleReseau(infoReseau(o.detail.reseau))} />
          <Line label="Adresse" value={o.detail.adresse} mono />
          {"frais" in o.detail && <Line label="Frais" value={`${enTranches(o.detail.frais, o.actif === "USDT" ? 2 : 0)} ${o.actif}`} />}
          <Line label="Transaction" value={("txHash" in o.detail && o.detail.txHash) || "en attente"} mono />
          <Line label="Référence" value={o.reference} mono />
        </Card>
      )}

      <Box sx={{ flex: 1 }} />
      <Stack gap={1}>
        {o.nature === "depot" && (o.etat === "en_attente" || o.detail.declarations.some((d) => d.etat === "attendu")) && (
          <Button variant="contained" startIcon={<ReplayRounded />} component={Link} to={`/entrer/transaction/${o.reference}`}>Reprendre : entrer un transaction ID</Button>
        )}
        {!enSuspens(o) && <Button variant="outlined" startIcon={<DownloadRounded />} onClick={() => void telecharger()}>{partage ?? "Télécharger le reçu (PDF)"}</Button>}
        <Button variant="text" component={Link} to={`/compte/aide?ref=${encodeURIComponent(o.reference)}`}>Signaler un problème</Button>
      </Stack>
    </Screen>
  );
}
