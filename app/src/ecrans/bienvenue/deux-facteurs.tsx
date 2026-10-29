/*
 * L'application d'authentification (TOTP), obligatoire pour tout le monde :
 *   DeuxFacteurs       l'enrôler, sur UN écran en trois blocs — l'installer ;
 *                      l'ouvrir d'un bouton (otpauth:// ouvre l'application
 *                      sur Android comme sur iPhone), ou copier la clé, ou
 *                      scanner le code depuis un ordinateur ; taper les six
 *                      chiffres qu'elle affiche ;
 *   DeuxFacteursCode   à chaque connexion (et dans « mot de passe oublié ») ;
 *   Secours            téléphone perdu : un code de secours retire
 *                      l'application ; on en enrôle une nouvelle.
 * Sans elle, la base n'ouvre rien (aal2, 0035).
 */
import ContentCopyRounded from "@mui/icons-material/ContentCopyRounded";
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded";
import LaunchRounded from "@mui/icons-material/LaunchRounded";
import PhonelinkLockRounded from "@mui/icons-material/PhonelinkLockRounded";
import QrCode2Rounded from "@mui/icons-material/QrCode2Rounded";
import { Accordion, AccordionDetails, AccordionSummary, Avatar, Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from "@mui/material";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useGuichet } from "../../guichet";
import { CODE_TOTP_DEMO } from "../../guichet/demo";
import type { EnrolementTotp } from "../../guichet/types";
import { codeDeSecoursNormalise } from "../../noyau/codesDeSecours";
import { ErreurMoteur } from "../../noyau/erreurs";
import { t } from "../../noyau/langue";
import { useSession } from "../../session/session";
import { tones } from "../../theme";
import { FeuilleErreur, Screen, useFenetre } from "../../ui";
import { ChampCode, Etape } from "../../ui/entree";
import { Actions, Champs } from "../../ui/formulaire";
import { useGesteUnique } from "../../ui/gestes";

/** « JBSWY3DPEHPK3PXP » → « JBSW Y3DP EHPK 3PXP » : une clé se recopie par paquets de quatre. */
export const cleParQuatre = (cle: string) => cle.replace(/\s/g, "").replace(/(.{4})/g, "$1 ").trim();

/** Le code que l'application doit afficher : les trois blocs de l'enrôlement, réutilisés pour « changer de téléphone ». */
export function BlocEnrolement({ enrolement, code, onCode, erreurCode, enCours }: {
  enrolement: EnrolementTotp | null; code: string; onCode: (c: string) => void; erreurCode?: boolean; enCours?: boolean;
}) {
  const guichet = useGuichet();
  const fenetre = useFenetre();
  const [qr, setQr] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);
  useEffect(() => {
    if (!enrolement?.uri) return;
    QRCode.toDataURL(enrolement.uri, { margin: 1, width: 240, color: { dark: "#191C1A", light: "#FFFFFF" } }).then(setQr).catch(() => setQr(enrolement.qr || null));
  }, [enrolement?.uri, enrolement?.qr]);
  const copier = async () => {
    if (!enrolement) return;
    try { await navigator.clipboard.writeText(enrolement.secret); setCopie(true); setTimeout(() => setCopie(false), 2500); } catch { /* la clé reste lisible à l'écran */ }
  };
  const image = qr ? <Box component="img" src={qr} alt={t("Code QR de la clé", "QR code of the key")} sx={{ width: 200, height: 200, display: "block", mx: "auto", borderRadius: 2 }} /> : <CircularProgress sx={{ display: "block", mx: "auto" }} />;

  return (
    <Stack gap={3}>
      <Etape numero={1} titre={t("Installez une application d'authentification", "Install an authenticator app")}>
        <Typography variant="body2">{t("Google Authenticator ou Microsoft Authenticator, gratuites sur le Play Store et l'App Store. Elle affiche un code qui change toutes les trente secondes.", "Google Authenticator or Microsoft Authenticator, free on the Play Store and App Store. It shows a code that changes every thirty seconds.")}</Typography>
      </Etape>
      <Etape numero={2} titre={t("Ajoutez Glisil dans l'application", "Add Glisil to the app")}>
        {!enrolement ? <CircularProgress size={28} /> : (
          <Stack gap={1.5}>
            <Button component="a" href={enrolement.uri} variant="contained" startIcon={<LaunchRounded />} sx={{ alignSelf: "stretch" }}>
              {t("Ouvrir mon application d'authentification", "Open my authenticator app")}
            </Button>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 4, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="caption" component="div">{t("Ou recopiez cette clé dans l'application", "Or type this key into the app")}</Typography>
                <Typography data-cle-totp sx={{ fontFamily: "Roboto Mono, monospace", fontSize: 17, fontWeight: 600, letterSpacing: "0.04em", wordBreak: "break-all" }}>{cleParQuatre(enrolement.secret)}</Typography>
              </Box>
              <Button size="small" variant="outlined" startIcon={<ContentCopyRounded />} onClick={() => void copier()}>{copie ? t("Copiée", "Copied") : t("Copier la clé", "Copy key")}</Button>
            </Paper>
            {fenetre === "compacte" ? (
              <Accordion disableGutters sx={{ bgcolor: "background.paper", "&:before": { display: "none" }, borderRadius: "16px !important", overflow: "hidden" }}>
                <AccordionSummary expandIcon={<ExpandMoreRounded />}>
                  <Stack direction="row" gap={1} alignItems="center"><QrCode2Rounded fontSize="small" /><Typography variant="body2" sx={{ color: "text.primary" }}>{t("Sur un ordinateur ? Scannez ce code", "On a computer? Scan this code")}</Typography></Stack>
                </AccordionSummary>
                <AccordionDetails>{image}</AccordionDetails>
              </Accordion>
            ) : (
              <Stack alignItems="center" gap={1}>
                <Typography variant="body2">{t("Sur un ordinateur : scannez ce code avec votre téléphone.", "On a computer: scan this code with your phone.")}</Typography>
                {image}
              </Stack>
            )}
          </Stack>
        )}
      </Etape>
      <Etape numero={3} titre={t("Entrez les six chiffres affichés", "Enter the six digits shown")}>
        <ChampCode valeur={code} onChange={onCode} label={t("Code de l'application d'authentification", "Authenticator app code")} erreur={erreurCode} disabled={!enrolement || enCours}
          aide={erreurCode ? t("Ce code ne marche pas : tapez celui affiché maintenant.", "This code doesn't work: enter the one shown right now.") : guichet.mode === "demo" ? t(`Démonstration : l'application affiche ${CODE_TOTP_DEMO}.`, `Demo: the app shows ${CODE_TOTP_DEMO}.`) : undefined} />
      </Etape>
    </Stack>
  );
}

/** Le refus d'un code de l'application : sur le champ, pas dans une feuille. */
const codeRefuse = (e: unknown) => e instanceof Error && /^code de l'application/.test(e.message);

/** L'enrôlement, à la première connexion (ou après un code de secours). */
export function DeuxFacteurs() {
  const guichet = useGuichet();
  const session = useSession();
  const [enrolement, setEnrolement] = useState<EnrolementTotp | null>(null);
  const [code, setCode] = useState("");
  const [faux, setFaux] = useState(false);
  const demande = useRef(false);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();

  const enroler = () => lancer(async () => { setEnrolement(await guichet.enrolerDeuxFacteurs()); });
  useEffect(() => { if (demande.current) return; demande.current = true; void enroler(); }, []);

  const confirmer = (c: string) => lancer(async () => {
    try { await guichet.confirmerDeuxFacteurs({ facteurId: enrolement!.facteurId, code: c }); await session.avancer(); }
    catch (e) { if (codeRefuse(e)) { setFaux(true); setCode(""); return; } throw e; }
  });

  return (
    <Screen onBack={() => void session.deconnecter()} gap={3}>
      <Avatar sx={{ width: 64, height: 64, bgcolor: tones.green.bg, color: "primary.main" }}><PhonelinkLockRounded sx={{ fontSize: 32 }} /></Avatar>
      <Stack data-en-tete gap={1}>
        <Typography variant="h5">{t("Protégez votre compte", "Protect your account")}</Typography>
        <Typography variant="body2">{t("Votre téléphone devient la seconde clé de Glisil : à chaque connexion et avant chaque sortie d'argent, il donne un code que vous seul avez.", "Your phone becomes Glisil's second key: every time you sign in and before every withdrawal, it gives a code only you have.")}</Typography>
      </Stack>
      <Champs sx={{ flex: 1 }}>
        <BlocEnrolement enrolement={enrolement} code={code} enCours={enCours} erreurCode={faux}
          onCode={(c) => { setFaux(false); setCode(c); if (c.length === 6 && enrolement) void confirmer(c); }} />
        <Button variant="contained" sx={{ mt: "auto" }} disabled={!enrolement || code.length < 6 || enCours} onClick={() => void confirmer(code)}>{enCours ? t("Vérification…", "Verifying…") : t("Activer", "Turn on")}</Button>
      </Champs>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} onRecommencer={enrolement ? undefined : () => void enroler()} />
    </Screen>
  );
}

/** Le code de l'application, à chaque connexion — et dans « mot de passe oublié ». */
export function DeuxFacteursCode() {
  const guichet = useGuichet();
  const session = useSession();
  const recuperation = session.etat.phase === "recuperation";
  const [code, setCode] = useState("");
  const [faux, setFaux] = useState(false);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();
  const verifier = (c: string) => lancer(async () => {
    try { await guichet.verifierDeuxFacteurs(c); await session.avancer(); }
    catch (e) { if (codeRefuse(e)) { setFaux(true); setCode(""); return; } throw e; }
  });
  return (
    <Screen onBack={() => void session.deconnecter()} gap={3}>
      <Avatar sx={{ width: 64, height: 64, bgcolor: tones.green.bg, color: "primary.main" }}><PhonelinkLockRounded sx={{ fontSize: 32 }} /></Avatar>
      <Stack data-en-tete gap={1}>
        <Typography variant="h5">{recuperation ? t("Prouvez que c'est vous", "Prove it's you") : t("Le code de votre application", "The code from your app")}</Typography>
        <Typography variant="body2">{t("Ouvrez votre application d'authentification et tapez les six chiffres affichés pour Glisil.", "Open your authenticator app and enter the six digits shown for Glisil.")}</Typography>
      </Stack>
      <Champs sx={{ flex: 1 }}>
      <ChampCode valeur={code} onChange={(c) => { setFaux(false); setCode(c); if (c.length === 6) void verifier(c); }} label={t("Code de l'application d'authentification", "Authenticator app code")} autoFocus erreur={faux} disabled={enCours}
        aide={faux ? t("Ce code ne marche pas : tapez celui affiché maintenant. L'heure du téléphone doit être juste.", "This code doesn't work: enter the one shown right now. Your phone's clock must be correct.") : guichet.mode === "demo" ? t(`Démonstration : l'application affiche ${CODE_TOTP_DEMO}.`, `Demo: the app shows ${CODE_TOTP_DEMO}.`) : undefined} />
      <Button component={Link} to="/bienvenue/secours" variant="text" sx={{ alignSelf: "flex-start" }}>{t("J'ai perdu mon téléphone", "I lost my phone")}</Button>
      <Actions sx={{ mt: "auto" }}>
        <Button variant="contained" disabled={code.length < 6 || enCours} onClick={() => void verifier(code)}>{enCours ? t("Vérification…", "Verifying…") : t("Continuer", "Continue")}</Button>
        <Button variant="text" color="inherit" sx={{ color: "text.secondary" }} onClick={() => void session.deconnecter()}>{t("Changer de compte", "Switch account")}</Button>
      </Actions>
      </Champs>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Screen>
  );
}

/** Téléphone perdu : un code de secours (minuscules, espaces et tirets acceptés) retire l'application. */
export function Secours() {
  const guichet = useGuichet();
  const session = useSession();
  const [code, setCode] = useState("");
  const [refus, setRefus] = useState<string | null>(null);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();
  const valide = codeDeSecoursNormalise(code) !== null;
  const utiliser = () => lancer(async () => {
    try { await guichet.utiliserCodeDeSecours(code); setCode(""); await session.avancer(); }
    catch (e) {
      if (e instanceof ErreurMoteur && (e.message.startsWith("code de secours incorrect") || e.message.startsWith("trop d'essais"))) { // langue-ok (phrases du moteur comparées)
        const d = e.donnees;
        setRefus(d?.verrouJusqua
          ? t(`Trop d'essais : réessayez après ${new Date(d.verrouJusqua).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.`, `Too many attempts: try again after ${new Date(d.verrouJusqua).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.`)
          : t(`Ce code ne marche pas. ${d?.essaisRestants ?? ""} essai(s) avant un blocage d'un quart d'heure.`, `This code doesn't work. ${d?.essaisRestants ?? ""} attempt(s) left before a fifteen-minute block.`));
        return;
      }
      throw e;
    }
  });
  return (
    <Screen back="/bienvenue/deux-facteurs/code" gap={3}>
      <Stack data-en-tete gap={1}>
        <Typography variant="h5">{t("Un code de secours", "A recovery code")}</Typography>
        <Typography variant="body2">{t("Tapez l'un des dix codes notés quand vous avez activé l'application. Il ne sert qu'une fois : l'application perdue sera retirée, et vous en activerez une sur votre nouveau téléphone.", "Enter one of the ten codes you wrote down when you turned on the app. It works only once: the lost app will be removed, and you'll set one up on your new phone.")}</Typography>
      </Stack>
      <Box component="form" onSubmit={(e) => { e.preventDefault(); if (valide) void utiliser(); }} sx={{ display: "flex", flexDirection: "column", gap: 2.5, flex: 1 }}>
        <TextField label={t("Code de secours", "Recovery code")} value={code} onChange={(e) => { setRefus(null); setCode(e.target.value.slice(0, 32)); }} autoFocus fullWidth autoCapitalize="characters" autoComplete="off" spellCheck={false}
          placeholder="ABCDE-FGHJK" error={Boolean(refus)} helperText={refus ?? t("Les minuscules, les espaces et les tirets ne comptent pas.", "Lowercase, spaces and dashes don't matter.")}
          slotProps={{ htmlInput: { style: { fontFamily: "Roboto Mono, monospace", fontSize: 20, letterSpacing: "0.08em", textTransform: "uppercase" } } }} />
        <Box sx={{ flex: 1 }} />
        <Button type="submit" variant="contained" disabled={!valide || enCours}>{enCours ? t("Vérification…", "Verifying…") : t("Utiliser ce code", "Use this code")}</Button>
      </Box>
      <Typography variant="body2">{t("Plus aucun code ? Écrivez au support depuis votre adresse e-mail : l'équipe vérifiera votre identité avant de retirer l'application.", "No codes left? Write to support from your email address: the team will verify your identity before removing the app.")}</Typography>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Screen>
  );
}
