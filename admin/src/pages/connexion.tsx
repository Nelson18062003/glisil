import { Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGuichet } from "../guichet";
import { COMPTES_DEMO } from "../guichet/demo";
import { useSession } from "../session/session";
import { Erreur, Marque } from "../ui";

export function Connexion() {
  const session = useSession();
  const guichet = useGuichet();
  const navigate = useNavigate();
  const [email, setEmail] = useState(guichet.mode === "demo" ? "nelson@glisil.com" : "");
  const [mdp, setMdp] = useState(guichet.mode === "demo" ? "demo" : "");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<unknown>(null);

  const entrer = async () => {
    setEnCours(true); setErreur(null);
    try { await session.connecter(email, mdp); navigate("/", { replace: true }); }
    catch (e) { setErreur(e); }
    finally { setEnCours(false); }
  };

  return (
    <Box sx={{ minHeight: "100dvh", display: "grid", placeItems: "center", bgcolor: "background.default", p: 2 }}>
      <Paper component="form" onSubmit={(e) => { e.preventDefault(); void entrer(); }} sx={{ p: 4, borderRadius: 6, width: 400, display: "flex", flexDirection: "column", gap: 2.5 }}>
        <Stack alignItems="center" gap={1}>
          <Marque size={64} />
          <Typography variant="h6">Glisil · administration</Typography>
          <Typography variant="body2" textAlign="center">Réserves, entrées, sorties, terminaux, clients, marché.</Typography>
        </Stack>
        <TextField label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} fullWidth autoFocus autoComplete="username" />
        <TextField label="Mot de passe" type="password" value={mdp} onChange={(e) => setMdp(e.target.value)} fullWidth autoComplete="current-password" />
        <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
        <Button type="submit" variant="contained" disabled={!email || !mdp || enCours}>{enCours ? "Connexion…" : "Entrer"}</Button>
        {guichet.mode === "demo" && (
          <Typography variant="caption" textAlign="center">
            Démonstration · comptes : {Object.keys(COMPTES_DEMO).join(" · ")} — mot de passe « demo ».
          </Typography>
        )}
      </Paper>
    </Box>
  );
}
