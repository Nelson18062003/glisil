/*
 * Entrer dans l'administration (0035) : l'adresse et le mot de passe, puis le
 * code de l'application d'authentification. La première fois : choisir son
 * mot de passe (adresse invitée), confirmer l'adresse par un code e-mail,
 * ajouter l'application, noter dix codes de secours. Une adresse invitée
 * devient administrateur à la fin (entrer_administration) ; une autre est
 * refusée. Les étapes suivent noyau/entree.ts ; la base revérifie tout.
 */
import ContentCopyRounded from "@mui/icons-material/ContentCopyRounded";
import DownloadRounded from "@mui/icons-material/DownloadRounded";
import LaunchRounded from "@mui/icons-material/LaunchRounded";
import { Box, Button, Checkbox, CircularProgress, FormControlLabel, Link, Paper, Stack, TextField, Typography } from "@mui/material";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useGuichet } from "../guichet";
import { CODE_DEMO, COMPTES_DEMO, MOT_DE_PASSE_DEMO } from "../guichet/demo";
import type { Enrolement } from "../guichet/guichet";
import { MOT_DE_PASSE_MIN, motDePasseValide, phaseAdmin, type PhaseAdmin } from "../noyau/entree";
import { useSession } from "../session/session";
import { Erreur, Marque, NomGlisil } from "../ui";

const LONGUEUR_CODE = 6;
const ATTENTE_RENVOI_S = 60;
const emailValide = (e: string) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e.trim());
const sixChiffres = (s: string) => s.replace(/\D/g, "").slice(0, LONGUEUR_CODE);

/* « mot de passe oublié » survit à un rechargement : la session ouverte par son code n'ouvre que ce détour */
const CLE_RECUPERATION = "glisil-admin.recuperation";
const enRecuperation = () => { try { return sessionStorage.getItem(CLE_RECUPERATION) === "1"; } catch { return false; } };
const poserRecuperation = (oui: boolean) => { try { if (oui) sessionStorage.setItem(CLE_RECUPERATION, "1"); else sessionStorage.removeItem(CLE_RECUPERATION); } catch { /* le détour vit le temps de la page */ } };

/** Ce qu'on voit sans session : se connecter, première connexion, son code e-mail, mot de passe oublié. */
type Anonyme = "connexion" | "premiere" | "code_email" | "oubli" | "oubli_code";

export function Connexion() {
  const session = useSession();
  const guichet = useGuichet();
  const navigate = useNavigate();
  const demo = guichet.mode === "demo";
  const [phase, setPhase] = useState<PhaseAdmin | null>(null);
  const [ecran, setEcran] = useState<Anonyme>("connexion");
  const [email, setEmail] = useState(demo ? "nelson@glisil.com" : "");
  const [mdp, setMdp] = useState(demo ? MOT_DE_PASSE_DEMO : "");
  const mdpEnMemoire = useRef<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<unknown>(null);
  const [annonce, setAnnonce] = useState<string | null>(null);

  /* Relire l'état et mener à l'étape suivante. Quand tout est là : entrer. */
  const avancer = useCallback(async () => {
    const p = phaseAdmin(await guichet.etatAuth(), enRecuperation());
    if (p.phase === "anonyme" && p.raison === "facteur_faible") {
      await guichet.deconnecter().catch(() => undefined);
      setAnnonce("Entrez avec votre mot de passe : un code e-mail seul n'ouvre pas l'administration.");
      setPhase({ phase: "anonyme" });
      return;
    }
    if (p.phase === "pret") {
      const profil = await guichet.entrer();
      session.ouvrir(profil);
      navigate("/", { replace: true });
      return;
    }
    setPhase(p);
  }, [guichet, session, navigate]);

  useEffect(() => { avancer().catch((e) => { setErreur(e); setPhase({ phase: "anonyme" }); }); }, [avancer]);

  /** Un geste : en cours, son erreur, puis on avance. */
  const geste = async (f: () => Promise<void>, puis: "avancer" | "rien" = "avancer") => {
    setEnCours(true); setErreur(null);
    try { await f(); if (puis === "avancer") await avancer(); }
    catch (e) { setErreur(e); }
    finally { setEnCours(false); }
  };

  if (!phase) return <Cadre><CircularProgress sx={{ alignSelf: "center" }} /></Cadre>;

  const pied = demo && (
    <Typography variant="caption" textAlign="center">
      Démonstration · {Object.keys(COMPTES_DEMO).join(" · ")} — mot de passe {MOT_DE_PASSE_DEMO}, codes {CODE_DEMO}.
    </Typography>
  );
  const erreurs = <Erreur erreur={erreur} onFermer={() => setErreur(null)} />;

  /* ------------------------------------------------ avec une session */
  if (phase.phase === "email_a_confirmer") {
    return <Cadre pied={pied}><CodeEmail email={email} enCours={enCours} erreurs={erreurs}
      valider={(c) => geste(() => guichet.confirmerEmail(email, c, mdpEnMemoire.current))}
      renvoyer={() => geste(() => guichet.renvoyerConfirmation(email), "rien")}
      autre={() => void geste(async () => { await guichet.deconnecter(); setEcran("connexion"); })} /></Cadre>;
  }
  if (phase.phase === "deux_facteurs_a_enroler") {
    return <Cadre pied={pied}><Enroler enCours={enCours} erreurs={erreurs} demo={demo}
      confirmer={(id, c) => geste(() => guichet.confirmerDeuxFacteurs(id, c))} enroler={() => guichet.enrolerDeuxFacteurs()} /></Cadre>;
  }
  if (phase.phase === "deux_facteurs_a_verifier" || (phase.phase === "recuperation" && phase.etape === "deux_facteurs")) {
    return <Cadre pied={pied}><CodeApplication enCours={enCours} erreurs={erreurs}
      verifier={(c) => geste(() => guichet.verifierDeuxFacteurs(c))}
      secours={(c) => geste(() => guichet.utiliserCodeDeSecours(c))}
      autre={() => void geste(async () => { poserRecuperation(false); await guichet.deconnecter(); setEcran("connexion"); })} /></Cadre>;
  }
  if (phase.phase === "codes_a_noter") {
    return <Cadre pied={pied}><Codes email={email} enCours={enCours} erreurs={erreurs}
      generer={() => guichet.genererCodesDeSecours()} confirmer={() => geste(() => guichet.confirmerCodesDeSecours())} /></Cadre>;
  }
  if (phase.phase === "mot_de_passe_a_choisir" || (phase.phase === "recuperation" && phase.etape === "nouveau")) {
    return <Cadre pied={pied}><NouveauMotDePasse enCours={enCours} erreurs={erreurs}
      choisir={(m) => geste(async () => {
        await guichet.nouveauMotDePasse(m);
        poserRecuperation(false);
        setMdp(""); setAnnonce("Mot de passe changé. Entrez avec le nouveau.");
        setEcran("connexion");
      })} /></Cadre>;
  }

  /* ---------------------------------------------------- sans session */
  const champEmail = <TextField label="Adresse e-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value.replace(/\s/g, ""))} fullWidth autoFocus autoComplete="username" />;

  if (ecran === "premiere") {
    return (
      <Cadre pied={pied} onSubmit={() => { if (emailValide(email) && motDePasseValide(mdp)) void geste(async () => { await guichet.premiereConnexion(email, mdp); mdpEnMemoire.current = mdp; setEcran("code_email"); }, "rien"); }}>
        <Typography variant="body2" textAlign="center">Première connexion : l'adresse à laquelle vous avez été invité, et le mot de passe que vous choisissez. Un code part ensuite pour confirmer l'adresse.</Typography>
        {champEmail}
        <ChampMdp valeur={mdp} onChange={setMdp} nouveau />
        {erreurs}
        <Button type="submit" variant="contained" disabled={!emailValide(email) || !motDePasseValide(mdp) || enCours}>{enCours ? "Envoi…" : "Choisir ce mot de passe"}</Button>
        <Button size="small" onClick={() => { setEcran("connexion"); setErreur(null); }}>J'ai déjà un mot de passe</Button>
      </Cadre>
    );
  }
  if (ecran === "code_email") {
    return <Cadre pied={pied}><CodeEmail email={email} enCours={enCours} erreurs={erreurs}
      valider={(c) => geste(() => guichet.confirmerEmail(email, c, mdpEnMemoire.current))}
      renvoyer={() => geste(() => guichet.renvoyerConfirmation(email), "rien")}
      autre={() => { setEcran("connexion"); setErreur(null); }} /></Cadre>;
  }
  if (ecran === "oubli") {
    return (
      <Cadre pied={pied} onSubmit={() => { if (emailValide(email)) void geste(async () => { await guichet.motDePasseOublie(email); setEcran("oubli_code"); }, "rien"); }}>
        <Typography variant="body2" textAlign="center">Mot de passe oublié — ou pas encore de mot de passe : un code part à votre adresse. Le code de votre application d'authentification vous sera ensuite demandé.</Typography>
        {champEmail}
        {erreurs}
        <Button type="submit" variant="contained" disabled={!emailValide(email) || enCours}>{enCours ? "Envoi du code…" : "Recevoir un code"}</Button>
        <Button size="small" onClick={() => { setEcran("connexion"); setErreur(null); }}>Revenir</Button>
      </Cadre>
    );
  }
  if (ecran === "oubli_code") {
    return <Cadre pied={pied}><CodeEmail email={email} enCours={enCours} erreurs={erreurs}
      valider={(c) => geste(async () => { await guichet.verifierCodeDeReinitialisation(email, c); poserRecuperation(true); })}
      renvoyer={() => geste(() => guichet.motDePasseOublie(email), "rien")}
      autre={() => { setEcran("oubli"); setErreur(null); }} /></Cadre>;
  }

  return (
    <Cadre pied={pied} onSubmit={() => { if (emailValide(email) && mdp) void geste(async () => { mdpEnMemoire.current = mdp; setAnnonce(null); await guichet.connecter(email, mdp); }); }}>
      {annonce && <Typography variant="body2" color="primary" textAlign="center" role="status">{annonce}</Typography>}
      {champEmail}
      <ChampMdp valeur={mdp} onChange={setMdp} />
      {erreurs}
      <Button type="submit" variant="contained" disabled={!emailValide(email) || !mdp || enCours}>{enCours ? "Connexion…" : "Se connecter"}</Button>
      <Stack direction="row" justifyContent="space-between" flexWrap="wrap" gap={1}>
        <Button size="small" onClick={() => { setEcran("premiere"); setErreur(null); setMdp(""); }}>Première connexion</Button>
        <Button size="small" color="inherit" sx={{ color: "text.secondary" }} onClick={() => { setEcran("oubli"); setErreur(null); }}>Mot de passe oublié</Button>
      </Stack>
    </Cadre>
  );
}

/* ------------------------------------------------------------ les pièces */

function Cadre({ children, pied, onSubmit }: { children: ReactNode; pied?: ReactNode; onSubmit?: () => void }) {
  return (
    <Box sx={{ minHeight: "100dvh", display: "grid", placeItems: "center", bgcolor: "background.default", p: 2 }}>
      <Paper component="form" onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}
        sx={{ p: 4, borderRadius: 6, width: "100%", maxWidth: 440, display: "flex", flexDirection: "column", gap: 2.5 }}>
        <Stack alignItems="center" gap={1}>
          <Marque size={64} />
          <NomGlisil size={30} />
          <Typography variant="overline">Administration</Typography>
        </Stack>
        {children}
        {pied}
      </Paper>
    </Box>
  );
}

function ChampMdp({ valeur, onChange, nouveau }: { valeur: string; onChange: (v: string) => void; nouveau?: boolean }) {
  const faible = nouveau && valeur.length > 0 && !motDePasseValide(valeur);
  return (
    <TextField label={nouveau ? "Nouveau mot de passe" : "Mot de passe"} type="password" value={valeur} onChange={(e) => onChange(e.target.value.slice(0, 200))} fullWidth
      autoComplete={nouveau ? "new-password" : "current-password"} error={faible}
      helperText={nouveau ? `${MOT_DE_PASSE_MIN} caractères au moins, des lettres et des chiffres` : " "} />
  );
}

function ChampCode({ valeur, onChange, label, onComplet, disabled }: { valeur: string; onChange: (v: string) => void; label: string; onComplet?: (c: string) => void; disabled?: boolean }) {
  return (
    <TextField value={valeur} autoFocus fullWidth placeholder={"•".repeat(LONGUEUR_CODE)} inputMode="numeric" autoComplete="one-time-code" disabled={disabled}
      onChange={(e) => { const c = sixChiffres(e.target.value); onChange(c); if (c.length === LONGUEUR_CODE) onComplet?.(c); }}
      slotProps={{ htmlInput: { maxLength: 7, "aria-label": label, style: { textAlign: "center", fontSize: 30, letterSpacing: "0.45em", paddingLeft: "0.45em", fontVariantNumeric: "tabular-nums" } } }} />
  );
}

function CodeEmail({ email, enCours, erreurs, valider, renvoyer, autre }: { email: string; enCours: boolean; erreurs: ReactNode; valider: (c: string) => Promise<void>; renvoyer: () => Promise<void>; autre: () => void }) {
  const [code, setCode] = useState("");
  const [reste, setReste] = useState(ATTENTE_RENVOI_S);
  useEffect(() => { if (reste <= 0) return; const t = setTimeout(() => setReste((r) => r - 1), 1000); return () => clearTimeout(t); }, [reste]);
  return (
    <>
      <Typography variant="body2" textAlign="center">Code envoyé à <b style={{ overflowWrap: "anywhere" }}>{email}</b>. Il arrive en moins d'une minute ; regardez aussi les courriers indésirables.</Typography>
      <ChampCode valeur={code} onChange={setCode} label="Code reçu par e-mail" disabled={enCours} onComplet={(c) => void valider(c).finally(() => setCode(""))} />
      {erreurs}
      <Button variant="contained" disabled={code.length < LONGUEUR_CODE || enCours} onClick={() => void valider(code)}>{enCours ? "Vérification…" : "Continuer"}</Button>
      <Stack direction="row" justifyContent="space-between">
        <Button size="small" disabled={reste > 0 || enCours} onClick={() => void renvoyer().then(() => setReste(ATTENTE_RENVOI_S))}>{reste > 0 ? `Renvoyer dans ${reste} s` : "Renvoyer le code"}</Button>
        <Button size="small" color="inherit" sx={{ color: "text.secondary" }} onClick={autre}>Changer d'adresse</Button>
      </Stack>
    </>
  );
}

function Enroler({ enCours, erreurs, demo, enroler, confirmer }: { enCours: boolean; erreurs: ReactNode; demo: boolean; enroler: () => Promise<Enrolement>; confirmer: (id: string, c: string) => Promise<void> }) {
  const [e, setE] = useState<Enrolement | null>(null);
  const [echec, setEchec] = useState<unknown>(null);
  const [code, setCode] = useState("");
  const fait = useRef(false);
  useEffect(() => { if (fait.current) return; fait.current = true; enroler().then(setE, setEchec); }, [enroler]);
  const cle = e?.secret.replace(/(.{4})/g, "$1 ").trim();
  return (
    <>
      <Typography variant="body2" textAlign="center">La double authentification est obligatoire. Ajoutez Glisil Administration dans Google Authenticator ou Microsoft Authenticator, puis tapez les six chiffres qu'elle affiche.</Typography>
      {echec ? <Erreur erreur={echec} onFermer={() => setEchec(null)} /> : !e ? <CircularProgress sx={{ alignSelf: "center" }} /> : (
        <Stack gap={1.5} alignItems="center">
          {e.qr && <Box component="img" src={e.qr} alt="Code QR de la clé" sx={{ width: 180, height: 180, borderRadius: 2, bgcolor: "#fff" }} />}
          <Button component="a" href={e.uri} variant="outlined" size="small" startIcon={<LaunchRounded />}>Ouvrir l'application (sur ce téléphone)</Button>
          <Typography variant="caption">Ou recopiez la clé :</Typography>
          <Stack direction="row" gap={1} alignItems="center">
            <Typography data-cle-totp sx={{ fontFamily: "Roboto Mono, monospace", fontWeight: 600, wordBreak: "break-all" }}>{cle}</Typography>
            <Button size="small" startIcon={<ContentCopyRounded />} onClick={() => void navigator.clipboard?.writeText(e.secret).catch(() => undefined)}>Copier</Button>
          </Stack>
        </Stack>
      )}
      <ChampCode valeur={code} onChange={setCode} label="Code de l'application d'authentification" disabled={!e || enCours}
        onComplet={(c) => e && void confirmer(e.facteurId, c).finally(() => setCode(""))} />
      {demo && <Typography variant="caption" textAlign="center">Démonstration : l'application affiche {CODE_DEMO}.</Typography>}
      {erreurs}
      <Button variant="contained" disabled={!e || code.length < LONGUEUR_CODE || enCours} onClick={() => e && void confirmer(e.facteurId, code)}>{enCours ? "Vérification…" : "Activer"}</Button>
    </>
  );
}

function CodeApplication({ enCours, erreurs, verifier, secours, autre }: { enCours: boolean; erreurs: ReactNode; verifier: (c: string) => Promise<void>; secours: (c: string) => Promise<void>; autre: () => void }) {
  const [code, setCode] = useState("");
  const [perdu, setPerdu] = useState(false);
  const [cs, setCs] = useState("");
  if (perdu) {
    return (
      <>
        <Typography variant="body2" textAlign="center">Téléphone perdu : un de vos dix codes de secours retire l'ancienne application. Vous en ajouterez une nouvelle tout de suite après.</Typography>
        <TextField label="Code de secours" value={cs} onChange={(e) => setCs(e.target.value.toUpperCase().slice(0, 14))} fullWidth autoFocus inputProps={{ style: { fontFamily: "Roboto Mono, monospace", letterSpacing: "0.1em" } }} />
        {erreurs}
        <Button variant="contained" disabled={cs.replace(/[\s-]/g, "").length < 10 || enCours} onClick={() => void secours(cs)}>{enCours ? "Vérification…" : "Utiliser ce code"}</Button>
        <Button size="small" onClick={() => setPerdu(false)}>Revenir au code de l'application</Button>
      </>
    );
  }
  return (
    <>
      <Typography variant="body2" textAlign="center">Le code à six chiffres affiché maintenant par votre application d'authentification.</Typography>
      <ChampCode valeur={code} onChange={setCode} label="Code de l'application d'authentification" disabled={enCours} onComplet={(c) => void verifier(c).finally(() => setCode(""))} />
      {erreurs}
      <Button variant="contained" disabled={code.length < LONGUEUR_CODE || enCours} onClick={() => void verifier(code)}>{enCours ? "Vérification…" : "Entrer"}</Button>
      <Stack direction="row" justifyContent="space-between">
        <Link component="button" type="button" variant="body2" onClick={() => setPerdu(true)}>J'ai perdu mon téléphone</Link>
        <Button size="small" color="inherit" sx={{ color: "text.secondary" }} onClick={autre}>Changer de compte</Button>
      </Stack>
    </>
  );
}

function Codes({ email, enCours, erreurs, generer, confirmer }: { email: string; enCours: boolean; erreurs: ReactNode; generer: () => Promise<string[]>; confirmer: () => Promise<void> }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [echec, setEchec] = useState<unknown>(null);
  const [note, setNote] = useState(false);
  const fait = useRef(false);
  useEffect(() => { if (fait.current) return; fait.current = true; generer().then(setCodes, setEchec); }, [generer]);
  const texte = codes ? `Glisil Administration · codes de secours de ${email}\nChaque code ne sert qu'une fois. Gardez-les loin de votre téléphone.\n\n${codes.join("\n")}\n` : "";
  const telecharger = () => {
    const url = URL.createObjectURL(new Blob([texte], { type: "text/plain;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "glisil-admin-codes-de-secours.txt" });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return (
    <>
      <Typography variant="body2" textAlign="center">Vos dix codes de secours. Si vous perdez votre téléphone, l'un d'eux vous rend l'accès. Notez-les sur papier ou gardez le fichier ailleurs que sur ce téléphone : ils ne s'afficheront plus.</Typography>
      {echec ? <Erreur erreur={echec} onFermer={() => setEchec(null)} /> : !codes ? <CircularProgress sx={{ alignSelf: "center" }} /> : (
        <>
          <Paper variant="outlined" data-codes-de-secours sx={{ p: 2, borderRadius: 4, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1 }}>
            {codes.map((c) => <Typography key={c} sx={{ fontFamily: "Roboto Mono, monospace", fontWeight: 600, textAlign: "center" }}>{c.length === 10 ? `${c.slice(0, 5)}-${c.slice(5)}` : c}</Typography>)}
          </Paper>
          <Stack direction="row" gap={1}>
            <Button variant="outlined" startIcon={<ContentCopyRounded />} sx={{ flex: 1 }} onClick={() => void navigator.clipboard?.writeText(texte).catch(() => undefined)}>Copier</Button>
            <Button variant="outlined" startIcon={<DownloadRounded />} sx={{ flex: 1 }} onClick={telecharger}>Télécharger</Button>
          </Stack>
        </>
      )}
      <FormControlLabel control={<Checkbox checked={note} onChange={(e) => setNote(e.target.checked)} disabled={!codes} />} label={<Typography variant="body2">J'ai noté ou enregistré mes codes</Typography>} />
      {erreurs}
      <Button variant="contained" disabled={!codes || !note || enCours} onClick={() => void confirmer()}>{enCours ? "Enregistrement…" : "Continuer"}</Button>
    </>
  );
}

function NouveauMotDePasse({ enCours, erreurs, choisir }: { enCours: boolean; erreurs: ReactNode; choisir: (m: string) => Promise<void> }) {
  const [m, setM] = useState("");
  const [c, setC] = useState("");
  const pret = motDePasseValide(m) && m === c;
  return (
    <>
      <Typography variant="body2" textAlign="center">Choisissez votre mot de passe. Toutes vos sessions se ferment ensuite : vous entrerez avec lui.</Typography>
      <ChampMdp valeur={m} onChange={setM} nouveau />
      <TextField label="Le même, une seconde fois" type="password" value={c} onChange={(e) => setC(e.target.value.slice(0, 200))} fullWidth autoComplete="new-password"
        error={c.length > 0 && c !== m} helperText={c.length > 0 && c !== m ? "Les deux mots de passe ne sont pas les mêmes." : " "} />
      {erreurs}
      <Button variant="contained" disabled={!pret || enCours} onClick={() => void choisir(m)}>{enCours ? "Enregistrement…" : "Choisir ce mot de passe"}</Button>
    </>
  );
}
