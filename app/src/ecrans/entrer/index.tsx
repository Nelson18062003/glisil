/*
 * Entrer des XAF : 1 Opérateur → 2 Montant → 3 Payer → 4 Transaction ID → 5 Crédité.
 * Le montant tapé n'est qu'une indication pour l'écran : c'est le SMS du float
 * qui fait foi, et le client est crédité de ce qu'il a VRAIMENT envoyé.
 * Le client paie d'abord, comme il sait le faire ; puis il tape le transaction
 * ID de son SMS. TOTEM a le même ID dans le SMS du float : c'est lui qui
 * rapproche et crédite, ID par ID, en temps réel.
 */
import AccountBalanceRounded from "@mui/icons-material/AccountBalanceRounded";
import AddRounded from "@mui/icons-material/AddRounded";
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import ContentCopyRounded from "@mui/icons-material/ContentCopyRounded";
import ErrorOutlineRounded from "@mui/icons-material/ErrorOutlineRounded";
import CloseRounded from "@mui/icons-material/CloseRounded";
import HourglassTopRounded from "@mui/icons-material/HourglassTopRounded";
import { Box, Button, Chip, CircularProgress, IconButton, Paper, Stack, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useCompte, useDepot, useGuichet, useNumeros, useRafraichir } from "../../guichet";
import type { Declaration, IdOperateur } from "../../guichet/types";
import { montantValide, OPERATEURS, PALIERS, operateur as opDe } from "../../noyau/argent";
import { apresFrappe, heure, montantDepuisSaisie, numeroEnTranches, quand, xaf } from "../../noyau/format";
import { useParcours } from "../../navigation/parcours";
import { tones } from "../../theme";
import { Amount, Attente, Card, Chips, Feuille, FeuilleErreur, Keypad, Line, List, Row, Screen, Success } from "../../ui";
import { useGesteUnique } from "../../ui/gestes";

/* ------------------------------------------------------- 1 · opérateur */

export function EntrerOperateur() {
  const navigate = useNavigate();
  const { data: compte } = useCompte();
  const [, poser] = useParcours("entrer");
  const palier = compte ? PALIERS[compte.palier] : null;

  const choisir = (operateur: IdOperateur) => { poser({ operateur, montant: 0 }); navigate("/entrer/montant"); };

  return (
    <Screen title="Entrer des XAF" back="/">
      <Typography variant="body2">Par où payez-vous ?</Typography>
      <List>
        {OPERATEURS.map((o) => (
          <Row key={o.id} badge={o.id} primary={o.nom} secondary={`${xaf(o.plafondParTransfert)} XAF max par transfert`} onClick={() => choisir(o.id)} />
        ))}
        <Row icon={<AccountBalanceRounded />} tone="neutral" primary="Virement bancaire" secondary="Bientôt" disabled />
      </List>
      {palier?.entreeJour != null && (
        <Typography variant="body2" textAlign="center">
          {palier.nom.split(" · ")[0]} : au plus {xaf(palier.entreeJour)} XAF par jour. Au-delà, l'argent est retenu et remboursé.
        </Typography>
      )}
    </Screen>
  );
}

/* --------------------------------------------------------- 2 · montant */

export function EntrerMontant() {
  const guichet = useGuichet();
  const navigate = useNavigate();
  const { data: compte } = useCompte();
  const [etat, poser] = useParcours("entrer");
  const [saisie, setSaisie] = useState(etat.montant ? String(etat.montant) : "");
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique("dp");
  if (!etat.operateur) return <Navigate to="/entrer/operateur" replace />;
  const op = opDe(etat.operateur);
  const montant = montantDepuisSaisie(saisie);
  const palier = compte ? PALIERS[compte.palier] : null;
  const reste = palier?.entreeJour != null && compte ? Math.max(0, palier.entreeJour - compte.entreDuJour) : null;
  const transferts = Math.max(1, Math.ceil(montant / op.plafondParTransfert));
  const auDela = reste !== null && montant > reste;

  const aide = montant <= 0 ? (reste !== null ? `Reste à entrer aujourd'hui : ${xaf(reste)} XAF` : "Vous recevez autant de XAFe · sans frais")
    : auDela ? `Votre palier : ${xaf(reste!)} XAF encore aujourd'hui. Au-delà, l'argent est retenu et remboursé.`
    : transferts > 1 ? `Vous recevez ${xaf(montant)} XAFe · en ${transferts} transferts de ${xaf(op.plafondParTransfert)} au plus`
    : `Vous recevez ${xaf(montant)} XAFe · sans frais`;

  const continuer = () => lancer(async (cle) => {
    poser({ montant });
    const d = await guichet.ouvrirDepot({ operateur: op.id, cle });
    navigate(`/entrer/payer/${d.reference}`);
  });

  return (
    <Screen title="Montant" back="/entrer/operateur" gap={1.5}>
      <Amount value={saisie ? xaf(montant) : "0"} unit="XAF" hint={aide} hintColor={auDela ? "error.main" : undefined} />
      <Chips items={["500 000", "1 000 000", "5 000 000"]} selected={xaf(montant)} onSelect={(c) => setSaisie(c.replace(/\D/g, ""))} />
      <Box sx={{ flex: 1 }} />
      <Keypad onKey={(k) => setSaisie(apresFrappe(saisie, k))} />
      <Button variant="contained" disabled={!montantValide(montant, 100) || enCours} onClick={() => void continuer()}>Continuer</Button>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Screen>
  );
}

/* ----------------------------------------------------------- 3 · payer */

export function EntrerPayer() {
  const { ref } = useParams();
  const guichet = useGuichet();
  const navigate = useNavigate();
  const { data: depot, error: erreurDepot } = useDepot(ref);
  const { data: numeros } = useNumeros();
  const [etat] = useParcours("entrer");
  const [copie, setCopie] = useState(false);
  const [demande, setDemande] = useState(false);
  const { lancer, erreur, effacerErreur } = useGesteUnique();

  const op = depot ? opDe(depot.operateur) : null;
  /* le montant tapé à l'étape d'avant, s'il vise bien cet opérateur ; sinon on ne prétend rien */
  const prevu = depot && etat.operateur === depot.operateur && etat.montant > 0 ? etat.montant : null;
  const depuis = depot ? numeros?.find((n) => n.operateur === depot.operateur && n.verifieLe && !n.retireLe) ?? null : null;

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

  if (!depot || !op) return <Attente erreur={erreurDepot} title="Payez" back="/entrer/operateur" hauteur={260} />;

  /* Le numéro ne reçoit plus : sans rien de déclaré, on referme ce dossier et on en ouvre un autre — un autre float. */
  const ailleurs = () => void lancer(async () => {
    await guichet.annulerDepot(depot.reference);
    navigate("/entrer/operateur", { replace: true });
  });
  const ferme = depot.reception === "fermee";

  return (
    <Screen title={`Payez par ${op.nom}`} onBack={retour} fermer="/">
      {depot.reception !== "ouverte" && (
        <Stack direction="row" gap={1.5} role="alert" sx={{ p: 1.75, borderRadius: 3, bgcolor: tones[ferme ? "red" : "amber"].bg, color: tones[ferme ? "red" : "amber"].fg }}>
          {ferme ? <ErrorOutlineRounded /> : <HourglassTopRounded />}
          <Stack gap={0.5}>
            <Typography variant="body1" sx={{ fontWeight: 600, color: "inherit" }}>
              {ferme ? "Ce numéro ne reçoit plus : ne payez pas ici" : "Notre boîtier est hors ligne pour l'instant"}
            </Typography>
            <Typography variant="body2" sx={{ color: "inherit" }}>
              {ferme
                ? depot.declarations.length === 0
                  ? "Si vous avez déjà payé, tapez votre transaction ID : il sera traité. Sinon, payez à un autre numéro."
                  : "Votre paiement déjà fait sera traité. Pour un nouveau paiement, ouvrez un autre dépôt."
                : "Vous pouvez payer : le SMS sera lu à son retour, et votre crédit arrivera à ce moment-là."}
            </Typography>
          </Stack>
        </Stack>
      )}
      <Card>
        <Typography variant="body2">Envoyez</Typography>
        <Typography variant="h4">{prevu ? `${xaf(prevu)} XAF` : "Le montant de votre choix"}</Typography>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ bgcolor: "background.default", borderRadius: 3, px: 2, py: 1 }}>
          <Stack>
            <Typography variant="caption">au numéro</Typography>
            <Typography variant="h6" sx={{ fontVariantNumeric: "tabular-nums" }}>{numeroEnTranches(depot.floatNumero)}</Typography>
          </Stack>
          <IconButton aria-label="Copier le numéro" onClick={() => void copier()} color={copie ? "primary" : "default"}>
            {copie ? <CheckCircleRounded /> : <ContentCopyRounded />}
          </IconButton>
        </Stack>
        {depuis && <Line label="Depuis votre numéro" value={numeroEnTranches(depuis.numero)} />}
        {depot.codeAgent && <Line label="Ou retrait chez notre agent, code" value={depot.codeAgent} />}
        <Line label="Référence" value={depot.reference} />
      </Card>
      <Typography variant="body2" textAlign="center">
        Vos XAFe arrivent dès que le SMS de {op.nom.split(" ")[0]} est lu, en général en moins de 10 s. Gardez le <b>transaction ID</b> de votre SMS.
      </Typography>
      <Box sx={{ flex: 1 }} />
      <Stack gap={1}>
        {ferme && depot.declarations.length === 0 && <Button variant="contained" onClick={ailleurs}>Payer à un autre numéro</Button>}
        <Button variant={ferme ? "outlined" : "contained"} onClick={() => navigate(`/entrer/transaction/${depot.reference}`)}>J'ai payé</Button>
        {!ferme && (
          <Button variant="outlined" href={depot.operateur === "mtn" ? "tel:*126%23" : "tel:%23150%23"}>
            Ouvrir {op.nom} ({depot.operateur === "mtn" ? "*126#" : "#150#"})
          </Button>
        )}
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
  const { data: depot, error: erreurDepot } = useDepot(ref);
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

  if (!depot) return <Attente erreur={erreurDepot} title="Transaction ID" back="/entrer/operateur" hauteur={200} />;

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
          {depot.declarations.map((d) => (
            <LigneDeclaration key={d.id} d={d} onRetirer={d.etat === "attendu" ? () => void lancer(async () => {
              await guichet.retirerDeclaration({ reference: depot.reference, transactionId: d.transactionId });
              await rafraichir();
            }) : undefined} />
          ))}
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

/** Une déclaration ; celle qui attend se retire (un ID mal recopié n'attendrait plus qu'un SMS qui ne viendra jamais). */
function LigneDeclaration({ d, onRetirer }: { d: Declaration; onRetirer?: () => void }) {
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
        {onRetirer && <Typography variant="caption">Mal recopié ? Touchez × pour le retirer.</Typography>}
      </Stack>
      {d.etat === "credite" && <Chip label="Crédité" size="small" sx={{ bgcolor: tones.green.bg, color: tones.green.fg, height: 26 }} />}
      {onRetirer && <IconButton aria-label={`Retirer l'ID ${d.transactionId}`} onClick={onRetirer} sx={{ width: 48, height: 48 }}><CloseRounded /></IconButton>}
    </Stack>
  );
}

/* --------------------------------------------------------- 4 · crédité */

export function EntrerCredite() {
  const { ref } = useParams();
  const { data: depot, error: erreurDepot } = useDepot(ref);
  if (!depot) return <Attente erreur={erreurDepot} />;
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
