/*
 * LA VÉRIFICATION AVANT SORTIE, à l'écran. Une seule pièce pour les quatre
 * sorties d'argent (retrait MoMo/Orange, retrait crypto, fermeture du compte,
 * retrait d'un numéro) : le code de l'application d'authentification, le mot
 * de passe, et le code reçu par e-mail — qui dit le montant et la destination.
 *
 * À l'ouverture, la base contrôle l'opération et envoie le code (0036) ; un
 * nouvel envoi remplace le précédent. Le TOTP se prouve d'abord à Auth (la
 * session repasse « fraîche ») ; puis l'opération part avec le mot de passe
 * et le code e-mail, que la base juge. Chaque refus se dit sur SON champ.
 */
import LockRounded from "@mui/icons-material/LockRounded";
import MarkEmailReadOutlined from "@mui/icons-material/MarkEmailReadOutlined";
import { Alert, Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import { useGuichet } from "../guichet";
import type { OperationAVerifier, PreuveDeVerification, Verification } from "../guichet/types";
import { t } from "../noyau/langue";
import { champDeLErreur, courrielEnPanne, preuvesCompletes, type ChampDeLErreur } from "../noyau/verification";
import { ChampCode, ChampMotDePasse } from "./entree";
import { useGesteUnique } from "./gestes";
import { Card, FeuilleErreur, useCompteARebours } from "./index";

/** Le TOTP prouvé il y a moins de quatre minutes ne se redemande pas (la base l'accepte cinq minutes). */
const TOTP_ENCORE_FRAIS_MS = 4 * 60 * 1000;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function EtapeDeVerification({
  op, resume, libelle, intention, executer,
}: {
  op: OperationAVerifier;
  /** ce qui sort, où : redit au-dessus des champs */
  resume?: ReactNode;
  /** le bouton : « Envoyer 50 000 XAFe », « Fermer mon compte »… */
  libelle: string;
  /** l'intention du geste (sa clé d'idempotence en dépend) */
  intention: unknown;
  /** l'opération elle-même ; elle LÈVE sur un refus (le guichet en fait des erreurs) */
  executer: (preuve: PreuveDeVerification, cle: string) => Promise<void>;
}) {
  const guichet = useGuichet();
  const [verif, setVerif] = useState<Verification | null>(null);
  const [preparation, setPreparation] = useState<"en_cours" | "faite" | "echouee">("en_cours");
  const [erreurPreparation, setErreurPreparation] = useState<unknown>(null);
  const [courriel, setCourriel] = useState<string | null>(null);
  const [totp, setTotp] = useState("");
  const [mdp, setMdp] = useState("");
  const [code, setCode] = useState("");
  const [champ, setChamp] = useState<{ ou: ChampDeLErreur; texte: string } | null>(null);
  const [totpEnCours, setTotpEnCours] = useState(false);
  const totpProuveLe = useRef(0);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique("vf", intention);
  const renvoi = useCompteARebours(verif?.renvoiDes);
  const cleOp = JSON.stringify(op);

  const preparer = useCallback(async () => {
    setPreparation("en_cours");
    setErreurPreparation(null);
    setCourriel(null);
    setCode("");
    try {
      setVerif(await guichet.preparerVerification(JSON.parse(cleOp) as OperationAVerifier));
      setPreparation("faite");
    } catch (e) {
      setErreurPreparation(e);
      setPreparation("echouee");
    }
  }, [guichet, cleOp]);

  /* une seule préparation à l'ouverture (React rejoue les effets en développement) */
  const prepare = useRef<string | null>(null);
  useEffect(() => {
    if (prepare.current === cleOp) return;
    prepare.current = cleOp;
    void preparer();
  }, [cleOp, preparer]);

  /* l'e-mail est-il parti ? on regarde quelques fois, pas plus de deux minutes */
  useEffect(() => {
    if (!verif) return;
    let fini = false;
    let n = 0;
    const regarder = async () => {
      if (fini || n++ > 40) return;
      const e = await guichet.etatVerification(verif.id).catch(() => null);
      if (fini) return;
      setCourriel(e?.courriel ?? null);
      if (!e || e.courriel === "en_attente" || e.courriel === "en_cours") setTimeout(regarder, 3000);
    };
    void regarder();
    return () => { fini = true; };
  }, [guichet, verif]);

  const pret = verif !== null && preuvesCompletes(mdp, code, totp) && !enCours && !totpEnCours;

  const envoyer = async () => {
    if (!verif || !pret) return;
    setChamp(null);
    /* 1 · le code de l'application, à Auth : la session redevient « fraîche » */
    if (Date.now() - totpProuveLe.current > TOTP_ENCORE_FRAIS_MS) {
      setTotpEnCours(true);
      try {
        await guichet.verifierDeuxFacteurs(totp);
        totpProuveLe.current = Date.now();
      } catch {
        setChamp({ ou: "totp", texte: t("Code de l'application incorrect ou expiré : tapez celui qui s'affiche maintenant.", "Authenticator code incorrect or expired: type the one shown now.") });
        setTotp("");
        return;
      } finally {
        setTotpEnCours(false);
      }
    }
    /* 2 · l'opération, avec le mot de passe et le code e-mail : la base juge */
    await lancer(async (cle) => {
      try {
        await executer({ verification: verif.id, motDePasse: mdp, codeEmail: code }, cle);
      } catch (e) {
        const ou = champDeLErreur(message(e));
        if (!ou) throw e;
        if (ou === "nouveau_code") { setChamp({ ou, texte: t("Ce code ne vaut plus : un nouveau vient de partir par e-mail.", "This code is no longer valid: a new one has just been emailed.") }); await preparer(); return; }
        if (ou === "totp") { totpProuveLe.current = 0; setTotp(""); setChamp({ ou, texte: t("Tapez le code qui s'affiche maintenant dans votre application.", "Type the code shown now in your authenticator app.") }); return; }
        if (ou === "mot_de_passe") { setMdp(""); setChamp({ ou, texte: t("Mot de passe incorrect.", "Incorrect password.") + avecEssais(e) }); return; }
        if (ou === "code_email") { setCode(""); setChamp({ ou, texte: t("Code e-mail incorrect.", "Incorrect email code.") + avecEssais(e) }); return; }
        setChamp({ ou, texte: ou === "verrou"
          ? t("Trop d'essais : les sorties sont bloquées une heure. Un e-mail vous a prévenu.", "Too many attempts: withdrawals are blocked for one hour. We emailed you.")
          : t("Choisissez d'abord un mot de passe (Compte → Sécurité).", "Choose a password first (Account → Security).") });
      }
    });
  };

  if (preparation === "echouee") {
    return (
      <Stack gap={2}>
        {resume && <Card>{resume}</Card>}
        <Alert severity="warning">{message(erreurPreparation)}</Alert>
        <Button variant="outlined" onClick={() => void preparer()}>{t("Réessayer", "Try again")}</Button>
      </Stack>
    );
  }

  const panne = courrielEnPanne(courriel);
  return (
    <Stack gap={2}>
      {resume && <Card>{resume}</Card>}
      <Stack direction="row" gap={1} alignItems="center">
        <MarkEmailReadOutlined color={panne ? "error" : "primary"} />
        <Typography variant="body2" sx={{ flex: 1 }}>
          {preparation === "en_cours" || !verif
            ? t("Envoi du code par e-mail…", "Sending the code by email…")
            : panne
              ? t("L'e-mail n'a pas pu partir. Demandez un nouveau code.", "The email could not be sent. Ask for a new code.")
              : t(`Code envoyé à ${verif.emailMasque}. Il dit le montant et la destination.`, `Code sent to ${verif.emailMasque}. It states the amount and the destination.`)}
        </Typography>
        <Button size="small" disabled={preparation === "en_cours" || (renvoi > 0 && !panne)} onClick={() => void preparer()}>
          {renvoi > 0 && !panne ? t(`Renvoyer (${renvoi} s)`, `Resend (${renvoi} s)`) : t("Renvoyer", "Resend")}
        </Button>
      </Stack>

      <ChampCode compact label={t("Code de l'application d'authentification", "Authenticator app code")} valeur={totp} onChange={(v) => { setTotp(v); if (champ?.ou === "totp") setChamp(null); }}
        erreur={champ?.ou === "totp"} aide={champ?.ou === "totp" ? champ.texte : t("Les 6 chiffres affichés maintenant dans l'application.", "The 6 digits shown now in the app.")} />
      <ChampMotDePasse valeur={mdp} onChange={(v) => { setMdp(v); if (champ?.ou === "mot_de_passe") setChamp(null); }}
        erreur={champ?.ou === "mot_de_passe" || champ?.ou === "mot_de_passe_a_choisir"}
        aide={champ?.ou === "mot_de_passe" || champ?.ou === "mot_de_passe_a_choisir" ? champ.texte : undefined} />
      <ChampCode compact label={t("Code reçu par e-mail", "Code received by email")} valeur={code} onChange={(v) => { setCode(v); if (champ?.ou === "code_email") setChamp(null); }}
        erreur={champ?.ou === "code_email"} aide={champ?.ou === "code_email" ? champ.texte : t("Valable 10 minutes, une seule fois.", "Valid for 10 minutes, once.")} />

      {champ && (champ.ou === "verrou" || champ.ou === "nouveau_code") && <Alert severity={champ.ou === "verrou" ? "error" : "info"}>{champ.texte}</Alert>}
      {champ?.ou === "mot_de_passe_a_choisir" && <Button component={RouterLink} to="/compte/securite" variant="outlined">{t("Choisir mon mot de passe", "Choose my password")}</Button>}

      <Box sx={{ flex: 1 }} />
      <Button variant="contained" size="large" disabled={!pret} onClick={() => void envoyer()}
        startIcon={enCours || totpEnCours ? <CircularProgress size={18} color="inherit" /> : <LockRounded />}>
        {libelle}
      </Button>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Stack>
  );
}

/** « 3 essai(s) restant(s) », lu dans le détail du refus quand le guichet le donne. */
function avecEssais(e: unknown): string {
  const d = (e as { donnees?: { essaisRestants?: number | null } })?.donnees?.essaisRestants;
  return typeof d === "number" ? t(` ${d} essai(s) restant(s).`, ` ${d} attempt(s) left.`) : "";
}
