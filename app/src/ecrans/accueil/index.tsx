/*
 * L'Accueil : le solde, trois tuiles, le prix. Rien d'autre.
 */
import ArrowDownwardRounded from "@mui/icons-material/ArrowDownwardRounded";
import ArrowUpwardRounded from "@mui/icons-material/ArrowUpwardRounded";
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded";
import CurrencyBitcoinRounded from "@mui/icons-material/CurrencyBitcoinRounded";
import HourglassTopRounded from "@mui/icons-material/HourglassTopRounded";
import NotificationsNoneRounded from "@mui/icons-material/NotificationsNoneRounded";
import VerifiedUserOutlined from "@mui/icons-material/VerifiedUserOutlined";
import VisibilityOffOutlined from "@mui/icons-material/VisibilityOffOutlined";
import VisibilityOutlined from "@mui/icons-material/VisibilityOutlined";
import { Avatar, Badge as Pastille, Box, Button, ButtonBase, Chip, IconButton, Stack, Typography } from "@mui/material";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useChandelles, useCompte, useCotation, useDepotsEnAttente, useGuichet, useNotifications, useSoldes } from "../../guichet";
import { enTranches, initiales, jourRelatif, prix, quand, xaf } from "../../noyau/format";
import { useSession } from "../../session/session";
import { tones } from "../../theme";
import { Badge, BUY, Card, Icon, List, Masquable, Row, Screen, SELL, Sparkline, Squelette, Tile } from "../../ui";

export function Accueil() {
  const session = useSession();
  const { data: compte } = useCompte();
  const { data: soldes } = useSoldes();
  const { data: cotation } = useCotation();
  const { data: chandelles } = useChandelles(60, 28);
  const { data: enAttente } = useDepotsEnAttente();
  const { data: notifications } = useNotifications();
  const nonLues = notifications?.filter((n) => !n.lue).length ?? 0;

  const totalXaf = soldes && cotation?.dernier != null
    ? soldes.XAFe.disponible + soldes.XAFe.bloque + (soldes.USDT.disponible + soldes.USDT.bloque) * cotation.dernier
    : soldes ? soldes.XAFe.disponible + soldes.XAFe.bloque : null;
  const variation = cotation?.variation24h ?? 0;
  const couleur = variation >= 0 ? BUY : SELL;

  return (
    <Screen tab="accueil" gap={2}>
      <Stack direction="row" alignItems="center" gap={1.5}>
        <ButtonBase component={Link} to="/compte" sx={{ borderRadius: 20 }} aria-label="Mon compte">
          <Avatar sx={{ bgcolor: "primary.main", fontWeight: 600 }}>{initiales(compte?.nom)}</Avatar>
        </ButtonBase>
        <Typography variant="subtitle1" sx={{ flex: 1 }}>Bonjour {compte?.nom?.split(" ")[0] ?? ""}</Typography>
        <IconButton component={Link} to="/notifications" aria-label="Notifications">
          <Pastille badgeContent={nonLues} color="secondary" invisible={nonLues === 0}>
            <NotificationsNoneRounded />
          </Pastille>
        </IconButton>
      </Stack>

      {soldes ? (
        <Card onPrimary>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="body2" sx={{ color: "inherit", opacity: 0.85 }}>Solde total · estimé en XAF</Typography>
            <IconButton size="small" onClick={session.basculerMasque} sx={{ color: "inherit", m: -1 }} aria-label={session.montantsMasques ? "Montrer les montants" : "Masquer les montants"}>
              {session.montantsMasques ? <VisibilityOffOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}
            </IconButton>
          </Stack>
          <Typography variant="h3" sx={{ fontSize: totalXaf !== null && totalXaf >= 1e9 ? 32 : 40 }}>
            <Masquable>{totalXaf === null ? "—" : xaf(totalXaf)}</Masquable> XAF
          </Typography>
          <Stack direction="row" gap={1.5} mt={0.5}>
            <Poche badge="xafe" label="XAFe" valeur={xaf(soldes.XAFe.disponible)} bloque={soldes.XAFe.bloque > 0 ? `${xaf(soldes.XAFe.bloque)} bloqués` : undefined} />
            <Poche badge="usdt" label="USDT" valeur={enTranches(soldes.USDT.disponible, 2)} bloque={soldes.USDT.bloque > 0 ? `${enTranches(soldes.USDT.bloque, 2)} bloqués` : undefined} />
          </Stack>
        </Card>
      ) : (
        <Squelette hauteur={196} />
      )}

      {compte?.verificationEnCours && (
        <Stack direction="row" alignItems="center" gap={1.5} sx={{ bgcolor: tones.blue.bg, color: tones.blue.fg, borderRadius: 4, px: 2, py: 1.25 }}>
          <VerifiedUserOutlined />
          <Typography variant="body2" sx={{ color: "inherit", flex: 1 }}>Vos pièces sont en vérification. On vous prévient dès que c'est fait.</Typography>
        </Stack>
      )}

      {enAttente?.map((d) => (
        <ButtonBase key={d.reference} component={Link} to={`/entrer/transaction/${d.reference}`} sx={{ borderRadius: 4, textAlign: "left" }}>
          <Stack direction="row" alignItems="center" gap={1.5} sx={{ bgcolor: tones.amber.bg, color: tones.amber.fg, borderRadius: 4, px: 2, py: 1.25, width: "100%" }}>
            <HourglassTopRounded />
            <Stack sx={{ flex: 1 }}>
              <Typography fontWeight={600} sx={{ color: "inherit" }}>Dépôt en attente · {d.reference}</Typography>
              <Typography variant="body2" sx={{ color: "inherit", opacity: 0.85 }}>
                {d.declarations.some((x) => x.etat === "attendu") ? "On cherche le SMS de votre paiement…" : "Entrez le transaction ID de votre paiement."}
              </Typography>
            </Stack>
            <ChevronRightRounded />
          </Stack>
        </ButtonBase>
      ))}

      <Stack direction="row" gap={1.5}>
        <Tile icon={<ArrowDownwardRounded />} label="Entrer des XAF" to="/entrer/operateur" tone="green" />
        <Tile icon={<ArrowUpwardRounded />} label="Sortir des XAF" to="/sortir/montant" tone="amber" />
        <Tile icon={<CurrencyBitcoinRounded />} label="Crypto" to="/crypto" tone="blue" />
      </Stack>

      <ButtonBase component={Link} to="/marche" sx={{ textAlign: "left", borderRadius: 6 }}>
        <Card sx={{ width: "100%" }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="body2">USDT/XAFe</Typography>
            {cotation?.variation24h != null && (
              <Chip label={`${variation >= 0 ? "+" : ""}${enTranches(variation, 2)} %`} size="small" sx={{ bgcolor: variation >= 0 ? "#CDEFD9" : "#F9DEDC", color: variation >= 0 ? "#06331B" : "#7A1F17", height: 28 }} />
            )}
          </Stack>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography variant="h4">{cotation?.dernier != null ? prix(cotation.dernier) : "—"}</Typography>
            <ChevronRightRounded sx={{ color: "text.secondary" }} />
          </Stack>
          <Sparkline points={(chandelles ?? []).map((c) => c.c)} color={couleur} />
        </Card>
      </ButtonBase>
      {/* l'achat rapide : pour qui ne veut pas poser un ordre au carnet */}
      <Stack direction="row" gap={1.5}>
        <Button component={Link} to="/rapide?sens=achat" variant="contained" disableElevation sx={{ flex: 1, bgcolor: BUY, "&:hover": { bgcolor: BUY } }}>Acheter des USDT</Button>
        <Button component={Link} to="/rapide?sens=vente" variant="outlined" sx={{ flex: 1, color: SELL, borderColor: SELL }}>Vendre</Button>
      </Stack>
    </Screen>
  );
}

function Poche({ badge, label, valeur, bloque }: { badge: "xafe" | "usdt"; label: string; valeur: string; bloque?: string }) {
  return (
    <Stack direction="row" alignItems="center" gap={1} sx={{ flex: 1, minWidth: 0, bgcolor: "rgba(255,255,255,0.14)", borderRadius: 3, p: 1.25 }}>
      <Badge kind={badge} size={32} />
      <Stack sx={{ minWidth: 0 }}>
        <Typography variant="caption" sx={{ color: "inherit", opacity: 0.85 }}>{label}</Typography>
        <Typography fontWeight={600} sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}><Masquable>{valeur}</Masquable></Typography>
        {bloque && <Typography variant="caption" sx={{ color: "inherit", opacity: 0.75 }}><Masquable>{bloque}</Masquable></Typography>}
      </Stack>
    </Stack>
  );
}

export function Notifications() {
  const guichet = useGuichet();
  const { data } = useNotifications();
  useEffect(() => {
    if (data?.some((n) => !n.lue)) { const h = setTimeout(() => void guichet.marquerLues(), 1500); return () => clearTimeout(h); }
  }, [data, guichet]);

  const groupes = new Map<string, NonNullable<typeof data>>();
  for (const n of data ?? []) {
    const j = jourRelatif(n.quand);
    groupes.set(j, [...(groupes.get(j) ?? []), n]);
  }

  return (
    <Screen title="Notifications" back="/">
      {!data ? <Squelette /> : data.length === 0 ? (
        <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Typography variant="body2">Rien pour l'instant.</Typography>
        </Box>
      ) : (
        [...groupes].map(([jour, ns]) => (
          <Box key={jour}>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>{jour}</Typography>
            <List>
              {ns.map((n) => (
                <Row key={n.id} icon={<Icon tone={n.lue ? "neutral" : "green"}><NotificationsNoneRounded /></Icon>} tone={n.lue ? "neutral" : "green"} primary={n.titre} secondary={`${quand(n.quand)} · ${n.texte}`} to={n.cible} />
              ))}
            </List>
          </Box>
        ))
      )}
    </Screen>
  );
}
