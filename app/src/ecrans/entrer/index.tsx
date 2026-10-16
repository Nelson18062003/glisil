/*
 * Entrer des XAF : 1 Opérateur → 2 Montant → 3 Payer → 4 J'ai payé → 5 Crédité.
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
import { Box, Button, Chip, CircularProgress, IconButton, InputAdornment, Paper, Stack, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useCompte, useDepot, useGuichet, useNumeros, useRafraichir } from "../../guichet";
import type { Declaration, IdOperateur } from "../../guichet/types";
import { montantValide, OPERATEURS, PALIERS, operateur as opDe } from "../../noyau/argent";
import { codeDeRetrait, lienUssd } from "../../noyau/depot";
import { apresFrappe, heure, montantDepuisSaisie, numeroEnTranches, numeroSaisi, numeroValide, operateurDuNumero, quand, transactionIdNormalise, xaf } from "../../noyau/format";
import { useParcours } from "../../navigation/parcours";
import { tones } from "../../theme";
import { Amount, Attente, Card, Chips, FeuilleErreur, Keypad, Line, List, Row, Screen, Success } from "../../ui";
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

/**
 * Payer : nos deux façons, comme le document remis aux clients — le transfert
 * vers notre numéro (avec le nom que le client doit lire avant de confirmer),
 * ou le retrait à notre point (le code, montant compris, qui se compose d'un
 * toucher). Puis « J'ai payé ».
 */
export function EntrerPayer() {
  const { ref } = useParams();
  const guichet = useGuichet();
  const navigate = useNavigate();
  const { data: depot, error: erreurDepot } = useDepot(ref);
  const [etat] = useParcours("entrer");
  const [copie, setCopie] = useState<string | null>(null);
  const { lancer, erreur, effacerErreur } = useGesteUnique();

  const op = depot ? opDe(depot.operateur) : null;
  /* le montant tapé à l'étape d'avant, s'il vise bien cet opérateur ; sinon on ne prétend rien */
  const prevu = depot && etat.operateur === depot.operateur && etat.montant > 0 ? etat.montant : null;

  const copier = async (quoi: string, texte: string) => {
    try { await navigator.clipboard.writeText(texte); setCopie(quoi); setTimeout(() => setCopie(null), 1500); } catch { /* le presse-papiers peut être refusé : le texte reste lisible */ }
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
  const code = codeDeRetrait(depot.operateur, depot.floatNumero, depot.codeAgent, prevu);
  const composer = code ? lienUssd(code) : null;

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
                  ? "Si vous avez déjà payé, déclarez votre paiement : il sera traité. Sinon, payez à un autre numéro."
                  : "Votre paiement déjà fait sera traité. Pour un nouveau paiement, ouvrez un autre dépôt."
                : "Vous pouvez payer : le SMS sera lu à son retour, et votre crédit arrivera à ce moment-là."}
            </Typography>
          </Stack>
        </Stack>
      )}

      {!ferme && <>
      <Stack alignItems="center" sx={{ py: 1 }}>
        <Typography variant="body2">Envoyez</Typography>
        <Typography variant="h4">{prevu ? `${xaf(prevu)} XAF` : "le montant de votre choix"}</Typography>
        <Typography variant="body2">d'une de ces deux façons</Typography>
      </Stack>

      <Card>
        <Typography variant="caption" sx={{ fontWeight: 700, color: "primary.main" }}>1 · TRANSFERT VERS NOTRE NUMÉRO</Typography>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ bgcolor: "background.default", borderRadius: 3, px: 2, py: 1 }}>
          <Stack sx={{ minWidth: 0 }}>
            <Typography variant="caption">{op.nom}</Typography>
            <Typography variant="h5" sx={{ fontVariantNumeric: "tabular-nums" }}>{numeroEnTranches(depot.floatNumero)}</Typography>
          </Stack>
          <IconButton aria-label="Copier le numéro" onClick={() => void copier("numero", depot.floatNumero)} color={copie === "numero" ? "primary" : "default"}>
            {copie === "numero" ? <CheckCircleRounded /> : <ContentCopyRounded />}
          </IconButton>
        </Stack>
        {depot.titulaire && (
          <>
            <Line label="Au nom de" value={depot.titulaire} strong />
            <Stack direction="row" gap={1} alignItems="center" sx={{ bgcolor: tones.amber.bg, color: tones.amber.fg, borderRadius: 2, px: 1.5, py: 1 }}>
              <ErrorOutlineRounded fontSize="small" />
              <Typography variant="body2" sx={{ color: "inherit" }}>Votre téléphone affiche un autre nom ? <b>Ne confirmez pas.</b></Typography>
            </Stack>
          </>
        )}
      </Card>

      {code && (
        <>
          <Typography variant="body2" textAlign="center" sx={{ fontWeight: 600 }}>ou</Typography>
          <Card>
            <Typography variant="caption" sx={{ fontWeight: 700, color: "primary.main" }}>2 · RETRAIT À NOTRE POINT</Typography>
            <Typography variant="body2">Depuis votre compte {op.nom}, composez :</Typography>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ bgcolor: "background.default", borderRadius: 3, px: 2, py: 1.25 }}>
              <Typography sx={{ fontFamily: "Roboto Mono, monospace", fontSize: 17, fontWeight: 600, overflowWrap: "anywhere", minWidth: 0 }}>{code}</Typography>
              <IconButton aria-label="Copier le code" onClick={() => void copier("code", code)} color={copie === "code" ? "primary" : "default"}>
                {copie === "code" ? <CheckCircleRounded /> : <ContentCopyRounded />}
              </IconButton>
            </Stack>
            {composer
              ? <Button variant="outlined" href={composer}>Composer le code</Button>
              : <Typography variant="caption">Remplacez MONTANT par le montant, en chiffres, sans espace.</Typography>}
          </Card>
        </>
      )}

      <Typography variant="body2" textAlign="center">
        Gardez le SMS de {op.nom.split(" ")[0]} : son <b>transaction ID</b> vous sera demandé.
      </Typography>
      </>}
      <Box sx={{ flex: 1 }} />
      <Stack gap={1}>
        {ferme && depot.declarations.length === 0 && <Button variant="contained" onClick={ailleurs}>Payer à un autre numéro</Button>}
        <Button variant={ferme ? "outlined" : "contained"} onClick={() => navigate(`/entrer/transaction/${depot.reference}`)}>J'ai payé</Button>
      </Stack>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Screen>
  );
}

/* ------------------------------------------------- 4 · j'ai payé */

/**
 * « J'ai payé » : un mini-formulaire PAR PAIEMENT — le transaction ID d'abord
 * (c'est lui qui retrouve le SMS), puis le numéro qui a payé, le nom exact et
 * le montant exact. Le numéro et le nom restent d'un paiement à l'autre ; un
 * paiement refusé pour un écart se corrige d'un toucher.
 */
export function EntrerTransaction() {
  const { ref } = useParams();
  const guichet = useGuichet();
  const navigate = useNavigate();
  const rafraichir = useRafraichir();
  const { data: depot, error: erreurDepot } = useDepot(ref);
  const { data: compte } = useCompte();
  const { data: numeros } = useNumeros();
  const [etat] = useParcours("entrer");
  const [tx, setTx] = useState("");
  const [numero, setNumero] = useState<string | null>(null);
  const [nom, setNom] = useState<string | null>(null);
  const [montant, setMontant] = useState<string | null>(null);
  const [correction, setCorrection] = useState<string | null>(null);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();
  const { lancer: lancerFin, enCours: finEnCours } = useGesteUnique();

  if (!depot) return <Attente erreur={erreurDepot} title="J'ai payé" back="/entrer/operateur" hauteur={200} />;
  const op = opDe(depot.operateur);

  /* ce qu'on sait déjà : un numéro vérifié de cet opérateur, sinon le téléphone du compte s'il est de cet opérateur ; le nom du compte ; le montant tapé avant */
  const telCompte = compte?.telephone ? numeroSaisi(compte.telephone) : "";
  const numeroConnu = numeros?.find((n) => n.operateur === depot.operateur && n.verifieLe && !n.retireLe)?.numero
    ?? (operateurDuNumero(telCompte) === depot.operateur ? telCompte : "");
  const vNumero = numero ?? numeroConnu;
  const vNom = nom ?? compte?.nom ?? "";
  const vMontant = montant ?? (depot.declarations.length === 0 && etat.operateur === depot.operateur && etat.montant > 0 ? String(etat.montant) : "");
  const montantNombre = Number(vMontant.replace(/\D/g, "")) || 0;
  const numeroOk = numeroValide(vNumero) && operateurDuNumero(vNumero) === depot.operateur;
  const pret = transactionIdNormalise(tx).length >= 6 && numeroOk && vNom.trim().length >= 2 && montantNombre > 0;

  const valider = () =>
    lancer(async () => {
      await guichet.declarerTransaction({ reference: depot.reference, transactionId: tx, numero: vNumero, montant: montantNombre, nom: vNom });
      setTx(""); setMontant(""); setCorrection(null);
      await rafraichir();
    });

  const corriger = (d: Declaration) => {
    setCorrection(d.transactionId);
    setTx(d.transactionId);
    setNumero(d.numeroDeclare ?? vNumero);
    setNom(d.nomDeclare ?? vNom);
    setMontant(d.montantDeclare ? String(d.montantDeclare) : "");
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  };

  const terminer = () =>
    lancerFin(async () => {
      await guichet.terminerDepot(depot.reference);
      navigate(`/entrer/credite/${depot.reference}`, { replace: true });
    });

  const credites = depot.declarations.filter((d) => d.etat === "credite");
  const enAttente = depot.declarations.filter((d) => d.etat === "attendu");

  return (
    <Screen title="J'ai payé" back={`/entrer/payer/${depot.reference}`} fermer="/" gap={1.5}>
      <Typography variant="body2">
        {correction ? `Corrigez ce paiement : le SMS de ${op.nom} reçu ne dit pas la même chose.` : `Recopiez le SMS de ${op.nom}. Un formulaire par paiement : si vous avez payé en trois fois, faites-le trois fois.`}
      </Typography>
      <Stack component="form" gap={1.5} onSubmit={(e) => { e.preventDefault(); if (pret) void valider(); }}>
        <TextField
          label="Transaction ID"
          value={tx}
          onChange={(e) => setTx(e.target.value)}
          disabled={Boolean(correction)}
          fullWidth
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
          helperText="Le numéro de l'opération, écrit dans le SMS."
          placeholder={depot.operateur === "mtn" ? "ex. 20394817104" : "ex. MP261012.1402.A12345"}
          slotProps={{ input: { sx: { fontFamily: "Roboto Mono, monospace", fontSize: 18 } } }}
        />
        <TextField
          label="Numéro qui a payé"
          value={numeroEnTranches(vNumero)}
          onChange={(e) => setNumero(numeroSaisi(e.target.value))}
          fullWidth
          inputMode="tel"
          autoComplete="tel-national"
          error={vNumero.length === 9 && !numeroOk}
          helperText={vNumero.length === 9 && !numeroOk ? `Un numéro ${op.nom}, neuf chiffres.` : "Le numéro d'où est parti l'argent."}
          slotProps={{ input: { startAdornment: <InputAdornment position="start">+237</InputAdornment> } }}
        />
        <TextField
          label="Nom exact du compte qui a payé"
          value={vNom}
          onChange={(e) => setNom(e.target.value)}
          fullWidth
          autoComplete="name"
          helperText="Tel qu'il apparaît chez l'opérateur."
        />
        <TextField
          label="Montant exact envoyé"
          value={vMontant ? xaf(montantNombre) : ""}
          onChange={(e) => setMontant(e.target.value.replace(/\D/g, "").slice(0, 10))}
          fullWidth
          inputMode="numeric"
          slotProps={{ input: { endAdornment: <InputAdornment position="end">XAF</InputAdornment> } }}
        />
        <Button type="submit" variant="contained" disabled={!pret || enCours} startIcon={correction ? undefined : <AddRounded />}>
          {enCours ? "Un instant…" : correction ? "Envoyer la correction" : "Valider ce paiement"}
        </Button>
        {correction && <Button variant="text" onClick={() => { setCorrection(null); setTx(""); }}>Annuler la correction</Button>}
      </Stack>

      {depot.declarations.length > 0 && (
        <Paper sx={{ p: 1, borderRadius: 6 }}>
          {depot.declarations.map((d) => (
            <LigneDeclaration key={d.id} d={d}
              onCorriger={d.etat === "refuse" && d.corrigible ? () => corriger(d) : undefined}
              onRetirer={d.etat === "attendu" ? () => void lancer(async () => {
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
          Dès que notre boîtier retrouve votre paiement, vos XAFe arrivent — en général en quelques secondes. Si le SMS n'est pas encore arrivé, votre déclaration attend et se crédite toute seule.
        </Typography>
      )}

      <Box sx={{ flex: 1 }} />
      <Button variant="outlined" disabled={credites.length === 0 || finEnCours} onClick={() => void terminer()}>
        {credites.length === 0 ? "Terminer" : enAttente.length > 0 ? `Terminer (${enAttente.length} en attente)` : "Terminer"}
      </Button>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Screen>
  );
}

/** Une déclaration ; celle qui attend se retire, celle qui ne concorde pas se corrige. */
function LigneDeclaration({ d, onRetirer, onCorriger }: { d: Declaration; onRetirer?: () => void; onCorriger?: () => void }) {
  const etat = d.etat === "credite"
    ? { icone: <CheckCircleRounded />, tone: "green" as const, texte: `+${xaf(d.montant ?? 0)} XAFe · ${heure(d.crediteLe ?? d.declareLe)}` }
    : d.etat === "refuse"
      ? { icone: <ErrorOutlineRounded />, tone: d.corrigible ? "amber" as const : "red" as const, texte: d.motif ?? "retenu" }
      : { icone: <HourglassTopRounded />, tone: "amber" as const, texte: "On cherche votre paiement… quelques instants." };
  return (
    <Stack direction="row" alignItems="center" gap={1.5} sx={{ px: 1.5, py: 1.25 }}>
      <Box sx={{ width: 44, height: 44, flexShrink: 0, borderRadius: 22, display: "grid", placeItems: "center", bgcolor: tones[etat.tone].bg, color: tones[etat.tone].fg }}>
        {d.etat === "attendu" ? <CircularProgress size={20} sx={{ color: "inherit" }} /> : etat.icone}
      </Box>
      <Stack sx={{ flex: 1, minWidth: 0 }}>
        <Typography fontWeight={500} sx={{ fontFamily: "Roboto Mono, monospace", fontSize: 15, overflowWrap: "anywhere" }}>{d.transactionId}</Typography>
        {d.montantDeclare != null && d.etat !== "credite" && (
          <Typography variant="caption">{xaf(d.montantDeclare)} XAF · {numeroEnTranches(d.numeroDeclare ?? "")}</Typography>
        )}
        <Typography variant="body2" sx={{ color: etat.tone === "red" ? "error.main" : undefined }}>{etat.texte}</Typography>
        {onRetirer && <Typography variant="caption">Mal recopié ? Touchez × pour le retirer.</Typography>}
      </Stack>
      {d.etat === "credite" && <Chip label="Crédité" size="small" sx={{ bgcolor: tones.green.bg, color: tones.green.fg, height: 26 }} />}
      {onCorriger && <Button size="small" variant="outlined" onClick={onCorriger}>Corriger</Button>}
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
