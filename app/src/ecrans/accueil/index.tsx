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
import { Avatar, Badge as Pastille, Box, Button, ButtonBase, Chip, IconButton, LinearProgress, Stack, Typography, useMediaQuery } from "@mui/material";
import { useEffect, useState } from "react";
import type { Compte, Numero, Operation, Soldes } from "../../guichet/types";
import { Link } from "react-router-dom";
import { useChandelles, useCompte, useCotation, useDepotsEnAttente, useGuichet, useHistorique, useNotifications, useNumeros, useSoldes } from "../../guichet";
import { enTranches, initiales, jourRelatif, prix, quand, xaf } from "../../noyau/format";
import { useSession } from "../../session/session";
import { PALIERS } from "../../noyau/argent";
import { tones } from "../../theme";
import { Badge, BUY, Card, EtatVide, Icon, List, Masquable, Row, Screen, SELL, Sparkline, Squelette, Tile } from "../../ui";

export function Accueil() {
  const session = useSession();
  const { data: compte } = useCompte();
  const { data: soldes } = useSoldes();
  const { data: cotation } = useCotation();
  const { data: chandelles } = useChandelles(60, 28);
  const { data: enAttente } = useDepotsEnAttente();
  const { data: notifications } = useNotifications();
  const nonLues = notifications?.filter((n) => !n.lue).length ?? 0;
  const { data: historique } = useHistorique();
  const { data: numeros } = useNumeros();
  const grand = useMediaQuery("(min-width:900px)", { noSsr: true });
  const vide = soldes ? soldes.XAFe.disponible + soldes.XAFe.bloque + soldes.USDT.disponible + soldes.USDT.bloque === 0 : false;

  const totalXaf = soldes && cotation?.dernier != null
    ? soldes.XAFe.disponible + soldes.XAFe.bloque + (soldes.USDT.disponible + soldes.USDT.bloque) * cotation.dernier
    : soldes ? soldes.XAFe.disponible + soldes.XAFe.bloque : null;
  const variation = cotation?.variation24h ?? 0;
  const couleur = variation >= 0 ? BUY : SELL;

  return (
    <Screen tab="accueil" large gap={2}>
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

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0,1fr)", md: "minmax(0,1fr) minmax(0,1fr)" }, gap: 2, alignItems: "start" }}>
      <Stack gap={2}>
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

      <PremiersPas compte={compte} soldes={soldes} historique={historique} numeros={numeros} />

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
      </Stack>
      <Stack gap={2}>

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
      {/* l'achat rapide : pour qui ne veut pas poser un ordre au carnet — rien à acheter ni à vendre tant que le compte est vide */}
      {!vide && <Stack direction="row" gap={1.5}>
        <Button component={Link} to="/rapide?sens=achat" variant="contained" disableElevation sx={{ flex: 1, bgcolor: BUY, "&:hover": { bgcolor: BUY } }}>Acheter des USDT</Button>
        <Button component={Link} to="/rapide?sens=vente" variant="outlined" sx={{ flex: 1, color: SELL, borderColor: SELL }}>Vendre</Button>
      </Stack>}
      {/* sur un grand écran, la place à droite sert à voir ce qui vient de se passer — sur un téléphone, c'est l'onglet Historique */}
      {grand && historique && historique.length > 0 && <Recents operations={historique.slice(0, 5)} />}
      </Stack>
      </Box>
    </Screen>
  );
}

/*
 * Les premiers pas d'un compte neuf, UNE étape à la fois : la suivante seulement,
 * avec son bouton. Elle disparaît d'elle-même quand tout est fait. La
 * vérification d'identité est la seule qu'on peut remettre à plus tard.
 */
const CLE_PLUS_TARD = "glisil.premiers-pas.identite-plus-tard";

function PremiersPas({ compte, soldes, historique, numeros }: { compte?: Compte; soldes?: Soldes; historique?: Operation[]; numeros?: Numero[] }) {
  const [plusTard, setPlusTard] = useState(() => { try { return localStorage.getItem(CLE_PLUS_TARD) === "1"; } catch { return false; } });
  if (!compte || !soldes || !historique || !numeros) return null;
  const etapes = [
    { fait: historique.some((o) => o.nature === "depot" && o.etat === "credite") || soldes.XAFe.disponible + soldes.XAFe.bloque + soldes.USDT.disponible + soldes.USDT.bloque > 0,
      titre: "Entrez vos premiers XAF", texte: "Payez notre numéro MoMo, tapez le transaction ID de votre SMS : vos XAFe arrivent en quelques secondes.", label: "Entrer des XAF", to: "/entrer/operateur" },
    { fait: numeros.some((n) => n.verifieLe && !n.retireLe),
      titre: "Ajoutez votre numéro MoMo", texte: "C'est vers lui que vous sortirez vos XAF. Il devient actif 24 h après sa vérification : faites-le dès maintenant.", label: "Ajouter mon numéro", to: "/compte/numeros/ajouter" },
    { fait: compte.palier >= 1 || Boolean(compte.verificationEnCours) || plusTard,
      titre: "Vérifiez votre identité", texte: `Votre plafond passe de ${xaf(PALIERS[0].entreeJour ?? 0)} à ${xaf(PALIERS[1].entreeJour ?? 0)} XAF par jour. Une pièce d'identité et un selfie suffisent.`, label: "Vérifier mon identité", to: "/compte/paliers/identite", plusTard: true },
  ];
  const faites = etapes.filter((e) => e.fait).length;
  const suivante = etapes.find((e) => !e.fait);
  if (!suivante) return null;
  return (
    <Card sx={{ border: 1, borderColor: "divider" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="caption" sx={{ fontWeight: 600, color: "primary.main" }}>POUR BIEN DÉMARRER</Typography>
        <Typography variant="caption">{faites + 1} sur {etapes.length}</Typography>
      </Stack>
      <LinearProgress variant="determinate" value={(faites / etapes.length) * 100} sx={{ height: 4, borderRadius: 2, bgcolor: "divider" }} aria-label="Premiers pas" />
      <Typography variant="subtitle1" fontWeight={600}>{suivante.titre}</Typography>
      <Typography variant="body2">{suivante.texte}</Typography>
      <Stack direction="row" gap={1} sx={{ mt: 0.5 }}>
        <Button component={Link} to={suivante.to} variant="contained" size="small">{suivante.label}</Button>
        {suivante.plusTard && <Button size="small" color="inherit" sx={{ color: "text.secondary" }} onClick={() => { try { localStorage.setItem(CLE_PLUS_TARD, "1"); } catch { /* sans stockage, l'étape revient à la prochaine ouverture */ } setPlusTard(true); }}>Plus tard</Button>}
      </Stack>
    </Card>
  );
}

const ETATS_COURTS: Record<string, string> = { en_attente: "en attente", en_cours: "en cours", ouvert: "ouvert", partiel: "partiel", annule: "annulé", annulee: "annulée", expire: "expiré", echouee: "échouée", echoue: "échoué" };

/** Les cinq dernières opérations, en lignes simples ; le détail est à un clic. */
function Recents({ operations }: { operations: Operation[] }) {
  const titre = (o: Operation) => o.nature === "depot" ? "Entrée Mobile Money" : o.nature === "sortie" ? "Sortie Mobile Money" : o.nature === "ordre" ? (o.detail.cote === "achat" ? "Achat d'USDT" : "Vente d'USDT") : `${o.montant > 0 ? "Dépôt" : "Retrait"} ${o.actif}`;
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle1" component="h2" fontWeight={600}>Dernières opérations</Typography>
        <Button component={Link} to="/historique" size="small">Tout voir</Button>
      </Stack>
      <List>
        {operations.map((o) => (
          <Row key={`${o.nature}-${o.reference}`} icon={o.montant >= 0 ? <ArrowDownwardRounded /> : <ArrowUpwardRounded />} tone={o.montant >= 0 ? "green" : "amber"}
            primary={titre(o)} secondary={quand(o.quand)} right={o.montant === 0 ? ETATS_COURTS[o.etat] ?? "—" : o.nature === "crypto" && o.actif === "USDT" ? `${o.montant >= 0 ? "+" : ""}${enTranches(o.montant, 2)}` : `${o.montant >= 0 ? "+" : ""}${xaf(o.montant)}`}
            rightColor={o.montant > 0 ? tones.green.fg : undefined} to={o.nature === "ordre" ? `/marche/ordres/${o.reference}` : `/historique/${o.reference}`} />
        ))}
      </List>
    </Box>
  );
}

function Poche({ badge, label, valeur, bloque }: { badge: "xafe" | "usdt"; label: string; valeur: string; bloque?: string }) {
  return (
    <Stack direction="row" alignItems="center" gap={1} sx={{ flex: 1, minWidth: 0, bgcolor: "rgba(255,255,255,0.14)", borderRadius: 3, p: 1.25 }}>
      <Badge kind={badge} size={32} />
      <Stack sx={{ minWidth: 0 }}>
        <Typography variant="caption" sx={{ color: "inherit" }}>{label}</Typography>
        <Typography fontWeight={600} sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}><Masquable>{valeur}</Masquable></Typography>
        {bloque && <Typography variant="caption" sx={{ color: "inherit" }}><Masquable>{bloque}</Masquable></Typography>}
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
        <EtatVide icone={<NotificationsNoneRounded sx={{ fontSize: 36 }} />} titre="Aucune notification"
          texte="Un dépôt crédité, une sortie envoyée, un ordre exécuté : vous serez prévenu ici." />
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
