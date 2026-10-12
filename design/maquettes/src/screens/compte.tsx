import HelpOutlineRounded from "@mui/icons-material/HelpOutlineRounded";
import KeyRounded from "@mui/icons-material/KeyRounded";
import PhoneAndroidRounded from "@mui/icons-material/PhoneAndroidRounded";
import ShieldOutlined from "@mui/icons-material/ShieldOutlined";
import VerifiedRounded from "@mui/icons-material/VerifiedRounded";
import { Avatar, Button, Chip, Stack, Typography } from "@mui/material";
import { tones } from "../theme";
import { List, Row, Screen } from "../ui";

export function Compte() {
  return (
    <Screen tab="compte" title="Compte">
      <Stack alignItems="center" gap={1} py={2}>
        <Avatar sx={{ width: 88, height: 88, bgcolor: "primary.main", fontSize: 32, fontWeight: 600 }}>NS</Avatar>
        <Typography variant="h6">Nelson S.</Typography>
        <Typography variant="body2">NORTON GAUSS BONZINI SARL</Typography>
        <Chip icon={<VerifiedRounded />} label="Palier 2 · entreprise vérifiée" sx={{ bgcolor: tones.green.bg, color: tones.green.fg, "& .MuiChip-icon": { color: tones.green.fg } }} />
      </Stack>
      <List>
        <Row icon={<PhoneAndroidRounded />} tone="green" primary="Mes numéros MoMo" secondary="MTN, Orange · 2 vérifiés" href="/client/sortir/destination" />
        <Row icon={<VerifiedRounded />} tone="amber" primary="Paliers et limites" secondary="Palier 2 · sans plafond plateforme" href="#" />
        <Row icon={<ShieldOutlined />} tone="blue" primary="Sécurité" secondary="Code, clé d'accès, appareils" href="#" />
        <Row icon={<KeyRounded />} tone="neutral" primary="Accès API" secondary="Pour les desks" href="#" />
        <Row icon={<HelpOutlineRounded />} tone="neutral" primary="Aide" href="#" />
      </List>
      <Button variant="text" color="error">
        Se déconnecter
      </Button>
    </Screen>
  );
}
