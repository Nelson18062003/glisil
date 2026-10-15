import AddRounded from "@mui/icons-material/AddRounded";
import LockRounded from "@mui/icons-material/LockRounded";
import { Box, Button, Divider, Typography } from "@mui/material";
import { Amount, Card, Chips, Dot, Keypad, Line, List, Row, Screen } from "../ui";

export function SortirMontant() {
  return (
    <Screen title="Sortir des XAF" back="/client/accueil" gap={1.5}>
      <Amount value="500 000" unit="XAFe" hint="Disponible : 3 250 000 XAFe" />
      <Chips items={["100 000", "500 000", "Tout"]} selected="500 000" />
      <Box sx={{ flex: 1 }} />
      <Keypad />
      <Button variant="contained" href="/client/sortir/destination">
        Continuer
      </Button>
    </Screen>
  );
}

export function SortirDestination() {
  return (
    <Screen title="Vers quel numéro ?" back="/client/sortir/montant">
      <List>
        <Row badge="mtn" primary="6 77 12 34 56" secondary="MTN MoMo · vérifié" selected href="/client/sortir/recap" />
        <Row badge="om" primary="6 99 87 65 43" secondary="Orange Money · vérifié" href="/client/sortir/recap" />
        <Row icon={<AddRounded />} tone="green" primary="Ajouter un numéro" secondary="Actif après 24 h" />
      </List>
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" href="/client/sortir/recap">
        Continuer
      </Button>
    </Screen>
  );
}

export function SortirRecap() {
  return (
    <Screen title="Vérifiez" back="/client/sortir/destination">
      <Card>
        <Line label="Montant" value="500 000 XAFe" />
        <Line label="Frais (0,5 %)" value="2 500" />
        <Divider />
        <Line label="Vous recevez" value="497 500 XAF" strong />
        <Line label="Vers" value="MTN · 6 77 12 34 56" />
        <Line
          label="Délai habituel"
          value={
            <>
              <Dot tone="green" />
              40 s
            </>
          }
        />
      </Card>
      <Typography variant="body2" textAlign="center">
        Les XAFe sont bloqués à la confirmation et détruits quand le transfert est parti.
      </Typography>
      <Box sx={{ flex: 1 }} />
      <Button variant="contained" startIcon={<LockRounded />} href="/client/accueil">
        Confirmer avec mon code
      </Button>
    </Screen>
  );
}
