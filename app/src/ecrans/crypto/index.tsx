/*
 * Crypto : déposer des USDT (une adresse, la même à chaque fois) ; retirer des
 * USDT ou des XAFe vers un wallet externe : Réseau → Adresse → Montant →
 * Vérifier → Code → Envoyé. Mêmes règles que « Sortir des XAF ».
 */
import ArrowDownwardRounded from "@mui/icons-material/ArrowDownwardRounded";
import ArrowOutwardRounded from "@mui/icons-material/ArrowOutwardRounded";
import ArrowUpwardRounded from "@mui/icons-material/ArrowUpwardRounded";
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import ContentCopyRounded from "@mui/icons-material/ContentCopyRounded";
import ContentPasteRounded from "@mui/icons-material/ContentPasteRounded";
import LockRounded from "@mui/icons-material/LockRounded";
import { Box, Button, CircularProgress, Divider, Paper, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useAdresseDepot, useGuichet, useRetraitCrypto, useSoldes } from "../../guichet";
import type { Actif, Reseau } from "../../guichet/types";
import { arrondi2, CRYPTO, FRAIS_CRYPTO, RESEAUX } from "../../noyau/argent";
import { adresseCourte, enTranches, quand, xaf } from "../../noyau/format";
import { parcours, useParcours } from "../../navigation/parcours";
import { Attente, Card, FeuilleErreur, Keypad, Line, List, Points, Row, Screen, Success } from "../../ui";
import { useGesteUnique } from "../../ui/gestes";

const actifDe = (a: string | undefined): Actif => (a === "XAFe" ? "XAFe" : "USDT");
const fmt = (a: Actif, n: number) => (a === "USDT" ? enTranches(n, 2) : xaf(n));

export function Crypto() {
  return (
    <Screen title="Crypto" back="/">
      <List>
        <Row icon={<ArrowDownwardRounded />} tone="blue" primary="Déposer des USDT" secondary="BEP20 ou TRC20" to="/crypto/deposer/USDT" />
        <Row icon={<ArrowUpwardRounded />} tone="blue" primary="Retirer des USDT" secondary="Vers un wallet externe" to="/crypto/retirer/USDT/reseau" />
        <Row icon={<ArrowOutwardRounded />} tone="green" primary="Retirer des XAFe" secondary="Vers mon propre wallet, BEP20 ou TRC20" to="/crypto/retirer/XAFe/reseau" />
      </List>
    </Screen>
  );
}

/* ----------------------------------------------------------- déposer */

export function CryptoDeposer() {
  const { actif: a } = useParams();
  const actif = actifDe(a);
  const [reseau, setReseau] = useState<Reseau>("bep20");
  const { data: adresse, isLoading } = useAdresseDepot(actif, reseau);
  const [qr, setQr] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);

  useEffect(() => {
    if (!adresse) { setQr(null); return; }
    QRCode.toDataURL(adresse, { margin: 1, width: 336, color: { dark: "#191C1A", light: "#FFFFFF" } }).then(setQr).catch(() => setQr(null));
  }, [adresse]);

  const copier = async () => {
    if (!adresse) return;
    try { await navigator.clipboard.writeText(adresse); setCopie(true); setTimeout(() => setCopie(false), 1500); } catch { /* le presse-papiers peut être refusé */ }
  };
  const partager = async () => {
    if (!adresse) return;
    try { await navigator.share({ title: `Mon adresse ${actif} ${RESEAUX[reseau].nom}`, text: adresse }); } catch { await copier(); }
  };

  return (
    <Screen title={`Déposer des ${actif}`} back="/crypto">
      <ToggleButtonGroup value={reseau} exclusive fullWidth onChange={(_, v) => v && setReseau(v)}>
        <ToggleButton value="bep20">BEP20</ToggleButton>
        <ToggleButton value="trc20">TRC20</ToggleButton>
      </ToggleButtonGroup>
      <Card sx={{ alignItems: "center", gap: 2 }}>
        <Paper sx={{ p: 1.5, bgcolor: "background.default", borderRadius: 4, width: 192, height: 192, display: "grid", placeItems: "center" }}>
          {qr ? <img src={qr} alt={`Code QR de l'adresse ${actif} ${RESEAUX[reseau].nom}`} width={168} height={168} style={{ borderRadius: 8 }} /> : isLoading ? <CircularProgress /> : <Typography variant="body2" textAlign="center">Adresse en préparation</Typography>}
        </Paper>
        <Stack alignItems="center" gap={0.5} sx={{ width: "100%" }}>
          <Typography variant="caption">Votre adresse {actif} · {RESEAUX[reseau].nom}</Typography>
          <Typography sx={{ fontFamily: "Roboto Mono, monospace", fontSize: 14, wordBreak: "break-all", textAlign: "center" }}>
            {adresse ?? (isLoading ? "…" : "Elle vous sera attribuée dans quelques instants ; revenez ici.")}
          </Typography>
        </Stack>
        <Stack direction="row" gap={1} sx={{ width: "100%" }}>
          <Button variant="contained" startIcon={copie ? <CheckCircleRounded /> : <ContentCopyRounded />} fullWidth disabled={!adresse} onClick={() => void copier()}>{copie ? "Copiée" : "Copier"}</Button>
          <Button variant="outlined" fullWidth disabled={!adresse} onClick={() => void partager()}>Partager</Button>
        </Stack>
      </Card>
      <Typography variant="body2" textAlign="center">
        {actif} sur {RESEAUX[reseau].chaine} uniquement. Crédit automatique après {RESEAUX[reseau].confirmations} confirmations ; vous êtes prévenu. L'adresse est la même à chaque fois.
      </Typography>
      <Box sx={{ flex: 1 }} />
    </Screen>
  );
}

/* ----------------------------------------------------------- retirer */

export function CryptoRetirerReseau() {
  const { actif: a } = useParams();
  const actif = actifDe(a);
  const navigate = useNavigate();
  const [c, poser] = useParcours("crypto");
  useEffect(() => { if (c.actif !== actif) poser({ actif, adresse: "", montant: 0 }); }, [actif, c.actif, poser]);
  if (!CRYPTO.retraitsOuverts) {
    /* fermé par le moteur : on le dit AVANT l'adresse, le montant et le code, pas après */
    return (
      <Screen title={`Retirer des ${actif}`} back="/crypto">
        <Typography variant="body2">L'envoi vers un wallet externe n'est pas encore ouvert. Vos {actif} restent disponibles : vous pouvez les vendre au marché, ou sortir vos XAFe vers MoMo.</Typography>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" onClick={() => navigate("/marche")}>Aller au marché</Button>
      </Screen>
    );
  }
  return (
    <Screen title={`Retirer des ${actif}`} back="/crypto">
      <Typography variant="body2">Sur quel réseau ?</Typography>
      <List>
        {(Object.keys(RESEAUX) as Reseau[]).map((r) => (
          <Row key={r} icon={<Typography fontWeight={700} fontSize={13}>{RESEAUX[r].nom.slice(0, 3)}</Typography>} tone={r === "bep20" ? "amber" : "red"} primary={RESEAUX[r].nom} secondary={`${RESEAUX[r].chaine} · frais ${fmt(actif, FRAIS_CRYPTO[actif])} ${actif}`} selected={c.reseau === r} onClick={() => poser({ reseau: r })} />
        ))}
      </List>
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" onClick={() => navigate(`/crypto/retirer/${actif}/adresse`)}>Continuer</Button>
    </Screen>
  );
}

export function CryptoRetirerAdresse() {
  const { actif: a } = useParams();
  const actif = actifDe(a);
  const navigate = useNavigate();
  const [c, poser] = useParcours("crypto");
  const valide = RESEAUX[c.reseau].valide(c.adresse.trim());
  const coller = async () => {
    try { const t = await navigator.clipboard.readText(); poser({ adresse: t.trim() }); } catch { /* lecture refusée : on tape */ }
  };
  return (
    <Screen title="Adresse du wallet" back={`/crypto/retirer/${actif}/reseau`}>
      <Typography variant="body2">Une adresse {RESEAUX[c.reseau].nom} ({RESEAUX[c.reseau].chaine}). Vérifiez-la deux fois : un envoi sur une chaîne ne se rappelle pas.</Typography>
      <TextField
        label={`Adresse ${RESEAUX[c.reseau].nom}`}
        value={c.adresse}
        onChange={(e) => poser({ adresse: e.target.value })}
        fullWidth
        multiline
        minRows={2}
        autoComplete="off"
        error={c.adresse.length > 10 && !valide}
        helperText={c.adresse.length > 10 && !valide ? `Ce n'est pas une adresse ${RESEAUX[c.reseau].nom} valide.` : " "}
        slotProps={{ input: { sx: { fontFamily: "Roboto Mono, monospace", fontSize: 15 } } }}
      />
      <Button variant="outlined" startIcon={<ContentPasteRounded />} onClick={() => void coller()}>Coller</Button>
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" disabled={!valide} onClick={() => navigate(`/crypto/retirer/${actif}/montant`)}>Continuer</Button>
    </Screen>
  );
}

export function CryptoRetirerMontant() {
  const { actif: a } = useParams();
  const actif = actifDe(a);
  const navigate = useNavigate();
  const { data: soldes } = useSoldes();
  const [c, poser] = useParcours("crypto");
  const [saisie, setSaisie] = useState(c.montant ? String(c.montant) : "");
  const dispo = soldes ? soldes[actif].disponible : 0;
  const frais = FRAIS_CRYPTO[actif];
  const montant = Number(saisie.replace(",", ".")) || 0;
  /* « Tout » ne propose jamais plus que le solde : un plancher, pas un arrondi (un XAFe se retire en entier) */
  const maxi = Math.max(0, actif === "XAFe" ? Math.floor(dispo - frais + 1e-9) : Math.floor(arrondi2((dispo - frais) * 100) + 1e-9) / 100);
  const trop = montant + frais > dispo + 1e-9;
  const ok = montant > 0 && !trop && (actif === "XAFe" ? Number.isInteger(montant) : Math.round(montant * 100) === montant * 100);

  const touche = (k: string) => {
    if (k === "⌫") return setSaisie(saisie.slice(0, -1));
    if (k === ",") return setSaisie(saisie.includes(".") ? saisie : (saisie || "0") + ".");
    const suite = (saisie + k).replace(/^0+(?=\d)/, "");
    if (actif === "USDT" && /\.\d{3,}$/.test(suite)) return;
    if (suite.length <= 12) setSaisie(suite);
  };

  return (
    <Screen title={`Retirer des ${actif}`} back={`/crypto/retirer/${actif}/adresse`} gap={1.5}>
      <Box textAlign="center" py={3}>
        <Typography variant="h3" sx={{ fontSize: saisie.length > 9 ? 32 : 40 }}>
          {saisie ? saisie.replace(".", ",") : "0"} <Typography component="span" variant="h5" color="text.secondary">{actif}</Typography>
        </Typography>
        <Typography variant="body2" mt={0.5} sx={{ color: trop ? "error.main" : undefined }}>
          {soldes ? (trop ? `Disponible ${fmt(actif, dispo)} ${actif}, frais ${fmt(actif, frais)} compris` : `Disponible : ${fmt(actif, dispo)} ${actif} · frais ${fmt(actif, frais)} ${actif}`) : " "}
        </Typography>
      </Box>
      <Stack direction="row" gap={1} justifyContent="center">
        <Button size="small" variant="outlined" onClick={() => setSaisie(String(maxi))}>Tout ({fmt(actif, maxi)})</Button>
      </Stack>
      <Box sx={{ flex: 1 }} />
      <Keypad onKey={touche} triple={actif === "USDT" ? "," : "000"} />
      <Button variant="contained" disabled={!ok} onClick={() => { poser({ montant }); navigate(`/crypto/retirer/${actif}/verifier`); }}>Continuer</Button>
    </Screen>
  );
}

export function CryptoRetirerVerifier() {
  const { actif: a } = useParams();
  const actif = actifDe(a);
  const navigate = useNavigate();
  const [c] = useParcours("crypto");
  if (!c.montant || !c.adresse) return <Navigate to={`/crypto/retirer/${actif}/reseau`} replace />;
  const frais = FRAIS_CRYPTO[actif];
  return (
    <Screen title="Vérifiez" back={`/crypto/retirer/${actif}/montant`}>
      <Card>
        <Line label="Montant" value={`${fmt(actif, c.montant)} ${actif}`} />
        <Line label="Frais de réseau" value={`${fmt(actif, frais)} ${actif}`} />
        <Divider />
        <Line label="Débité" value={`${fmt(actif, c.montant + frais)} ${actif}`} strong />
        <Line label="Réseau" value={`${RESEAUX[c.reseau].nom} · ${RESEAUX[c.reseau].chaine}`} />
        <Line label="Vers" value={c.adresse} mono />
      </Card>
      <Typography variant="body2" textAlign="center">
        {actif === "XAFe" ? "Vos XAFe sont frappés sur la chaîne au départ, et détruits ici : la circulation ne change pas." : "Les USDT partent de la réserve de la plateforme ; le hash de la transaction apparaîtra dans le détail."}
      </Typography>
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" startIcon={<LockRounded />} onClick={() => navigate(`/crypto/retirer/${actif}/code`)}>Confirmer avec mon code</Button>
    </Screen>
  );
}

export function CryptoRetirerCode() {
  const { actif: a } = useParams();
  const actif = actifDe(a);
  const guichet = useGuichet();
  const navigate = useNavigate();
  const [c] = useParcours("crypto");
  const [code, setCode] = useState("");
  const [faux, setFaux] = useState<string | null>(null);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique("cr", { actif, reseau: c.reseau, adresse: c.adresse.trim(), montant: c.montant });
  if (!c.montant || !c.adresse) return <Navigate to={`/crypto/retirer/${actif}/reseau`} replace />;

  const envoyer = (k: string) =>
    lancer(async (cle) => {
      try {
        const r = await guichet.demanderRetraitCrypto({ actif, reseau: c.reseau, adresse: c.adresse.trim(), montant: c.montant, cle, codeSecret: k });
        /* le parcours s'efface à l'arrivée sur « Envoyé », jamais ici (l'écran repartirait au début) */
        navigate(`/crypto/envoye/${r.reference}`, { replace: true });
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (m.startsWith("code secret") || m.startsWith("compte verrouillé")) { setFaux(m.startsWith("compte") ? "Trois codes faux : le compte est verrouillé 15 minutes." : "Code incorrect."); setCode(""); return; }
        throw e;
      }
    });
  const touche = (k: string) => {
    setFaux(null);
    const suite = k === "⌫" ? code.slice(0, -1) : (code + k).slice(0, 4);
    setCode(suite);
    if (suite.length === 4) void envoyer(suite);
  };
  return (
    <Screen title="Votre code secret" back={`/crypto/retirer/${actif}/verifier`} gap={1.5}>
      <Typography variant="body2">Pour envoyer {fmt(actif, c.montant)} {actif} vers {adresseCourte(c.adresse)}.</Typography>
      <Points longueur={4} saisis={code.length} erreur={Boolean(faux)} />
      {faux && <Typography variant="body2" color="error" textAlign="center">{faux}</Typography>}
      {enCours && <Stack alignItems="center"><CircularProgress size={28} /></Stack>}
      <Box sx={{ flex: 1 }} />
      <Keypad onKey={touche} triple={null} />
      <FeuilleErreur erreur={erreur} onFermer={() => { effacerErreur(); setCode(""); }} />
    </Screen>
  );
}

export function CryptoEnvoye() {
  const { ref } = useParams();
  const { data: r, error } = useRetraitCrypto(ref);
  useEffect(() => { parcours.effacer("crypto"); }, []);
  if (!r) return <Attente erreur={error} />;
  if (r.etat === "envoye") {
    return (
      <Success title={`${r.actif} envoyés`} amount={`${fmt(r.actif, r.montant)} ${r.actif}`} caption={`Vers ${adresseCourte(r.adresse)} sur ${RESEAUX[r.reseau].chaine}, ${quand(r.creeLe)}.`} primary={{ label: "Retour à l'accueil", to: "/" }} secondary={{ label: "Voir le détail", to: `/historique/${r.reference}` }}>
        <Card>
          <Line label="Frais" value={`${fmt(r.actif, r.frais)} ${r.actif}`} />
          <Line label="Transaction" value={r.txHash ?? "—"} mono />
          <Line label="Référence" value={r.reference} mono />
        </Card>
      </Success>
    );
  }
  if (r.etat === "echoue") {
    return <Success tone="red" title="L'envoi n'est pas parti" amount={`${fmt(r.actif, r.montant + r.frais)} ${r.actif} revenus`} caption="La chaîne a refusé la transaction. Vos fonds sont de nouveau disponibles." primary={{ label: "Voir le détail", to: `/historique/${r.reference}` }} secondary={{ label: "Retour à l'accueil", to: "/" }} />;
  }
  return (
    <Screen>
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, textAlign: "center" }}>
        <CircularProgress size={64} thickness={3} />
        <Typography variant="h6">En cours</Typography>
        <Typography variant="h4" color="primary.main">{fmt(r.actif, r.montant)} {r.actif}</Typography>
        <Typography variant="body2">La transaction part sur {RESEAUX[r.reseau].chaine}. Cet écran bascule tout seul ; vous êtes prévenu quand c'est confirmé.</Typography>
      </Box>
      <Button variant="text" component={Link} to="/" replace>Retour à l'accueil</Button>
    </Screen>
  );
}
