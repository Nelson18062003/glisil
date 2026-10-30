/*
 * Entrer dans l'application :
 *   Bienvenue — Google, ou l'adresse e-mail et un mot de passe (deux onglets :
 *               créer un compte, se connecter) ;
 *   le code reçu par e-mail, à l'inscription seulement (il prouve l'adresse) ;
 *   le retour de Google ;
 * puis, ailleurs (deux-facteurs.tsx, codes-de-secours.tsx, inscription.tsx),
 * l'application d'authentification, les codes de secours et le profil.
 * La session (session/session.tsx) décide où l'on va ensuite.
 */
import BoltRounded from "@mui/icons-material/BoltRounded";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import MarkEmailReadOutlined from "@mui/icons-material/MarkEmailReadOutlined";
import ShieldOutlined from "@mui/icons-material/ShieldOutlined";
import VisibilityOutlined from "@mui/icons-material/VisibilityOutlined";
import { Avatar, Box, Button, CircularProgress, Divider, Stack, Tab, Tabs, TextField, Typography } from "@mui/material";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useGuichet } from "../../guichet";
import { CODE_DEMO, EMAIL_VITRINE, MOT_DE_PASSE_DEMO } from "../../guichet/demo";
import { lisible } from "../../noyau/erreurs";
import { CHEMIN_DE_RETOUR, coqueActuelle, lireRetourOAuth, retourVersLaCoque, voieGoogle } from "../../noyau/google";
import { emailNormalise, emailValide } from "../../noyau/identite";
import { t } from "../../noyau/langue";
import { motDePasseValide } from "../../noyau/motDePasse";
import { useSession, type Annonce } from "../../session/session";
import { tones } from "../../theme";
import { ChoixDeLangue, FeuilleErreur, Marque, NomGlisil, Screen } from "../../ui";
import { ChampCode, ChampMotDePasse, RegleDuMotDePasse } from "../../ui/entree";
import { ESPACE, Champs, EnTete } from "../../ui/formulaire";
import { useGesteUnique } from "../../ui/gestes";

/** la longueur du code envoyé par e-mail (réglage « Email OTP Length » de Supabase) */
export const LONGUEUR_CODE = 6;
/** entre deux codes, comme Supabase l'impose */
const ATTENTE_RENVOI_S = 60;

/* l'adresse seule survit à un rechargement (le mot de passe, jamais : il vit en mémoire, le temps du code) */
export const CLE_EMAIL = "glisil.bienvenue.email";
export const lireEmail = () => { try { return sessionStorage.getItem(CLE_EMAIL) ?? ""; } catch { return ""; } };
export const garderEmail = (e: string) => { try { sessionStorage.setItem(CLE_EMAIL, e); } catch { /* sans stockage, on redemande l'adresse */ } };
const noterEnvoi = () => { try { sessionStorage.setItem(`${CLE_EMAIL}.envoye`, String(Date.now())); } catch { /* idem */ } };
const resteAvantRenvoi = () => {
  try { const envoye = Number(sessionStorage.getItem(`${CLE_EMAIL}.envoye`) ?? 0); return Math.max(0, ATTENTE_RENVOI_S - Math.floor((Date.now() - envoye) / 1000)); } catch { return ATTENTE_RENVOI_S; }
};

/** Une minuterie qui descend d'une seconde à la fois, jusqu'à zéro. */
export function useMinuterie(depart: number): [number, (s: number) => void] {
  const [reste, setReste] = useState(depart);
  useEffect(() => {
    if (reste <= 0) return;
    const m = setTimeout(() => setReste((r) => r - 1), 1000);
    return () => clearTimeout(m);
  }, [reste]);
  return [reste, setReste];
}

function Promesse({ icone, titre, texte }: { icone: ReactNode; titre: string; texte: string }) {
  return (
    <Stack direction="row" gap={1.5} alignItems="flex-start">
      <Avatar sx={{ width: 36, height: 36, bgcolor: tones.green.bg, color: tones.green.fg }}>{icone}</Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle1" sx={{ lineHeight: 1.3 }}>{titre}</Typography>
        <Typography variant="body2">{texte}</Typography>
      </Box>
    </Stack>
  );
}

/** Ce que l'entrée dit en arrivant : pourquoi l'on est revenu ici. */
function texteDeLAnnonce(a: Annonce): string | null {
  if (a === "facteur_faible") return t("Connectez-vous avec votre mot de passe : un code reçu par e-mail ne suffit pas pour entrer.", "Sign in with your password: a code received by email isn't enough to get in.");
  if (a === "adresse_confirmee") return t("Adresse confirmée. Connectez-vous avec votre mot de passe.", "Address confirmed. Sign in with your password.");
  if (a === "mot_de_passe_change") return t("Mot de passe changé. Connectez-vous avec le nouveau.", "Password changed. Sign in with the new one.");
  return null;
}

export function Annonce({ texte, tone = "green" }: { texte: string | null; tone?: "green" | "amber" | "blue" }) {
  if (!texte) return null;
  return (
    <Stack direction="row" gap={1} alignItems="flex-start" role="status" sx={{ p: 1.5, borderRadius: 4, bgcolor: tones[tone].bg, color: tones[tone].fg }}>
      <InfoOutlined fontSize="small" sx={{ mt: 0.25 }} />
      <Typography variant="body2" sx={{ color: "inherit" }}>{texte}</Typography>
    </Stack>
  );
}

/** Le « G » de Google, dans ses couleurs (le bouton officiel le demande). */
function LogoGoogle() {
  return (
    <Box component="svg" viewBox="0 0 48 48" aria-hidden sx={{ width: 20, height: 20 }}>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.6 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </Box>
  );
}

/** La porte d'entrée : Google, ou l'adresse e-mail et un mot de passe. */
export function Bienvenue() {
  const guichet = useGuichet();
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const demandeEntrer = Boolean((location.state as { apres?: string; onglet?: string } | null)?.apres) || (location.state as { onglet?: string } | null)?.onglet === "entrer" || Boolean(session.annonce);
  const [onglet, setOnglet] = useState<"creer" | "entrer">(demandeEntrer ? "entrer" : "creer");
  const [email, setEmail] = useState(lireEmail);
  const [motDePasse, setMotDePasse] = useState("");
  const [vu, setVu] = useState(false);
  const [dejaInscrit, setDejaInscrit] = useState(false);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();
  const voie = useMemo(() => voieGoogle({ demo: guichet.mode === "demo", coque: coqueActuelle(), agent: typeof navigator !== "undefined" ? navigator.userAgent : "" }), [guichet.mode]);
  const valide = emailValide(email) && (onglet === "entrer" ? motDePasse.length > 0 : motDePasseValide(motDePasse));

  /* le mot de passe ne survit pas au changement d'onglet : un mot de passe d'inscription n'est pas celui de connexion */
  const changerOnglet = (o: "creer" | "entrer") => { setOnglet(o); setMotDePasse(""); setDejaInscrit(false); effacerErreur(); };

  const continuer = () =>
    lancer(async () => {
      const e = emailNormalise(email);
      garderEmail(e);
      session.poserAnnonce(null);
      if (onglet === "creer") {
        const r = await guichet.inscrire({ email: e, motDePasse });
        if (r.dejaInscrit) { setOnglet("entrer"); setMotDePasse(""); setDejaInscrit(true); return; }
        if (r.session) { await session.avancer(); return; }
        noterEnvoi();
        session.retenirInscription(e, motDePasse);
        navigate("/bienvenue/code");
        return;
      }
      try {
        await guichet.connecter({ email: e, motDePasse });
      } catch (err) {
        /* l'adresse n'a jamais été confirmée : un code vient de repartir, on le tape, le mot de passe gardé en mémoire */
        if (err instanceof Error && err.message === "adresse e-mail non confirmée") { // langue-ok (phrase du guichet comparée)
          noterEnvoi();
          session.retenirInscription(e, motDePasse);
          navigate("/bienvenue/code");
          return;
        }
        throw err;
      }
      await session.avancer();
    });

  const google = () => lancer(async () => { session.poserAnnonce(null); await guichet.connecterGoogle(); });
  const annonce = dejaInscrit ? t("Cette adresse a déjà un compte : connectez-vous avec son mot de passe.", "This address already has an account: sign in with its password.") : texteDeLAnnonce(session.annonce);

  return (
    /* Sur un téléphone, la marque en haut et le formulaire dessous ; sur un ordinateur, côte à côte,
       la marque sur toute la hauteur à gauche — le formulaire reste une colonne courte, sous les yeux. */
    <Box sx={{ width: "100%", maxWidth: { xs: 480, md: "none" }, mx: "auto", minHeight: "100dvh", bgcolor: "background.default",
               display: { xs: "flex", md: "grid" }, flexDirection: "column", gridTemplateColumns: { md: "minmax(0,1fr) minmax(0,1fr)" } }}>
      <Box sx={{ bgcolor: "primary.main", color: "#FFFFFF", px: { xs: 3, md: 8 }, pt: { xs: "calc(env(safe-area-inset-top) + 40px)", md: 8 }, pb: { xs: 4, md: 8 },
                 borderBottomLeftRadius: { xs: 32, md: 0 }, borderBottomRightRadius: { xs: 32, md: 0 }, display: "flex", flexDirection: "column", justifyContent: { md: "center" } }}>
        <Stack gap={2.5}>
          {/* la langue AVANT l'inscription : un anglophone choisit avant d'avoir rien à lire. Les pastilles,
              faites pour un fond clair, se redessinent en blanc sur le vert de la marque. */}
          <Box sx={{ alignSelf: "flex-end", mb: -1, "& .MuiChip-root": { color: "#FFFFFF", borderColor: "rgba(255,255,255,0.6)", fontWeight: 600 },
                     "& .MuiChip-filled": { bgcolor: "#FFFFFF", color: "primary.main", "&:hover": { bgcolor: "rgba(255,255,255,0.9)" } },
                     "& .MuiChip-outlined:hover": { bgcolor: "rgba(255,255,255,0.12)" } }}>
            <ChoixDeLangue />
          </Box>
          <Stack direction="row" alignItems="center" gap={1.25}>
            <Marque size={52} />
            <NomGlisil size={36} couleur="#FFFFFF" />
          </Stack>
          <Typography component="h1" sx={{ fontSize: { xs: 26, md: 40 }, fontWeight: 600, lineHeight: 1.2, color: "#FFFFFF", textWrap: "balance", maxWidth: 520 }}>
            {t("Le XAFe, et le marché où il s'échange.", "XAFe, and the market where it trades.")}
          </Typography>
          <Typography sx={{ fontSize: 15, color: "rgba(255,255,255,0.86)" }}>
            {t("Vos francs CFA sur la blockchain, au même prix pour tout le monde.", "Your CFA francs on the blockchain, at the same price for everyone.")}
          </Typography>
        </Stack>
      </Box>

      <Box component="form" onSubmit={(e) => { e.preventDefault(); if (valide) void continuer(); }}
        sx={{ flex: 1, px: 2, pt: { xs: 2.5, md: 0 }, pb: "calc(env(safe-area-inset-bottom) + 24px)", display: "flex", flexDirection: "column", gap: `${ESPACE.groupes}px`,
              justifyContent: { md: "center" }, width: "100%", maxWidth: { md: 440 }, mx: { md: "auto" } }}>
        <Tabs value={onglet} onChange={(_, v) => changerOnglet(v)} variant="fullWidth" aria-label={t("Créer un compte ou se connecter", "Create an account or sign in")}>
          <Tab value="creer" label={t("Créer un compte", "Create account")} />
          <Tab value="entrer" label={t("Se connecter", "Sign in")} />
        </Tabs>
        <Annonce texte={annonce} tone={session.annonce === "facteur_faible" ? "amber" : "green"} />

        {voie.voie !== "aucune" && (
          <>
            <Button type="button" variant="outlined" onClick={() => void google()} disabled={enCours} startIcon={<LogoGoogle />}
              sx={{ bgcolor: "background.paper", borderColor: "divider", color: "text.primary", "&:hover": { bgcolor: "background.paper", borderColor: "text.secondary" } }}>
              {t("Continuer avec Google", "Continue with Google")}
            </Button>
            <Divider><Typography variant="caption">{t("ou avec votre adresse e-mail", "or with your email address")}</Typography></Divider>
          </>
        )}
        {voie.voie === "aucune" && voie.raison === "navigateur_integre" && (
          <Annonce tone="blue" texte={t("Pour entrer avec Google, ouvrez Glisil dans votre navigateur (Chrome, Safari) : WhatsApp et Facebook ne le permettent pas.", "To sign in with Google, open Glisil in your browser (Chrome, Safari): WhatsApp and Facebook don't allow it.")} />
        )}

        <Champs>
        <TextField
          label={t("Adresse e-mail", "Email address")}
          value={email}
          onChange={(e) => setEmail(e.target.value.replace(/\s/g, ""))}
          onBlur={() => setVu(true)}
          type="email"
          inputMode="email"
          autoComplete={onglet === "creer" ? "email" : "username"}
          autoCapitalize="none"
          spellCheck={false}
          fullWidth
          error={vu && email.length > 0 && !emailValide(email)}
          helperText={vu && email.length > 0 && !emailValide(email) ? t("Écrivez l'adresse en entier, par exemple awa@exemple.com.", "Enter the full address, for example awa@example.com.") : undefined}
          slotProps={{ input: { sx: { fontSize: 18 } } }}
        />
        <ChampMotDePasse valeur={motDePasse} onChange={setMotDePasse} nouveau={onglet === "creer"}
          label={onglet === "creer" ? t("Choisissez un mot de passe", "Choose a password") : t("Mot de passe", "Password")}
          aide={onglet === "creer" ? t("Il sera demandé à chaque connexion et avant chaque sortie d'argent.", "You'll need it every time you sign in and before every withdrawal.") : undefined} />
        {onglet === "creer" && <RegleDuMotDePasse valeur={motDePasse} />}
        <Button type="submit" variant="contained" disabled={!valide || enCours}>
          {enCours ? (onglet === "creer" ? t("Création…", "Creating…") : t("Connexion…", "Signing in…")) : onglet === "creer" ? t("Créer mon compte", "Create my account") : t("Se connecter", "Sign in")}
        </Button>
        </Champs>
        <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
          <Button component={Link} to="/bienvenue/oubli" variant="text" size="small" onClick={() => { if (emailValide(email)) garderEmail(emailNormalise(email)); }}>
            {t("Mot de passe oublié ?", "Forgot password?")}
          </Button>
        </Stack>
        {onglet === "entrer" && (
          <Typography variant="body2">
            {t("Vous entriez jusqu'ici avec un simple code reçu par e-mail ? Choisissez « Mot de passe oublié » : vous poserez votre mot de passe en deux minutes.",
              "Did you sign in with just an emailed code until now? Choose \"Forgot password\": you'll set your password in two minutes.")}
          </Typography>
        )}
        {guichet.mode === "demo" && (
          <Typography variant="caption">
            {t(`Démonstration : ${EMAIL_VITRINE} et le mot de passe ${MOT_DE_PASSE_DEMO} arrivent avec une vie déjà écrite. Tous les codes valent ${CODE_DEMO}.`,
              `Demo: ${EMAIL_VITRINE} with the password ${MOT_DE_PASSE_DEMO} comes with a ready-made history. Every code is ${CODE_DEMO}.`)}
          </Typography>
        )}
        <Stack gap={2} sx={{ mt: 1 }}>
          <Promesse icone={<VisibilityOutlined fontSize="small" />} titre={t("Transparent", "Transparent")} texte={t("Un seul carnet d'ordres, le même prix affiché pour tous.", "One order book, the same price shown to everyone.")} />
          <Promesse icone={<ShieldOutlined fontSize="small" />} titre={t("Sécurisé", "Secure")} texte={t("Chaque XAFe est couvert un pour un ; chaque sortie d'argent demande votre mot de passe, un code par e-mail et votre application d'authentification.", "Every XAFe is backed one to one; every withdrawal asks for your password, an emailed code and your authenticator app.")} />
          <Promesse icone={<BoltRounded fontSize="small" />} titre={t("Rapide", "Fast")} texte={t("Vos XAF crédités dès que le paiement MoMo arrive.", "Your XAF are credited as soon as the MoMo payment arrives.")} />
        </Stack>
      </Box>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} onRecommencer={() => void continuer()} />
    </Box>
  );
}

/** Le code reçu par e-mail à l'inscription : il prouve l'adresse. */
export function BienvenueCode() {
  const guichet = useGuichet();
  const session = useSession();
  const navigate = useNavigate();
  const email = session.inscription.email ?? lireEmail();
  const [code, setCode] = useState("");
  const [faux, setFaux] = useState(false);
  const [reste, setReste] = useMinuterie(resteAvantRenvoi());
  const [renvoye, setRenvoye] = useState(false);
  const champ = useRef<HTMLInputElement>(null);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();

  useEffect(() => { if (!email) navigate("/bienvenue", { replace: true }); }, [email, navigate]);

  const valider = (c: string) =>
    lancer(async () => {
      try {
        const { connecte } = await guichet.confirmerEmail({ email, code: c, motDePasse: session.inscription.motDePasse ?? undefined });
        session.retenirInscription(null, null);
        if (!connecte) { session.poserAnnonce("adresse_confirmee"); navigate("/bienvenue", { replace: true, state: { onglet: "entrer" } }); }
        await session.avancer();
      } catch (e) {
        setFaux(true);
        setCode("");
        champ.current?.focus();
        if (lisible(e).titre !== t("Ce code ne marche pas", "This code doesn't work")) throw e; // le titre de noyau/erreurs, dans la langue de l'écran
      }
    });

  const renvoyer = () =>
    lancer(async () => {
      await guichet.renvoyerConfirmation(email);
      noterEnvoi();
      setReste(ATTENTE_RENVOI_S);
      setRenvoye(true);
      setFaux(false);
    });

  const saisir = (c: string) => {
    setFaux(false);
    setCode(c);
    if (c.length === LONGUEUR_CODE) void valider(c);
  };
  const changerDAdresse = () => { session.retenirInscription(null, null); void session.avancer(); navigate("/bienvenue", { replace: true }); };

  return (
    <Screen onBack={changerDAdresse} gap={3}>
      <Avatar sx={{ width: 64, height: 64, bgcolor: tones.green.bg, color: "primary.main" }}><MarkEmailReadOutlined sx={{ fontSize: 32 }} /></Avatar>
      <EnTete titre={t("Confirmez votre adresse", "Confirm your address")}
        texte={<>{t("Nous avons envoyé un code à six chiffres à ", "We sent a six-digit code to ")}<Box component="b" sx={{ overflowWrap: "anywhere" }}>{email}</Box>.</>} />
      <Champs sx={{ flex: 1 }}>
      <ChampCode ref={champ} valeur={code} onChange={saisir} label={t("Code reçu par e-mail", "Code received by email")} autoFocus erreur={faux} disabled={enCours}
        aide={faux ? t("Ce code n'est pas le bon, ou il a expiré. Réessayez ou demandez-en un nouveau.", "This code is wrong or has expired. Try again or request a new one.") : guichet.mode === "demo" ? t(`Démonstration : le code est ${CODE_DEMO}.`, `Demo: the code is ${CODE_DEMO}.`) : t("Le code arrive en moins d'une minute. Regardez aussi vos courriers indésirables.", "The code arrives in under a minute. Check your spam folder too.")} />
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
        <Button variant="text" size="small" disabled={reste > 0 || enCours} onClick={() => void renvoyer()}>
          {reste > 0 ? t(`Renvoyer le code dans ${reste} s`, `Resend code in ${reste}s`) : t("Renvoyer le code", "Resend code")}
        </Button>
        <Button variant="text" size="small" color="inherit" sx={{ color: "text.secondary" }} onClick={changerDAdresse}>{t("Changer d'adresse", "Change address")}</Button>
      </Stack>
      {renvoye && reste > 0 && <Typography variant="body2" role="status" sx={{ color: "primary.main" }}>{t("Un nouveau code est parti.", "A new code is on its way.")}</Typography>}
      {/* « mt: auto » pousse le bouton en bas d'un grand écran sans ajouter d'écart sur un petit (un bloc vide, lui, en ajoutait un) */}
      <Button variant="contained" sx={{ mt: "auto" }} disabled={code.length < LONGUEUR_CODE || enCours} onClick={() => void valider(code)}>
        {enCours ? t("Vérification…", "Verifying…") : t("Valider", "Confirm")}
      </Button>
      </Champs>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Screen>
  );
}

/**
 * Le retour de Google, trois cas :
 *   · ouvert dans l'onglet du système pour la coque (état « c. ») : la page rend la réponse à
 *     l'application (glisil://auth-retour#…) — elle n'a ni le nonce ni la session ;
 *   · le chemin direct (un état « w. ») : le jeton d'identité s'échange ici, puis disparaît de l'adresse ;
 *   · par Supabase (?code=…) : la session s'échange toute seule (detectSessionInUrl).
 * Un refus se dit.
 */
export function RetourGoogle() {
  const guichet = useGuichet();
  const { avancer } = useSession();
  const navigate = useNavigate();
  const [adresse] = useState(() => window.location.href);
  const versLaCoque = useMemo(() => retourVersLaCoque(adresse), [adresse]);
  const retour = useMemo(() => lireRetourOAuth(adresse), [adresse]);
  const direct = !versLaCoque && Boolean(retour.etat);
  const [erreur, setErreur] = useState<string | null>(direct ? null : retour.erreur);
  const [tropLong, setTropLong] = useState(false);
  const fait = useRef(false);
  useEffect(() => {
    if (versLaCoque) { window.location.replace(versLaCoque); return; }
    if (erreur) return;
    if (direct && !fait.current) {
      fait.current = true; // un jeton ne s'échange qu'une fois (React rejoue les effets en développement)
      /* le jeton quitte l'adresse avant tout : ni l'historique ni une capture d'écran ne le gardent */
      window.history.replaceState(window.history.state, "", CHEMIN_DE_RETOUR);
      void guichet.terminerRetourOAuth(adresse).then(() => avancer(), (e: unknown) => {
        const d = e && typeof e === "object" && "detail" in e ? (e as { detail?: string }).detail : undefined;
        setErreur(d ?? t("la connexion n'a pas abouti", "the sign-in didn't complete"));
      });
    } else if (!direct) void avancer();
    const m = setTimeout(() => setTropLong(true), 15_000);
    return () => clearTimeout(m);
  }, [versLaCoque, direct, erreur, adresse, guichet, avancer]);

  if (versLaCoque) {
    /* Chrome peut retenir une ouverture d'application qu'aucun doigt n'a demandée : le bouton la fait à coup sûr */
    return (
      <Screen gap={2}>
        <Stack sx={{ flex: 1 }} alignItems="center" justifyContent="center" gap={2} textAlign="center">
          <Typography variant="h5">{t("Google a répondu", "Google has answered")}</Typography>
          <Typography variant="body2">{t("Revenez dans l'application Glisil pour finir la connexion.", "Go back to the Glisil app to finish signing in.")}</Typography>
          <Button variant="contained" size="large" href={versLaCoque}>{t("Revenir dans Glisil", "Back to Glisil")}</Button>
        </Stack>
      </Screen>
    );
  }
  if (erreur || tropLong) {
    return (
      <Screen back="/bienvenue" gap={2}>
        <Typography variant="h5">{t("La connexion avec Google n'a pas abouti", "Signing in with Google didn't complete")}</Typography>
        <Typography variant="body2">{erreur ? t(`Google a répondu : « ${erreur} ».`, `Google replied: "${erreur}".`) : t("Google n'a pas rendu la main à temps.", "Google didn't hand back in time.")}</Typography>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" onClick={() => navigate("/bienvenue", { replace: true })}>{t("Revenir à l'entrée", "Back to sign in")}</Button>
      </Screen>
    );
  }
  return (
    <Screen>
      <Stack sx={{ flex: 1 }} alignItems="center" justifyContent="center" gap={2}>
        <CircularProgress />
        <Typography variant="body1">{t("Connexion avec Google…", "Signing in with Google…")}</Typography>
      </Stack>
    </Screen>
  );
}
