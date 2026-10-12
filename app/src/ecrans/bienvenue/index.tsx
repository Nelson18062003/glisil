/*
 * Entrer dans l'application : numéro → code SMS → (nom + code secret) → Accueil.
 * Et le verrou, à chaque ouverture : le code secret, ou l'empreinte par la coque.
 */
import LockOutlined from "@mui/icons-material/LockOutlined";
import LogoutRounded from "@mui/icons-material/LogoutRounded";
import { Avatar, Box, Button, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGuichet } from "../../guichet";
import { CODE_SMS_DEMO } from "../../guichet/demo";
import { lisible } from "../../noyau/erreurs";
import { numeroEnTranches, numeroSaisi, numeroValide } from "../../noyau/format";
import { useSession } from "../../session/session";
import { Cases, FeuilleErreur, Keypad, Points, Screen } from "../../ui";
import { useGesteUnique } from "../../ui/gestes";

const CLE_TEL = "xafe.bienvenue.telephone";
const lireTel = () => { try { return sessionStorage.getItem(CLE_TEL) ?? ""; } catch { return ""; } };
const garderTel = (t: string) => { try { sessionStorage.setItem(CLE_TEL, t); } catch { /* sans stockage, on redemande le numéro */ } };

export function Bienvenue() {
  const guichet = useGuichet();
  const navigate = useNavigate();
  const [tel, setTel] = useState(lireTel);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();

  const continuer = () =>
    lancer(async () => {
      const n = numeroSaisi(tel);
      await guichet.demanderCode(n);
      garderTel(n);
      navigate("/bienvenue/code");
    });

  return (
    <Screen>
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 4 }}>
        <Stack alignItems="center" gap={2}>
          <Avatar sx={{ width: 80, height: 80, bgcolor: "primary.main", fontSize: 36, fontWeight: 700 }}>X</Avatar>
          <Typography variant="h5">XAFe Exchange</Typography>
          <Typography variant="body2" textAlign="center">Vos XAF, sur la blockchain.</Typography>
        </Stack>
        <form onSubmit={(e) => { e.preventDefault(); if (numeroValide(tel)) void continuer(); }}>
          <TextField
            label="Numéro de téléphone"
            value={numeroEnTranches(tel)}
            onChange={(e) => setTel(numeroSaisi(e.target.value))}
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            fullWidth
            autoFocus
            slotProps={{ input: { startAdornment: <Typography sx={{ mr: 1, color: "text.secondary" }}>+237</Typography>, sx: { fontSize: 22, fontVariantNumeric: "tabular-nums" } } }}
            helperText={guichet.mode === "demo" ? `Démonstration : le code SMS sera ${CODE_SMS_DEMO}. Le 6 77 12 34 56 arrive avec une vie déjà écrite.` : "Un code à six chiffres vous sera envoyé par SMS."}
          />
        </form>
      </Box>
      <Stack gap={1}>
        <Button variant="contained" disabled={!numeroValide(tel) || enCours} onClick={() => void continuer()}>
          {enCours ? "Envoi du code…" : "Continuer"}
        </Button>
        <Typography variant="caption" textAlign="center">
          Pas encore de compte ? Il se crée avec ce numéro, tout de suite.
        </Typography>
      </Stack>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} onRecommencer={() => void continuer()} />
    </Screen>
  );
}

export function BienvenueCode() {
  const guichet = useGuichet();
  const session = useSession();
  const navigate = useNavigate();
  const tel = lireTel();
  const [code, setCode] = useState("");
  const [faux, setFaux] = useState(false);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();

  useEffect(() => { if (!tel) navigate("/bienvenue", { replace: true }); }, [tel, navigate]);

  const valider = (c: string) =>
    lancer(async () => {
      try {
        const { nouveau } = await session.connecter(tel, c);
        navigate(nouveau ? "/bienvenue/profil" : "/", { replace: true });
      } catch (e) {
        setFaux(true);
        setCode("");
        throw e;
      }
    });

  const touche = (k: string) => {
    setFaux(false);
    const suite = k === "⌫" ? code.slice(0, -1) : (code + k).slice(0, 6);
    setCode(suite);
    if (suite.length === 6) void valider(suite);
  };

  return (
    <Screen title="Code reçu par SMS" back="/bienvenue" gap={1.5}>
      <Typography variant="body2">Envoyé au {numeroEnTranches(tel)}.</Typography>
      <Cases longueur={6} valeur={code} erreur={faux} />
      {faux && <Typography variant="body2" color="error" textAlign="center">Ce code n'est pas le bon. Réessayez.</Typography>}
      <Button variant="text" size="small" onClick={() => void guichet.demanderCode(tel)}>Renvoyer le code</Button>
      <Box sx={{ flex: 1 }} />
      <Keypad onKey={touche} triple={null} />
      <Button variant="contained" disabled={code.length < 6 || enCours} onClick={() => void valider(code)}>
        {enCours ? "Vérification…" : "Valider"}
      </Button>
      <FeuilleErreur erreur={erreur && !faux ? erreur : null} onFermer={effacerErreur} />
    </Screen>
  );
}

export function BienvenueProfil() {
  const guichet = useGuichet();
  const session = useSession();
  const navigate = useNavigate();
  const [nom, setNom] = useState(session.compte?.nom ?? "");
  const [etape, setEtape] = useState<"nom" | "code" | "confirmer">("nom");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [faux, setFaux] = useState(false);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();

  const terminer = (c: string) =>
    lancer(async () => {
      const compte = await guichet.completerProfil({ nom, codeSecret: c });
      session.profilComplete(compte);
      navigate("/", { replace: true });
    });

  const touche = (k: string) => {
    setFaux(false);
    if (etape === "code") {
      const suite = k === "⌫" ? code.slice(0, -1) : (code + k).slice(0, 4);
      setCode(suite);
      if (suite.length === 4) setTimeout(() => setEtape("confirmer"), 150);
    } else {
      const suite = k === "⌫" ? confirmation.slice(0, -1) : (confirmation + k).slice(0, 4);
      setConfirmation(suite);
      if (suite.length === 4) {
        if (suite === code) void terminer(suite);
        else { setFaux(true); setTimeout(() => { setConfirmation(""); setCode(""); setEtape("code"); setFaux(false); }, 900); }
      }
    }
  };

  if (etape === "nom") {
    return (
      <Screen title="Votre nom">
        <Typography variant="body2">Celui qui apparaît sur vos reçus.</Typography>
        <TextField label="Nom et prénom" value={nom} onChange={(e) => setNom(e.target.value)} fullWidth autoFocus autoComplete="name" />
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" disabled={nom.trim().length < 2} onClick={() => setEtape("code")}>Continuer</Button>
      </Screen>
    );
  }

  return (
    <Screen title={etape === "code" ? "Choisissez un code secret" : "Confirmez le code"} onBack={() => (etape === "code" ? setEtape("nom") : (setEtape("code"), setConfirmation("")))} gap={1.5}>
      <Typography variant="body2">
        {etape === "code" ? "Quatre chiffres. Il protège chaque sortie d'argent et l'ouverture de l'application." : "Tapez-le une seconde fois."}
      </Typography>
      <Points longueur={4} saisis={etape === "code" ? code.length : confirmation.length} erreur={faux} />
      {faux && <Typography variant="body2" color="error" textAlign="center">Les deux codes ne sont pas les mêmes. On recommence.</Typography>}
      <Box sx={{ flex: 1 }} />
      <Keypad onKey={touche} triple={null} />
      {enCours && <Typography variant="body2" textAlign="center">Enregistrement…</Typography>}
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Screen>
  );
}

/** Le verrou : par-dessus l'écran courant ; après le code, on revient exactement où l'on était. */
export function Verrouillage() {
  const session = useSession();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [faux, setFaux] = useState(false);
  const { lancer, enCours } = useGesteUnique();

  const essayer = (c: string) =>
    lancer(async () => {
      const r = await session.deverrouiller(c);
      if (!r.ok) {
        setFaux(true);
        setCode("");
        if (r.verrouJusqua) setMessage(`Trois codes faux : le compte est verrouillé jusqu'à ${new Date(r.verrouJusqua).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.`);
        else setMessage(`Code incorrect. ${r.essaisRestants ?? ""} essai${(r.essaisRestants ?? 0) > 1 ? "s" : ""} avant verrouillage.`);
      }
    }).catch((e) => setMessage(lisible(e).titre));

  const touche = (k: string) => {
    setFaux(false);
    const suite = k === "⌫" ? code.slice(0, -1) : (code + k).slice(0, 4);
    setCode(suite);
    if (suite.length === 4) void essayer(suite);
  };

  return (
    <Screen>
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 1 }}>
        <Avatar sx={{ width: 72, height: 72, bgcolor: "#CDEFD9", color: "primary.main" }}><LockOutlined sx={{ fontSize: 36 }} /></Avatar>
        <Typography variant="h6" mt={1}>Bonjour {session.compte?.nom?.split(" ")[0] ?? ""}</Typography>
        <Typography variant="body2">Votre code secret pour continuer.</Typography>
        <Points longueur={4} saisis={code.length} erreur={faux} />
        {message && <Typography variant="body2" color="error" textAlign="center">{message}</Typography>}
        {enCours && <Typography variant="body2">Vérification…</Typography>}
      </Box>
      <Keypad onKey={touche} triple={null} />
      <Button variant="text" color="inherit" startIcon={<LogoutRounded />} onClick={() => void session.deconnecter()} sx={{ color: "text.secondary" }}>
        Changer de compte
      </Button>
    </Screen>
  );
}
