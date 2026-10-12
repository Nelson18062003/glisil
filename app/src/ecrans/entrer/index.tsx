/*
 * Entrer des XAF : 1 Opérateur → 2 Payer → 3 Transaction ID → 4 Crédité.
 * Le client paie d'abord, comme il sait le faire ; puis il tape le transaction
 * ID de son SMS. TOTEM a le même ID dans le SMS du float : c'est lui qui
 * rapproche et crédite, ID par ID, en temps réel.
 */
import AccountBalanceRounded from "@mui/icons-material/AccountBalanceRounded";
import AddRounded from "@mui/icons-material/AddRounded";
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import ContentCopyRounded from "@mui/icons-material/ContentCopyRounded";
import ErrorOutlineRounded from "@mui/icons-material/ErrorOutlineRounded";
import HourglassTopRounded from "@mui/icons-material/HourglassTopRounded";
import { Box, Button, Chip, CircularProgress, IconButton, Paper, Stack, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useCompte, useDepot, useGuichet, useRafraichir } from "../../guichet";
import type { Declaration, IdOperateur } from "../../guichet/types";
import { OPERATEURS, PALIERS, operateur as opDe } from "../../noyau/argent";
import { heure, numeroEnTranches, quand, xaf } from "../../noyau/format";
import { tones } from "../../theme";
import { Card, Feuille, FeuilleErreur, Line, List, Row, Screen, Squelette, Success } from "../../ui";
import { useGesteUnique } from "../../ui/gestes";

/* ------------------------------------------------------- 1 · opérateur */

export function EntrerOperateur() {
  const guichet = useGuichet();
  const navigate = useNavigate();
  const { data: compte } = useCompte();
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique("dp");
  const palier = compte ? PALIERS[compte.palier] : null;

  const choisir = (operateur: IdOperateur) =>
    lancer(async (cle) => {
      const d = await guichet.ouvrirDepot({ operateur, cle });
      navigate(`/entrer/payer/${d.reference}`);
    });

  return (
    <Screen title="Entrer des XAF" back="/">
      <Typography variant="body2">Par où payez-vous ?</Typography>
      <List>
        {OPERATEURS.map((o) => (
          <Row key={o.id} badge={o.id} primary={o.nom} secondary={`${xaf(o.plafondParTransfert)} XAF max par transfert`} onClick={() => void choisir(o.id)} disabled={enCours} />
        ))}
        <Row icon={<AccountBalanceRounded />} tone="neutral" primary="Virement bancaire" secondary="Bientôt" disabled />
      </List>
      {palier?.entreeJour != null && (
        <Typography variant="body2" textAlign="center">
          {palier.nom.split(" · ")[0]} : au plus {xaf(palier.entreeJour)} XAF par jour. Au-delà, l'argent est retenu et remboursé.
        </Typography>
      )}
      {enCours && <Stack alignItems="center" sx={{ mt: 2 }}><CircularProgress size={28} /></Stack>}
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Screen>
  );
}

/* ----------------------------------------------------------- 2 · payer */

export function EntrerPayer() {
  const { ref } = useParams();
  const guichet = useGuichet();
  const navigate = useNavigate();
  const { data: depot } = useDepot(ref);
  const { data: compte } = useCompte();
  const [copie, setCopie] = useState(false);
  const [demande, setDemande] = useState(false);
  const { lancer, erreur, effacerErreur } = useGesteUnique();

  const op = depot ? opDe(depot.operateur) : null;
  const palier = compte ? PALIERS[compte.palier] : null;

  const copier = async () => {
    if (!depot) return;
    try { await navigator.clipboard.writeText(depot.floatNumero); setCopie(true); setTimeout(() => setCopie(false), 1500); } catch { /* le presse-papiers peut être refusé : le numéro reste lisible */ }
  };

  /* la flèche : si rien n'a été déclaré, le dossier se ferme et on revient au choix de l'opérateur */
  const retour = () => {
    if (depot && depot.declarations.length === 0 && depot.etat === "en_attente") {
      void lancer(async () => { await guichet.annulerDepot(depot.reference); navigate("/entrer/operateur", { replace: true }); });
    } else navigate("/entrer/operateur");
  };

  if (!depot || !op) return <Screen title="Payez" onBack={() => navigate("/entrer/operateur")}><Squelette hauteur={260} /></Screen>;

  return (
    <Screen title={`Payez par ${op.nom}`} onBack={retour} fermer="/">
      <Card>
        <Typography variant="body2">Transférez ce que vous voulez entrer</Typography>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ bgcolor: "background.default", borderRadius: 3, px: 2, py: 1 }}>
          <Stack>
            <Typography variant="caption">au numéro {op.nom}</Typography>
            <Typography variant="h5" sx={{ fontVariantNumeric: "tabular-nums" }}>{numeroEnTranches(depot.floatNumero)}</Typography>
          </Stack>
          <IconButton aria-label="Copier le numéro" onClick={() => void copier()} color={copie ? "primary" : "default"}>
            {copie ? <CheckCircleRounded /> : <ContentCopyRounded />}
          </IconButton>
        </Stack>
        {depot.codeAgent && <Line label="Ou retrait chez notre agent, code" value={depot.codeAgent} strong />}
        <Line label="Plafond par transfert" value={`${xaf(op.plafondParTransfert)} XAF`} />
        {palier?.entreeJour != null && <Line label="Votre plafond du jour" value={`${xaf(palier.entreeJour)} XAF`} />}
        <Line label="Dossier" value={depot.reference} mono />
      </Card>
      <Typography variant="body2" textAlign="center">
        Depuis votre puce, votre flotte ou chez un agent : vous recevrez un SMS avec un <b>transaction ID</b>. C'est lui qu'on vous demandera, rien d'autre.
      </Typography>
      <Box sx={{ flex: 1 }} />
      <Stack gap={1}>
        <Button variant="contained" onClick={() => navigate(`/entrer/transaction/${depot.reference}`)}>J'ai payé</Button>
        <Button variant="outlined" href={depot.operateur === "mtn" ? "tel:*126%23" : "tel:%23150%23"}>
          Ouvrir {op.nom} ({depot.operateur === "mtn" ? "*126#" : "#150#"})
        </Button>
        <Button variant="text" size="small" onClick={() => setDemande(true)}>Comment payer ?</Button>
      </Stack>
      <Feuille ouverte={demande} onFermer={() => setDemande(false)} titre="Trois façons de payer">
        <Stack gap={1.5}>
          <Typography variant="body1"><b>Transfert</b> depuis votre puce {op.nom} vers le {numeroEnTranches(depot.floatNumero)}.</Typography>
          <Typography variant="body1"><b>Transfert de flotte</b>, si vous êtes agent, vers le même numéro.</Typography>
          {depot.codeAgent && <Typography variant="body1"><b>Retrait chez notre agent</b> : composez un retrait au code {depot.codeAgent} ; l'argent passe de votre compte au nôtre.</Typography>}
          <Typography variant="body2">Dans les trois cas, le SMS de {op.nom} porte un transaction ID : c'est ce qu'il faudra taper ensuite.</Typography>
          <Button variant="contained" onClick={() => setDemande(false)}>Compris</Button>
        </Stack>
      </Feuille>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Screen>
  );
}

/* ------------------------------------------------- 3 · transaction ID */

export function EntrerTransaction() {
  const { ref } = useParams();
  const guichet = useGuichet();
  const navigate = useNavigate();
  const rafraichir = useRafraichir();
  const { data: depot } = useDepot(ref);
  const [saisie, setSaisie] = useState("");
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();
  const { lancer: lancerFin, enCours: finEnCours } = useGesteUnique();

  const ajouter = () =>
    lancer(async () => {
      if (!depot) return;
      await guichet.declarerTransaction({ reference: depot.reference, transactionId: saisie });
      setSaisie("");
      await rafraichir();
    });

  const terminer = () =>
    lancerFin(async () => {
      if (!depot) return;
      await guichet.terminerDepot(depot.reference);
      navigate(`/entrer/credite/${depot.reference}`, { replace: true });
    });

  const credites = depot?.declarations.filter((d) => d.etat === "credite") ?? [];
  const enAttente = depot?.declarations.filter((d) => d.etat === "attendu") ?? [];

  if (!depot) return <Screen title="Transaction ID" back="/entrer/operateur"><Squelette hauteur={200} /></Screen>;

  return (
    <Screen title="Le transaction ID du SMS" back={`/entrer/payer/${depot.reference}`} fermer="/" gap={1.5}>
      <Typography variant="body2">
        Recopiez le transaction ID du SMS de {opDe(depot.operateur).nom}. Un par transfert : si vous avez payé en trois fois, trois ID.
      </Typography>
      <form onSubmit={(e) => { e.preventDefault(); if (saisie.trim().length >= 6) void ajouter(); }}>
        <Stack direction="row" gap={1} alignItems="flex-start">
          <TextField
            label="Transaction ID"
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            fullWidth
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            placeholder={depot.operateur === "mtn" ? "ex. 20394817104" : "ex. MP261012.1402.A12345"}
            slotProps={{ input: { sx: { fontFamily: "Roboto Mono, monospace", fontSize: 18 } } }}
          />
          <Button type="submit" variant="contained" disabled={saisie.trim().length < 6 || enCours} sx={{ minHeight: 56, px: 2.5, flexShrink: 0 }} startIcon={<AddRounded />}>
            Ajouter
          </Button>
        </Stack>
      </form>

      {depot.declarations.length > 0 && (
        <Paper sx={{ p: 1, borderRadius: 6 }}>
          {depot.declarations.map((d) => <LigneDeclaration key={d.id} d={d} />)}
        </Paper>
      )}

      {depot.montantRecu > 0 && (
        <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ px: 1 }}>
          <Typography variant="body2">Crédité jusqu'ici</Typography>
          <Typography variant="h5" color="primary.main" sx={{ fontVariantNumeric: "tabular-nums" }}>+{xaf(depot.montantRecu)} XAFe</Typography>
        </Stack>
      )}

      {depot.declarations.length === 0 && (
        <Typography variant="caption" textAlign="center" sx={{ px: 2 }}>
          Vos XAFe arrivent dès que TOTEM retrouve le SMS de votre paiement, en général en moins de 10 s. Si le SMS n'est pas encore arrivé, votre ID attend et se crédite tout seul.
        </Typography>
      )}

      <Box sx={{ flex: 1 }} />
      <Button variant="contained" disabled={credites.length === 0 || finEnCours} onClick={() => void terminer()}>
        {credites.length === 0 ? "Terminer" : enAttente.length > 0 ? `Terminer (${enAttente.length} en attente)` : "Terminer"}
      </Button>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Screen>
  );
}

function LigneDeclaration({ d }: { d: Declaration }) {
  const etat = d.etat === "credite"
    ? { icone: <CheckCircleRounded />, tone: "green" as const, texte: `+${xaf(d.montant ?? 0)} XAFe · ${heure(d.crediteLe ?? d.declareLe)}` }
    : d.etat === "refuse"
      ? { icone: <ErrorOutlineRounded />, tone: "red" as const, texte: d.motif ?? "retenu" }
      : { icone: <HourglassTopRounded />, tone: "amber" as const, texte: "on cherche le SMS…" };
  return (
    <Stack direction="row" alignItems="center" gap={1.5} sx={{ px: 1.5, py: 1.25 }}>
      <Box sx={{ width: 44, height: 44, borderRadius: 22, display: "grid", placeItems: "center", bgcolor: tones[etat.tone].bg, color: tones[etat.tone].fg }}>
        {d.etat === "attendu" ? <CircularProgress size={20} sx={{ color: "inherit" }} /> : etat.icone}
      </Box>
      <Stack sx={{ flex: 1, minWidth: 0 }}>
        <Typography fontWeight={500} sx={{ fontFamily: "Roboto Mono, monospace", fontSize: 15 }}>{d.transactionId}</Typography>
        <Typography variant="body2" noWrap sx={{ color: etat.tone === "red" ? "error.main" : undefined }}>{etat.texte}</Typography>
      </Stack>
      {d.etat === "credite" && <Chip label="Crédité" size="small" sx={{ bgcolor: tones.green.bg, color: tones.green.fg, height: 26 }} />}
    </Stack>
  );
}

/* --------------------------------------------------------- 4 · crédité */

export function EntrerCredite() {
  const { ref } = useParams();
  const { data: depot } = useDepot(ref);
  if (!depot) return <Screen><Squelette hauteur={300} /></Screen>;
  const credites = depot.declarations.filter((d) => d.etat === "credite");
  const dernier = depot.crediteLe ?? depot.creeLe;
  return (
    <Success
      title="XAFe crédités"
      amount={`+${xaf(depot.montantRecu)} XAFe`}
      caption={`${credites.length > 1 ? `${credites.length} transferts, ` : ""}${quand(dernier)}, par ${opDe(depot.operateur).nom}.`}
      primary={{ label: "Aller au marché", to: "/marche" }}
      secondary={{ label: "Retour à l'accueil", to: "/" }}
    >
      <Card>
        <Line label="Dossier XAFe" value={depot.reference} mono />
        {credites.map((d) => <Line key={d.id} label={`Transaction ID ${opDe(depot.operateur).nom}`} value={d.transactionId} mono />)}
      </Card>
    </Success>
  );
}
