/*
 * Entrer dans l'application, sans mot de passe :
 *   adresse e-mail → code reçu par e-mail → (inscription, la première fois) →
 *   code secret des gestes d'argent → bienvenue → Accueil.
 * Et le verrou, à chaque ouverture : le code secret, ou l'empreinte par la coque.
 */
import BoltRounded from "@mui/icons-material/BoltRounded";
import CheckRounded from "@mui/icons-material/CheckRounded";
import LockOutlined from "@mui/icons-material/LockOutlined";
import LogoutRounded from "@mui/icons-material/LogoutRounded";
import MarkEmailReadOutlined from "@mui/icons-material/MarkEmailReadOutlined";
import ShieldOutlined from "@mui/icons-material/ShieldOutlined";
import VisibilityOutlined from "@mui/icons-material/VisibilityOutlined";
import { Avatar, Box, Button, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useGuichet } from "../../guichet";
import { CODE_DEMO, EMAIL_VITRINE } from "../../guichet/demo";
import type { Compte } from "../../guichet/types";
import { lisible } from "../../noyau/erreurs";
import { heure } from "../../noyau/format";
import { emailNormalise, emailValide } from "../../noyau/identite";
import { t } from "../../noyau/langue";
import { useSession } from "../../session/session";
import { tones } from "../../theme";
import { ChoixDeLangue, FeuilleErreur, Keypad, Marque, NomGlisil, Points, Screen } from "../../ui";
import { useGesteUnique } from "../../ui/gestes";

/** la longueur du code envoyé par e-mail (réglage « Email OTP Length » de Supabase) */
export const LONGUEUR_CODE = 6;
/** entre deux codes, comme Supabase l'impose */
const ATTENTE_RENVOI_S = 60;

const CLE_EMAIL = "glisil.bienvenue.email";
const lireEmail = () => { try { return sessionStorage.getItem(CLE_EMAIL) ?? ""; } catch { return ""; } };
const garderEmail = (e: string) => { try { sessionStorage.setItem(CLE_EMAIL, e); } catch { /* sans stockage, on redemande l'adresse */ } };

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

/** La porte d'entrée : l'adresse e-mail, et rien d'autre. */
export function Bienvenue() {
  const guichet = useGuichet();
  const navigate = useNavigate();
  const [email, setEmail] = useState(lireEmail);
  const [vu, setVu] = useState(false);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();
  const valide = emailValide(email);

  const continuer = () =>
    lancer(async () => {
      const e = emailNormalise(email);
      await guichet.demanderCode(e);
      garderEmail(e);
      try { sessionStorage.setItem(`${CLE_EMAIL}.envoye`, String(Date.now())); } catch { /* idem */ }
      navigate("/bienvenue/code");
    });

  return (
    /* Sur un téléphone, la marque en haut et le champ dessous ; sur un ordinateur, côte à côte,
       la marque sur toute la hauteur à gauche — le champ reste une colonne courte, sous les yeux. */
    <Box sx={{ width: "100%", maxWidth: { xs: 480, md: "none" }, mx: "auto", minHeight: "100dvh", bgcolor: "background.default",
               display: { xs: "flex", md: "grid" }, flexDirection: "column", gridTemplateColumns: { md: "minmax(0,1fr) minmax(0,1fr)" } }}>
      <Box sx={{ bgcolor: "primary.main", color: "#FFFFFF", px: { xs: 3, md: 8 }, pt: { xs: "calc(env(safe-area-inset-top) + 48px)", md: 8 }, pb: { xs: 5, md: 8 },
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
        sx={{ flex: 1, px: 2, pt: { xs: 3, md: 0 }, pb: "calc(env(safe-area-inset-bottom) + 24px)", display: "flex", flexDirection: "column", gap: 2.5,
              justifyContent: { md: "center" }, width: "100%", maxWidth: { md: 440 }, mx: { md: "auto" } }}>
        <Stack gap={0.5}>
          <Typography variant="h5">{t("Entrer ou créer un compte", "Sign in or create an account")}</Typography>
          <Typography variant="body2">{t("Votre adresse e-mail suffit. Pas de mot de passe : nous vous envoyons un code à six chiffres.", "All you need is your email address. No password: we'll send you a six-digit code.")}</Typography>
        </Stack>
        <TextField
          label={t("Adresse e-mail", "Email address")}
          value={email}
          onChange={(e) => setEmail(e.target.value.replace(/\s/g, ""))}
          onBlur={() => setVu(true)}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          fullWidth
          autoFocus
          error={vu && email.length > 0 && !valide}
          helperText={vu && email.length > 0 && !valide ? t("Écrivez l'adresse en entier, par exemple awa@exemple.com.", "Enter the full address, for example awa@example.com.") : guichet.mode === "demo" ? t(`Démonstration : ${EMAIL_VITRINE} arrive avec une vie déjà écrite ; le code sera ${CODE_DEMO}.`, `Demo: ${EMAIL_VITRINE} comes with a ready-made history; the code will be ${CODE_DEMO}.`) : " "}
          slotProps={{ input: { sx: { fontSize: 18 } } }}
        />
        <Button type="submit" variant="contained" disabled={!valide || enCours}>
          {enCours ? t("Envoi du code…", "Sending code…") : t("Recevoir mon code", "Get my code")}
        </Button>
        <Stack gap={2} sx={{ mt: 1 }}>
          <Promesse icone={<VisibilityOutlined fontSize="small" />} titre={t("Transparent", "Transparent")} texte={t("Un seul carnet d'ordres, le même prix affiché pour tous.", "One order book, the same price shown to everyone.")} />
          <Promesse icone={<ShieldOutlined fontSize="small" />} titre={t("Sécurisé", "Secure")} texte={t("Chaque XAFe est couvert un pour un ; chaque sortie d'argent demande votre code secret.", "Every XAFe is backed one to one; every withdrawal requires your PIN.")} />
          <Promesse icone={<BoltRounded fontSize="small" />} titre={t("Rapide", "Fast")} texte={t("Vos XAF crédités dès que le paiement MoMo arrive.", "Your XAF are credited as soon as the MoMo payment arrives.")} />
        </Stack>
      </Box>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} onRecommencer={() => void continuer()} />
    </Box>
  );
}

/** Le code reçu par e-mail : il prouve l'adresse. */
export function BienvenueCode() {
  const guichet = useGuichet();
  const session = useSession();
  const navigate = useNavigate();
  const email = lireEmail();
  const [code, setCode] = useState("");
  const [faux, setFaux] = useState(false);
  const [reste, setReste] = useState(() => {
    try { const envoye = Number(sessionStorage.getItem(`${CLE_EMAIL}.envoye`) ?? 0); return Math.max(0, ATTENTE_RENVOI_S - Math.floor((Date.now() - envoye) / 1000)); } catch { return ATTENTE_RENVOI_S; }
  });
  const [renvoye, setRenvoye] = useState(false);
  const champ = useRef<HTMLInputElement>(null);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();

  useEffect(() => { if (!email) navigate("/bienvenue", { replace: true }); }, [email, navigate]);
  useEffect(() => {
    if (reste <= 0) return;
    const minuterie = setTimeout(() => setReste((r) => r - 1), 1000);
    return () => clearTimeout(minuterie);
  }, [reste]);

  const valider = (c: string) =>
    lancer(async () => {
      try {
        const { suite } = await session.connecter(email, c);
        navigate(suite === "inscription" ? "/bienvenue/inscription" : suite === "profil" ? "/bienvenue/profil" : "/", { replace: true });
      } catch (e) {
        setFaux(true);
        setCode("");
        champ.current?.focus();
        if (lisible(e).titre !== t("Ce code ne marche pas", "This code doesn't work")) throw e; // le titre de noyau/erreurs, dans la langue de l'écran
      }
    });

  const renvoyer = () =>
    lancer(async () => {
      await guichet.demanderCode(email);
      try { sessionStorage.setItem(`${CLE_EMAIL}.envoye`, String(Date.now())); } catch { /* idem */ }
      setReste(ATTENTE_RENVOI_S);
      setRenvoye(true);
      setFaux(false);
    });

  const saisir = (brut: string) => {
    const c = brut.replace(/\D/g, "").slice(0, LONGUEUR_CODE);
    setFaux(false);
    setCode(c);
    if (c.length === LONGUEUR_CODE) void valider(c);
  };

  return (
    <Screen back="/bienvenue" gap={2.5}>
      <Avatar sx={{ width: 64, height: 64, bgcolor: tones.green.bg, color: "primary.main" }}><MarkEmailReadOutlined sx={{ fontSize: 32 }} /></Avatar>
      <Stack gap={0.75}>
        <Typography variant="h5">{t("Vérifiez votre boîte e-mail", "Check your inbox")}</Typography>
        <Typography variant="body1">
          {t("Nous avons envoyé un code à six chiffres à ", "We sent a six-digit code to ")}<Box component="b" sx={{ overflowWrap: "anywhere" }}>{email}</Box>.
        </Typography>
      </Stack>
      <TextField
        inputRef={champ}
        value={code}
        onChange={(e) => saisir(e.target.value)}
        placeholder={"•".repeat(LONGUEUR_CODE)}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        fullWidth
        error={faux}
        disabled={enCours}
        helperText={faux ? t("Ce code n'est pas le bon, ou il a expiré. Réessayez ou demandez-en un nouveau.", "This code is wrong or has expired. Try again or request a new one.") : guichet.mode === "demo" ? t(`Démonstration : le code est ${CODE_DEMO}.`, `Demo: the code is ${CODE_DEMO}.`) : t("Le code arrive en moins d'une minute. Regardez aussi vos courriers indésirables.", "The code arrives in under a minute. Check your spam folder too.")}
        slotProps={{ htmlInput: { maxLength: LONGUEUR_CODE, "aria-label": t("Code reçu par e-mail", "Code received by email"), style: { textAlign: "center", fontSize: 34, letterSpacing: "0.5em", fontVariantNumeric: "tabular-nums", paddingLeft: "0.5em" } } }}
      />
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
        <Button variant="text" size="small" disabled={reste > 0 || enCours} onClick={() => void renvoyer()}>
          {reste > 0 ? t(`Renvoyer le code dans ${reste} s`, `Resend code in ${reste}s`) : t("Renvoyer le code", "Resend code")}
        </Button>
        <Button variant="text" size="small" color="inherit" sx={{ color: "text.secondary" }} onClick={() => navigate("/bienvenue")}>{t("Changer d'adresse", "Change address")}</Button>
      </Stack>
      {renvoye && reste > 0 && <Typography variant="body2" role="status" sx={{ color: "primary.main" }}>{t("Un nouveau code est parti.", "A new code is on its way.")}</Typography>}
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" disabled={code.length < LONGUEUR_CODE || enCours} onClick={() => void valider(code)}>
        {enCours ? t("Vérification…", "Verifying…") : t("Valider", "Confirm")}
      </Button>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Screen>
  );
}

/** Le code secret des gestes d'argent, puis la bienvenue. */
export function BienvenueProfil() {
  const guichet = useGuichet();
  const session = useSession();
  const [etape, setEtape] = useState<"code" | "confirmer" | "bienvenue">("code");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [faux, setFaux] = useState(false);
  const [ouvert, setOuvert] = useState<Compte | null>(null);
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();
  const nom = session.compte?.nom ?? "";

  const terminer = (c: string) =>
    lancer(async () => {
      const compte = await guichet.completerProfil({ nom, codeSecret: c });
      setOuvert(compte);
      setEtape("bienvenue");
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

  if (etape === "bienvenue" && ouvert) {
    return (
      <Screen>
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 2, textAlign: "center" }}>
          <Avatar sx={{ width: 88, height: 88, bgcolor: "primary.main", color: "#FFFFFF", "@media (prefers-reduced-motion: no-preference)": { animation: "glisil-pop 420ms cubic-bezier(.2,.9,.3,1.3)" }, "@keyframes glisil-pop": { from: { transform: "scale(.6)", opacity: 0 }, to: { transform: "scale(1)", opacity: 1 } } }}>
            <CheckRounded sx={{ fontSize: 48 }} />
          </Avatar>
          <Typography variant="h5" sx={{ textWrap: "balance" }}>{t(`Bienvenue sur Glisil, ${ouvert.prenom ?? ouvert.nom?.split(" ")[0] ?? ""}`, `Welcome to Glisil, ${ouvert.prenom ?? ouvert.nom?.split(" ")[0] ?? ""}`)}</Typography>
          <Typography variant="body1" sx={{ maxWidth: 340 }}>
            {t("Votre compte est ouvert. Commencez par entrer des XAF par Mobile Money : ils deviennent des XAFe sur votre solde.", "Your account is open. Start by adding XAF via Mobile Money: they become XAFe in your balance.")}
          </Typography>
        </Box>
        <Button variant="contained" onClick={() => session.profilComplete(ouvert)}>{t("Découvrir mon compte", "Explore my account")}</Button>
      </Screen>
    );
  }

  return (
    <Screen title={etape === "code" ? t("Votre code secret", "Your PIN") : t("Confirmez le code", "Confirm the code")} onBack={etape === "confirmer" ? () => { setEtape("code"); setConfirmation(""); } : undefined} gap={1.5}>
      <Typography variant="body2">
        {etape === "code" ? t("Quatre chiffres, que vous seul connaissez. Il protège chaque sortie d'argent et l'ouverture de l'application.", "Four digits that only you know. It protects every withdrawal and unlocks the app.") : t("Tapez-le une seconde fois.", "Enter it a second time.")}
      </Typography>
      <Points longueur={4} saisis={etape === "code" ? code.length : confirmation.length} erreur={faux} />
      {faux && <Typography variant="body2" color="error" textAlign="center">{t("Les deux codes ne sont pas les mêmes. On recommence.", "The two codes don't match. Let's start over.")}</Typography>}
      <Box sx={{ flex: 1 }} />
      <Keypad onKey={touche} triple={null} />
      {enCours && <Typography variant="body2" textAlign="center">{t("Enregistrement…", "Saving…")}</Typography>}
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
        if (r.verrouJusqua) setMessage(t(`Trois codes faux : le compte est verrouillé jusqu'à ${heure(r.verrouJusqua)}.`, `Three wrong codes: your account is locked until ${heure(r.verrouJusqua)}.`));
        else setMessage(t(`Code incorrect. ${r.essaisRestants ?? ""} essai${(r.essaisRestants ?? 0) > 1 ? "s" : ""} avant verrouillage.`, `Wrong code. ${r.essaisRestants ?? ""} attempt${(r.essaisRestants ?? 0) > 1 ? "s" : ""} left before lockout.`));
      }
    }).catch((e) => { setCode(""); setMessage(lisible(e).titre); });

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
        <Typography variant="h6" mt={1}>{t(`Bonjour ${session.compte?.nom?.split(" ")[0] ?? ""}`, `Hello ${session.compte?.nom?.split(" ")[0] ?? ""}`)}</Typography>
        <Typography variant="body2">{t("Votre code secret pour continuer.", "Enter your PIN to continue.")}</Typography>
        <Points longueur={4} saisis={code.length} erreur={faux} />
        {message && <Typography variant="body2" color="error" textAlign="center">{message}</Typography>}
        {enCours && <Typography variant="body2">{t("Vérification…", "Verifying…")}</Typography>}
      </Box>
      <Keypad onKey={touche} triple={null} />
      <Button variant="text" color="inherit" startIcon={<LogoutRounded />} onClick={() => void session.deconnecter()} sx={{ color: "text.secondary" }}>
        {t("Changer de compte", "Switch account")}
      </Button>
    </Screen>
  );
}
