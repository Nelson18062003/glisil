/*
 * Entrer dans l'administration, sans mot de passe : l'adresse e-mail, puis le
 * code à six chiffres qu'elle reçoit. Une adresse invitée devient
 * administrateur à son premier code ; une autre est refusée.
 */
import { Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGuichet } from "../guichet";
import { CODE_DEMO, COMPTES_DEMO } from "../guichet/demo";
import { useSession } from "../session/session";
import { Erreur, Marque, NomGlisil } from "../ui";

const LONGUEUR_CODE = 6;
const ATTENTE_RENVOI_S = 60;
const emailValide = (e: string) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e.trim());

export function Connexion() {
  const session = useSession();
  const guichet = useGuichet();
  const navigate = useNavigate();
  const [email, setEmail] = useState(guichet.mode === "demo" ? "nelson@glisil.com" : "");
  const [etape, setEtape] = useState<"email" | "code">("email");
  const [code, setCode] = useState("");
  const [reste, setReste] = useState(0);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<unknown>(null);

  useEffect(() => {
    if (reste <= 0) return;
    const t = setTimeout(() => setReste((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [reste]);

  const envoyer = async () => {
    setEnCours(true); setErreur(null);
    try { await session.demanderCode(email.trim().toLowerCase()); setEtape("code"); setCode(""); setReste(ATTENTE_RENVOI_S); }
    catch (e) { setErreur(e); }
    finally { setEnCours(false); }
  };

  const entrer = async (c: string) => {
    setEnCours(true); setErreur(null);
    try { await session.connecter(email.trim().toLowerCase(), c); navigate("/", { replace: true }); }
    catch (e) { setErreur(e); setCode(""); }
    finally { setEnCours(false); }
  };

  return (
    <Box sx={{ minHeight: "100dvh", display: "grid", placeItems: "center", bgcolor: "background.default", p: 2 }}>
      <Paper component="form" onSubmit={(e) => { e.preventDefault(); if (etape === "email") { if (emailValide(email)) void envoyer(); } else if (code.length === LONGUEUR_CODE) void entrer(code); }}
        sx={{ p: 4, borderRadius: 6, width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 2.5 }}>
        <Stack alignItems="center" gap={1}>
          <Marque size={64} />
          <NomGlisil size={30} />
          <Typography variant="overline">Administration</Typography>
        </Stack>
        {etape === "email" ? (
          <>
            <Typography variant="body2" textAlign="center">Votre adresse e-mail d'administrateur. Pas de mot de passe : un code à six chiffres vous est envoyé.</Typography>
            <TextField label="Adresse e-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value.replace(/\s/g, ""))} fullWidth autoFocus autoComplete="username" />
            <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
            <Button type="submit" variant="contained" disabled={!emailValide(email) || enCours}>{enCours ? "Envoi du code…" : "Recevoir mon code"}</Button>
          </>
        ) : (
          <>
            <Typography variant="body2" textAlign="center">
              Code envoyé à <b style={{ overflowWrap: "anywhere" }}>{email}</b>. Il arrive en moins d'une minute ; regardez aussi les courriers indésirables.
            </Typography>
            <TextField value={code} autoFocus fullWidth placeholder={"•".repeat(LONGUEUR_CODE)} inputMode="numeric" autoComplete="one-time-code" disabled={enCours}
              onChange={(e) => { const c = e.target.value.replace(/\D/g, "").slice(0, LONGUEUR_CODE); setCode(c); if (c.length === LONGUEUR_CODE) void entrer(c); }}
              slotProps={{ htmlInput: { maxLength: LONGUEUR_CODE, "aria-label": "Code reçu par e-mail", style: { textAlign: "center", fontSize: 30, letterSpacing: "0.45em", paddingLeft: "0.45em", fontVariantNumeric: "tabular-nums" } } }} />
            <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
            <Button type="submit" variant="contained" disabled={code.length < LONGUEUR_CODE || enCours}>{enCours ? "Vérification…" : "Entrer"}</Button>
            <Stack direction="row" justifyContent="space-between">
              <Button size="small" disabled={reste > 0 || enCours} onClick={() => void envoyer()}>{reste > 0 ? `Renvoyer dans ${reste} s` : "Renvoyer le code"}</Button>
              <Button size="small" color="inherit" sx={{ color: "text.secondary" }} onClick={() => { setEtape("email"); setErreur(null); }}>Changer d'adresse</Button>
            </Stack>
          </>
        )}
        {guichet.mode === "demo" && (
          <Typography variant="caption" textAlign="center">
            Démonstration · adresses : {Object.keys(COMPTES_DEMO).join(" · ")} — code {CODE_DEMO}.
          </Typography>
        )}
      </Paper>
    </Box>
  );
}
