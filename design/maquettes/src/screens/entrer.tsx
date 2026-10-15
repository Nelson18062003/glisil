import AccountBalanceRounded from "@mui/icons-material/AccountBalanceRounded";
import ContentCopyRounded from "@mui/icons-material/ContentCopyRounded";
import { Box, Button, IconButton, Stack, Typography } from "@mui/material";
import { Amount, Card, Chips, Keypad, Line, List, Row, Screen, Success } from "../ui";

export function EntrerOperateur() {
  return (
    <Screen title="Entrer des XAF" back="/client/accueil">
      <Typography variant="body2">D'où vient l'argent ?</Typography>
      <List>
        <Row badge="mtn" primary="MTN MoMo" secondary="1 000 000 XAF max par transfert" href="/client/entrer/montant" />
        <Row badge="om" primary="Orange Money" secondary="500 000 XAF max par transfert" href="/client/entrer/montant" />
        <Row icon={<AccountBalanceRounded />} tone="neutral" primary="Virement bancaire" secondary="Bientôt" />
      </List>
    </Screen>
  );
}

export function EntrerMontant() {
  return (
    <Screen title="Montant" back="/client/entrer/operateur" gap={1.5}>
      <Amount value="1 000 000" unit="XAF" hint="Vous recevez 1 000 000 XAFe · sans frais" />
      <Chips items={["500 000", "1 000 000", "5 000 000"]} selected="1 000 000" />
      <Box sx={{ flex: 1 }} />
      <Keypad />
      <Button variant="contained" href="/client/entrer/payer">
        Continuer
      </Button>
    </Screen>
  );
}

export function EntrerPayer() {
  return (
    <Screen title="Payez par MTN MoMo" back="/client/entrer/montant">
      <Card>
        <Typography variant="body2">Envoyez</Typography>
        <Typography variant="h4">1 000 000 XAF</Typography>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ bgcolor: "background.default", borderRadius: 3, px: 2, py: 1 }}>
          <Stack>
            <Typography variant="caption">au numéro</Typography>
            <Typography variant="h6" sx={{ fontVariantNumeric: "tabular-nums" }}>
              6XX XX XX XX
            </Typography>
          </Stack>
          <IconButton aria-label="Copier le numéro">
            <ContentCopyRounded />
          </IconButton>
        </Stack>
        <Line label="Depuis votre numéro" value="6 77 12 34 56" />
        <Line label="Référence" value="XAFe-DP-000418" />
      </Card>
      <Typography variant="body2" textAlign="center">
        Vos XAFe arrivent dès que le SMS de MTN est lu, en général en moins de 10 s.
      </Typography>
      <Box sx={{ flex: 1 }} />
      <Stack gap={1}>
        <Button variant="contained" href="/client/entrer/confirme">
          J'ai payé
        </Button>
        <Button variant="outlined">Ouvrir MTN MoMo (*126#)</Button>
      </Stack>
    </Screen>
  );
}

export function EntrerConfirme() {
  return (
    <Success
      title="XAFe crédités"
      amount="+1 000 000 XAFe"
      caption="À 14:02, 2 s après le SMS de MTN."
      primary={{ label: "Aller au marché", href: "/client/marche" }}
      secondary={{ label: "Retour à l'accueil", href: "/client/accueil" }}
    >
      <Card>
        <Line label="Référence XAFe" value="XAFe-DP-000418" />
        <Line label="Référence MTN" value="1234567890" />
      </Card>
    </Success>
  );
}
