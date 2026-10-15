import { Avatar, Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import { Screen } from "../ui";

export function Connexion() {
  return (
    <Screen>
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 4 }}>
        <Stack alignItems="center" gap={2}>
          <Avatar sx={{ width: 80, height: 80, bgcolor: "primary.main", fontSize: 36, fontWeight: 700 }}>X</Avatar>
          <Typography variant="h5">XAFe Exchange</Typography>
          <Typography variant="body2" textAlign="center">
            Vos XAF, sur la blockchain.
          </Typography>
        </Stack>
        <TextField
          label="Numéro de téléphone"
          defaultValue="6 77 12 34 56"
          type="tel"
          fullWidth
          slotProps={{ input: { startAdornment: <Typography sx={{ mr: 1, color: "text.secondary" }}>+237</Typography> } }}
        />
      </Box>
      <Stack gap={1}>
        <Button variant="contained" href="/client/code">
          Continuer
        </Button>
        <Button variant="text">Créer un compte</Button>
      </Stack>
    </Screen>
  );
}

export function Code() {
  const digits = ["4", "8", "2", "", "", ""];
  return (
    <Screen title="Code reçu par SMS" back="/client/connexion">
      <Typography variant="body2">Envoyé au 6 77 12 34 56.</Typography>
      <Stack direction="row" gap={1} justifyContent="center" my={3}>
        {digits.map((d, i) => (
          <Paper
            key={i}
            sx={{
              width: 52,
              height: 64,
              borderRadius: 3,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
              fontWeight: 600,
              border: 2,
              borderColor: i === 3 ? "primary.main" : "transparent",
            }}
          >
            {d}
          </Paper>
        ))}
      </Stack>
      <Button variant="text" size="small">
        Renvoyer le code
      </Button>
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" href="/client/accueil">
        Valider
      </Button>
    </Screen>
  );
}
