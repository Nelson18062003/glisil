/*
 * Compte → Sécurité. Quatre gestes, sans code secret (il n'existe plus) :
 *   changer le mot de passe        un code tout neuf de l'application, puis
 *                                  le nouveau (Auth peut aussi demander un
 *                                  code par e-mail : on le tape ici) ;
 *   de nouveaux codes de secours   un code de l'application, puis les dix
 *                                  codes, montrés une fois ; les anciens
 *                                  ne valent plus rien ;
 *   changer de téléphone           le code de l'ANCIEN téléphone, puis
 *                                  l'enrôlement du nouveau ; l'ancien est
 *                                  retiré (téléphone perdu : « code de
 *                                  secours », à la connexion) ;
 *   déconnecter tous les appareils.
 * Chaque geste sensible repasse par l'application : une session laissée
 * ouverte sur un téléphone prêté ne suffit pas à changer les clés.
 */
import DevicesOtherRounded from "@mui/icons-material/DevicesOtherRounded";
import KeyRounded from "@mui/icons-material/KeyRounded";
import LockResetRounded from "@mui/icons-material/LockResetRounded";
import LogoutRounded from "@mui/icons-material/LogoutRounded";
import PhonelinkSetupRounded from "@mui/icons-material/PhonelinkSetupRounded";
import { Box, Button, Checkbox, CircularProgress, FormControlLabel, Stack, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useGuichet } from "../../guichet";
import { CODE_TOTP_DEMO } from "../../guichet/demo";
import type { EnrolementTotp, EtatCodesDeSecours } from "../../guichet/types";
import { jourRelatif } from "../../noyau/format";
import { t } from "../../noyau/langue";
import { useSession } from "../../session/session";
import { Feuille, FeuilleErreur, List, Row, Screen } from "../../ui";
import { ChampCode } from "../../ui/entree";
import { useGesteUnique } from "../../ui/gestes";
import { ListeDesCodes } from "../bienvenue/codes-de-secours";
import { BlocEnrolement } from "../bienvenue/deux-facteurs";
import { NouveauMotDePasse, nouveauPret } from "../bienvenue/mot-de-passe";

type Geste = "mot_de_passe" | "codes" | "telephone" | "partout" | null;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const codeRefuse = (e: unknown) => /code de l'application|invalid totp|mfa_verification_failed/i.test(message(e));

export function CompteSecurite() {
  const guichet = useGuichet();
  const session = useSession();
  const [geste, setGeste] = useState<Geste>(null);
  const [etat, setEtat] = useState<EtatCodesDeSecours | null>(null);
  const [fait, setFait] = useState<string | null>(null);
  const relire = () => { guichet.codesDeSecours().then(setEtat).catch(() => setEtat(null)); };
  useEffect(relire, [guichet]);

  const fermer = (annonce?: string) => { setGeste(null); if (annonce) { setFait(annonce); setTimeout(() => setFait(null), 4000); } relire(); };
  const restants = etat ? (etat.restants === 1 ? t("1 code restant", "1 code left") : t(`${etat.restants} codes restants`, `${etat.restants} codes left`)) : t("Dix codes, à garder loin du téléphone", "Ten codes, kept away from your phone");

  return (
    <Screen title={t("Sécurité", "Security")} back="/compte">
      <List>
        <Row icon={<LockResetRounded />} tone="blue" primary={t("Changer mon mot de passe", "Change my password")} secondary={t("Il est demandé avant chaque sortie d'argent", "Required before every withdrawal")} onClick={() => setGeste("mot_de_passe")} />
        <Row icon={<KeyRounded />} tone={etat && etat.restants <= 3 ? "amber" : "green"} primary={t("Nouveaux codes de secours", "New recovery codes")} secondary={restants} onClick={() => setGeste("codes")} />
        <Row icon={<PhonelinkSetupRounded />} tone="neutral" primary={t("Changer de téléphone", "Change phone")} secondary={t("Mettre l'application d'authentification sur un autre téléphone", "Move the authenticator app to another phone")} onClick={() => setGeste("telephone")} />
        <Row icon={<DevicesOtherRounded />} tone="neutral" primary={t("Déconnecter tous les appareils", "Sign out of all devices")} secondary={t("Si un appareil a été perdu ou prêté", "If a device was lost or lent")} onClick={() => setGeste("partout")} />
      </List>
      {fait && <Typography variant="body2" color="primary" role="status">{fait}</Typography>}
      <Typography variant="body2">{t("Votre mot de passe et les codes de votre application ne se partagent avec personne, pas même avec l'équipe Glisil : elle ne vous les demandera jamais.", "Never share your password or your app codes with anyone, not even the Glisil team: they will never ask you for them.")}</Typography>
      <Box sx={{ flex: 1 }} />
      <Button variant="outlined" color="error" startIcon={<LogoutRounded />} onClick={() => void session.deconnecter()}>{t("Déconnecter cet appareil", "Sign out of this device")}</Button>

      <Feuille ouverte={geste === "mot_de_passe"} onFermer={() => fermer()} titre={t("Changer mon mot de passe", "Change my password")}>
        {geste === "mot_de_passe" && <ChangerMotDePasse onFini={() => fermer(t("Mot de passe changé.", "Password changed."))} />}
      </Feuille>
      <Feuille ouverte={geste === "codes"} onFermer={() => fermer()} titre={t("Nouveaux codes de secours", "New recovery codes")}>
        {geste === "codes" && <NouveauxCodes creesLe={etat?.creesLe ?? null} onFini={() => fermer(t("Nouveaux codes enregistrés. Les anciens ne valent plus rien.", "New codes saved. The old ones no longer work."))} />}
      </Feuille>
      <Feuille ouverte={geste === "telephone"} onFermer={() => fermer()} titre={t("Changer de téléphone", "Change phone")}>
        {geste === "telephone" && <ChangerDeTelephone onFini={() => fermer(t("C'est fait : seul le nouveau téléphone donne les codes.", "Done: only the new phone gives codes now."))} />}
      </Feuille>
      <Feuille ouverte={geste === "partout"} onFermer={() => fermer()} titre={t("Déconnecter tous les appareils ?", "Sign out of all devices?")}>
        {geste === "partout" && <DeconnecterPartout onAnnuler={() => fermer()} />}
      </Feuille>
    </Screen>
  );
}

/** Le code affiché MAINTENANT par l'application : la session redevient « fraîche » pour le geste qui suit. */
function CodeFrais({ texte, onProuve }: { texte: string; onProuve: () => void }) {
  const guichet = useGuichet();
  const [code, setCode] = useState("");
  const [refuse, setRefuse] = useState(false);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();
  const prouver = () => lancer(async () => {
    try { await guichet.verifierDeuxFacteurs(code); onProuve(); }
    catch (e) { if (!codeRefuse(e)) throw e; setRefuse(true); setCode(""); }
  });
  return (
    <Stack gap={1.5} component="form" onSubmit={(e) => { e.preventDefault(); if (code.length === 6) void prouver(); }}>
      <Typography variant="body2">{texte}</Typography>
      <ChampCode compact autoFocus label={t("Code de l'application d'authentification", "Authenticator app code")} valeur={code} onChange={(v) => { setCode(v); setRefuse(false); }} erreur={refuse}
        aide={refuse ? t("Ce code ne marche pas : tapez celui affiché maintenant.", "This code doesn't work: enter the one shown right now.") : guichet.mode === "demo" ? t(`Démonstration : l'application affiche ${CODE_TOTP_DEMO}.`, `Demo: the app shows ${CODE_TOTP_DEMO}.`) : " "} />
      <Button type="submit" variant="contained" disabled={code.length !== 6 || enCours}>{enCours ? <CircularProgress size={18} color="inherit" /> : t("Continuer", "Continue")}</Button>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Stack>
  );
}

function ChangerMotDePasse({ onFini }: { onFini: () => void }) {
  const guichet = useGuichet();
  const [prouve, setProuve] = useState(false);
  const [mdp, setMdp] = useState("");
  const [conf, setConf] = useState("");
  /* Auth peut exiger une confirmation par e-mail (« changement sécurisé ») : le code part, on le tape ici */
  const [nonceDemande, setNonceDemande] = useState(false);
  const [nonce, setNonce] = useState("");
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();

  /* 0048 : on le dit AVANT — un mot de passe changé met les retraits en pause 24 h */
  if (!prouve) return <CodeFrais texte={t("D'abord, le code affiché maintenant par votre application. Bon à savoir : après un changement de mot de passe, les retraits sont en pause 24 h, pour votre sécurité.", "First, the code shown now in your app. Good to know: after a password change, withdrawals are paused for 24 hours, for your security.")} onProuve={() => setProuve(true)} />;

  const pret = nouveauPret(mdp, conf) && (!nonceDemande || nonce.length === 6) && !enCours;
  const changer = () => lancer(async () => {
    try {
      await guichet.changerMotDePasse({ nouveau: mdp, nonce: nonceDemande ? nonce : undefined });
      setMdp(""); setConf(""); setNonce("");
      onFini();
    } catch (e) {
      if (/confirmation par e-mail/.test(message(e))) { setNonceDemande(true); setNonce(""); return; }
      throw e;
    }
  });
  return (
    <Stack gap={2.5} component="form" onSubmit={(e) => { e.preventDefault(); if (pret) void changer(); }}>
      <NouveauMotDePasse valeur={mdp} onChange={setMdp} confirmation={conf} onConfirmation={setConf} />
      {nonceDemande && (
        <ChampCode compact autoFocus label={t("Code reçu par e-mail", "Code received by email")} valeur={nonce} onChange={setNonce}
          aide={t("Pour ce changement, un code vient de partir à votre adresse e-mail.", "For this change, a code has just been sent to your email address.")} />
      )}
      <Button type="submit" variant="contained" disabled={!pret}>{enCours ? t("Enregistrement…", "Saving…") : t("Changer le mot de passe", "Change password")}</Button>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Stack>
  );
}

function NouveauxCodes({ creesLe, onFini }: { creesLe: string | null; onFini: () => void }) {
  const guichet = useGuichet();
  const session = useSession();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [note, setNote] = useState(false);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();

  if (!codes) {
    return (
      <Stack gap={1.5}>
        <Typography variant="body2">{creesLe
          ? t(`Vos codes actuels datent de ${jourRelatif(creesLe)}. Les nouveaux les remplacent tous.`, `Your current codes are from ${jourRelatif(creesLe)}. The new ones replace them all.`)
          : t("Les nouveaux codes remplacent tous les anciens.", "The new codes replace all the old ones.")}</Typography>
        <CodeFrais texte={t("Le code affiché maintenant par votre application :", "The code shown now in your app:")}
          onProuve={() => void lancer(async () => setCodes(await guichet.genererCodesDeSecours()))} />
        {enCours && <CircularProgress sx={{ alignSelf: "center" }} />}
        <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
      </Stack>
    );
  }
  const confirmer = () => lancer(async () => { await guichet.confirmerCodesDeSecours(); setCodes(null); onFini(); });
  return (
    <Stack gap={1.5}>
      <Typography variant="body2">{t("Notez-les sur papier ou gardez le fichier ailleurs que sur ce téléphone : ils ne s'afficheront plus.", "Write them on paper or keep the file somewhere other than this phone: they won't be shown again.")}</Typography>
      <ListeDesCodes codes={codes} email={session.compte?.email ?? null} />
      <FormControlLabel
        control={<Checkbox checked={note} onChange={(e) => setNote(e.target.checked)} />}
        label={<Typography variant="body2" sx={{ color: "text.primary" }}>{t("J'ai noté ou enregistré mes codes", "I've written down or saved my codes")}</Typography>}
      />
      <Button variant="contained" disabled={!note || enCours} onClick={() => void confirmer()}>{enCours ? t("Enregistrement…", "Saving…") : t("Terminer", "Finish")}</Button>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Stack>
  );
}

function ChangerDeTelephone({ onFini }: { onFini: () => void }) {
  const guichet = useGuichet();
  const [enrolement, setEnrolement] = useState<EnrolementTotp | null>(null);
  const [prouve, setProuve] = useState(false);
  const [code, setCode] = useState("");
  const [refuse, setRefuse] = useState(false);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();

  if (!prouve) {
    return <CodeFrais texte={t("D'abord, le code de l'application sur votre ANCIEN téléphone. Vous l'avez perdu ? Déconnectez-vous, puis à la connexion choisissez « J'ai perdu mon téléphone » et utilisez un code de secours. Bon à savoir : après un changement de téléphone, les retraits sont en pause 24 h.", "First, the app code from your OLD phone. Lost it? Sign out, then at sign-in choose \"I lost my phone\" and use a recovery code. Good to know: after a phone change, withdrawals are paused for 24 hours.")}
      onProuve={() => { setProuve(true); void lancer(async () => setEnrolement(await guichet.commencerChangementDeTelephone())); }} />;
  }
  const terminer = () => lancer(async () => {
    if (!enrolement) return;
    try { await guichet.terminerChangementDeTelephone({ facteurId: enrolement.facteurId, code }); onFini(); }
    catch (e) { if (!codeRefuse(e)) throw e; setRefuse(true); setCode(""); }
  });
  return (
    <Stack gap={2}>
      <Typography variant="body2">{t("Maintenant, sur le NOUVEAU téléphone :", "Now, on the NEW phone:")}</Typography>
      <BlocEnrolement enrolement={enrolement} code={code} onCode={(c) => { setCode(c); setRefuse(false); }} erreurCode={refuse} enCours={enCours} />
      <Button variant="contained" disabled={!enrolement || code.length !== 6 || enCours} onClick={() => void terminer()}>{enCours ? t("Vérification…", "Checking…") : t("Utiliser ce téléphone", "Use this phone")}</Button>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Stack>
  );
}

function DeconnecterPartout({ onAnnuler }: { onAnnuler: () => void }) {
  const session = useSession();
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();
  return (
    <Stack gap={1.5}>
      <Typography variant="body2">{t("Tous les appareils connectés à ce compte, celui-ci compris, devront se reconnecter avec le mot de passe et le code de l'application.", "Every device signed in to this account, this one included, will have to sign in again with the password and the app code.")}</Typography>
      <Button variant="contained" color="error" disabled={enCours} onClick={() => void lancer(() => session.deconnecter("global"))}>{t("Tout déconnecter", "Sign out everywhere")}</Button>
      <Button onClick={onAnnuler}>{t("Annuler", "Cancel")}</Button>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Stack>
  );
}
