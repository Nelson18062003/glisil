/*
 * Le mot de passe :
 *   ChoisirMotDePasse   un compte Google n'en a pas : il en choisit un, qui
 *                       protège chaque sortie d'argent ;
 *   Oubli → code → nouveau
 *                       « mot de passe oublié » : un code par e-mail ouvre une
 *                       session de récupération, qui demande encore le code de
 *                       l'application (ou un code de secours), puis le
 *                       nouveau mot de passe ; toutes les sessions se ferment,
 *                       et l'on entre de nouveau avec lui.
 * Le mot de passe ne s'écrit jamais nulle part : il vit dans l'état de l'écran.
 */
import KeyRounded from "@mui/icons-material/KeyRounded";
import LockResetRounded from "@mui/icons-material/LockResetRounded";
import { Avatar, Box, Button, Stack, TextField, Typography } from "@mui/material";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGuichet } from "../../guichet";
import { CODE_DEMO } from "../../guichet/demo";
import { lisible } from "../../noyau/erreurs";
import { emailNormalise, emailValide } from "../../noyau/identite";
import { t } from "../../noyau/langue";
import { motDePasseValide } from "../../noyau/motDePasse";
import { useSession } from "../../session/session";
import { tones } from "../../theme";
import { FeuilleErreur, Screen } from "../../ui";
import { ChampCode, ChampMotDePasse, RegleDuMotDePasse } from "../../ui/entree";
import { useGesteUnique } from "../../ui/gestes";
import { garderEmail, lireEmail, LONGUEUR_CODE, useMinuterie } from ".";

/** Deux fois le même mot de passe, qui suit la règle d'Auth. */
export function NouveauMotDePasse({ valeur, onChange, confirmation, onConfirmation }: { valeur: string; onChange: (v: string) => void; confirmation: string; onConfirmation: (v: string) => void }) {
  const differents = confirmation.length > 0 && confirmation !== valeur;
  return (
    <>
      <ChampMotDePasse label={t("Nouveau mot de passe", "New password")} valeur={valeur} onChange={onChange} nouveau autoFocus aide=" " />
      <RegleDuMotDePasse valeur={valeur} />
      <ChampMotDePasse label={t("Le même, une seconde fois", "The same, a second time")} valeur={confirmation} onChange={onConfirmation} nouveau erreur={differents}
        aide={differents ? t("Les deux mots de passe ne sont pas les mêmes.", "The two passwords don't match.") : " "} />
    </>
  );
}
export const nouveauPret = (mdp: string, confirmation: string) => motDePasseValide(mdp) && mdp === confirmation;

/** Un compte Google choisit son mot de passe : il sera demandé avant chaque sortie d'argent. */
export function ChoisirMotDePasse() {
  const guichet = useGuichet();
  const session = useSession();
  const [mdp, setMdp] = useState("");
  const [conf, setConf] = useState("");
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();
  const choisir = () => lancer(async () => { await guichet.choisirMotDePasse(mdp); setMdp(""); setConf(""); await session.avancer(); });
  return (
    <Screen onBack={() => void session.deconnecter()} gap={2.5}>
      <Avatar sx={{ width: 64, height: 64, bgcolor: tones.green.bg, color: "primary.main" }}><KeyRounded sx={{ fontSize: 32 }} /></Avatar>
      <Stack gap={0.75}>
        <Typography variant="h5">{t("Choisissez un mot de passe", "Choose a password")}</Typography>
        <Typography variant="body2">{t("Il sera demandé avant chaque sortie d'argent, en plus du code de votre application. Google seul ne suffit pas pour faire sortir l'argent.", "It will be required before every withdrawal, together with the code from your app. Google alone isn't enough to move money out.")}</Typography>
      </Stack>
      <Box component="form" onSubmit={(e) => { e.preventDefault(); if (nouveauPret(mdp, conf)) void choisir(); }} sx={{ display: "flex", flexDirection: "column", gap: 2.5, flex: 1 }}>
        <NouveauMotDePasse valeur={mdp} onChange={setMdp} confirmation={conf} onConfirmation={setConf} />
        <Box sx={{ flex: 1 }} />
        <Button type="submit" variant="contained" disabled={!nouveauPret(mdp, conf) || enCours}>{enCours ? t("Enregistrement…", "Saving…") : t("Continuer", "Continue")}</Button>
      </Box>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Screen>
  );
}

/** Mot de passe oublié : l'adresse, et un code part. */
export function Oubli() {
  const guichet = useGuichet();
  const session = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState(lireEmail);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();
  const envoyer = () => lancer(async () => {
    const e = emailNormalise(email);
    await guichet.motDePasseOublie(e);
    garderEmail(e);
    try { sessionStorage.setItem("glisil.oubli.envoye", String(Date.now())); } catch { /* sans stockage, on attend la minute entière */ }
    session.commencerRecuperation();
    navigate("/bienvenue/oubli/code");
  });
  return (
    <Screen back="/bienvenue" gap={2.5}>
      <Avatar sx={{ width: 64, height: 64, bgcolor: tones.amber.bg, color: tones.amber.fg }}><LockResetRounded sx={{ fontSize: 32 }} /></Avatar>
      <Stack gap={0.75}>
        <Typography variant="h5">{t("Mot de passe oublié", "Forgot password")}</Typography>
        <Typography variant="body2">{t("Nous envoyons un code à six chiffres à votre adresse. Il faudra ensuite le code de votre application d'authentification, ou un code de secours.", "We'll send a six-digit code to your address. You'll then need the code from your authenticator app, or a recovery code.")}</Typography>
      </Stack>
      <Box component="form" onSubmit={(e) => { e.preventDefault(); if (emailValide(email)) void envoyer(); }} sx={{ display: "flex", flexDirection: "column", gap: 2.5, flex: 1 }}>
        <TextField label={t("Adresse e-mail", "Email address")} value={email} onChange={(e) => setEmail(e.target.value.replace(/\s/g, ""))} type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} fullWidth autoFocus
          slotProps={{ input: { sx: { fontSize: 18 } } }} />
        <Box sx={{ flex: 1 }} />
        <Button type="submit" variant="contained" disabled={!emailValide(email) || enCours}>{enCours ? t("Envoi du code…", "Sending code…") : t("Recevoir un code", "Get a code")}</Button>
      </Box>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Screen>
  );
}

const resteOubli = () => {
  try { const envoye = Number(sessionStorage.getItem("glisil.oubli.envoye") ?? 0); return Math.max(0, 60 - Math.floor((Date.now() - envoye) / 1000)); } catch { return 60; }
};

/** Le code de réinitialisation : il ouvre la session de récupération. */
export function OubliCode() {
  const guichet = useGuichet();
  const session = useSession();
  const navigate = useNavigate();
  const email = lireEmail();
  const [code, setCode] = useState("");
  const [faux, setFaux] = useState(false);
  const [reste, setReste] = useMinuterie(resteOubli());
  const champ = useRef<HTMLInputElement>(null);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();

  const valider = (c: string) => lancer(async () => {
    try {
      session.commencerRecuperation();
      await guichet.verifierCodeDeReinitialisation({ email, code: c });
      await session.avancer();
    } catch (e) {
      setFaux(true); setCode(""); champ.current?.focus();
      if (lisible(e).titre !== t("Ce code ne marche pas", "This code doesn't work")) throw e;
    }
  });
  const renvoyer = () => lancer(async () => {
    await guichet.motDePasseOublie(email);
    try { sessionStorage.setItem("glisil.oubli.envoye", String(Date.now())); } catch { /* idem */ }
    setReste(60); setFaux(false);
  });
  const abandonner = () => { session.finirRecuperation(); navigate("/bienvenue", { replace: true }); };

  return (
    <Screen onBack={abandonner} gap={2.5}>
      <Stack gap={0.75}>
        <Typography variant="h5">{t("Le code reçu par e-mail", "The code we emailed you")}</Typography>
        <Typography variant="body1">{t("Si un compte existe pour ", "If an account exists for ")}<Box component="b" sx={{ overflowWrap: "anywhere" }}>{email || "…"}</Box>{t(", un code à six chiffres vient d'y partir.", ", a six-digit code has just been sent there.")}</Typography>
      </Stack>
      <ChampCode ref={champ} valeur={code} onChange={(c) => { setFaux(false); setCode(c); if (c.length === LONGUEUR_CODE) void valider(c); }} label={t("Code reçu par e-mail", "Code received by email")} autoFocus erreur={faux} disabled={enCours || !email}
        aide={faux ? t("Ce code n'est pas le bon, ou il a expiré.", "This code is wrong or has expired.") : guichet.mode === "demo" ? t(`Démonstration : le code est ${CODE_DEMO}.`, `Demo: the code is ${CODE_DEMO}.`) : t("Regardez aussi vos courriers indésirables.", "Check your spam folder too.")} />
      <Button variant="text" size="small" sx={{ alignSelf: "flex-start" }} disabled={reste > 0 || enCours || !email} onClick={() => void renvoyer()}>
        {reste > 0 ? t(`Renvoyer le code dans ${reste} s`, `Resend code in ${reste}s`) : t("Renvoyer le code", "Resend code")}
      </Button>
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" disabled={code.length < LONGUEUR_CODE || enCours} onClick={() => void valider(code)}>{enCours ? t("Vérification…", "Verifying…") : t("Valider", "Confirm")}</Button>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Screen>
  );
}

/** Le nouveau mot de passe ; ensuite toutes les sessions se ferment, et l'on entre avec lui. */
export function OubliNouveau() {
  const guichet = useGuichet();
  const session = useSession();
  const navigate = useNavigate();
  const [mdp, setMdp] = useState("");
  const [conf, setConf] = useState("");
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();
  const changer = () => lancer(async () => {
    await guichet.nouveauMotDePasse(mdp);
    setMdp(""); setConf("");
    session.finirRecuperation();
    session.poserAnnonce("mot_de_passe_change");
    await session.avancer();
    navigate("/bienvenue", { replace: true, state: { onglet: "entrer" } });
  });
  return (
    <Screen onBack={() => void session.deconnecter()} gap={2.5}>
      <Stack gap={0.75}>
        <Typography variant="h5">{t("Votre nouveau mot de passe", "Your new password")}</Typography>
        <Typography variant="body2">{t("Toutes vos sessions se fermeront, sur tous vos appareils : vous entrerez de nouveau avec ce mot de passe.", "All your sessions will close, on every device: you'll sign in again with this password.")}</Typography>
      </Stack>
      <Box component="form" onSubmit={(e) => { e.preventDefault(); if (nouveauPret(mdp, conf)) void changer(); }} sx={{ display: "flex", flexDirection: "column", gap: 2.5, flex: 1 }}>
        <NouveauMotDePasse valeur={mdp} onChange={setMdp} confirmation={conf} onConfirmation={setConf} />
        <Box sx={{ flex: 1 }} />
        <Button type="submit" variant="contained" disabled={!nouveauPret(mdp, conf) || enCours}>{enCours ? t("Enregistrement…", "Saving…") : t("Changer le mot de passe", "Change password")}</Button>
      </Box>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Screen>
  );
}

