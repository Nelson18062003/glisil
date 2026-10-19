/*
 * L'Accueil : le solde, trois tuiles, le prix. Rien d'autre.
 */
import ArrowDownwardRounded from "@mui/icons-material/ArrowDownwardRounded";
import ArrowUpwardRounded from "@mui/icons-material/ArrowUpwardRounded";
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded";
import ScienceOutlined from "@mui/icons-material/ScienceOutlined";
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
import { useChandelles, useCompte, useCotation, useDepotsEnAttente, useGuichet, useHistorique, useNotifications, useNumeros, useOuvertures, useSoldes } from "../../guichet";
import { enTranches, initiales, jourRelatif, prix, quand, xaf } from "../../noyau/format";
import { texteDuServeur, titreDuServeur } from "../../noyau/serveur";
import { t } from "../../noyau/langue";
import { useSession } from "../../session/session";
import { BETA, PALIERS } from "../../noyau/argent";
import { apparence } from "../../ui/operation";
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
  const ouvert = useOuvertures();
  const grand = useMediaQuery("(min-width:900px)", { noSsr: true });
  const vide = soldes ? soldes.XAFe.disponible + soldes.XAFe.bloque + soldes.USDT.disponible + soldes.USDT.bloque === 0 : false;

  const totalXaf = soldes && cotation?.dernier != null
    ? soldes.XAFe.disponible + soldes.XAFe.bloque + (soldes.USDT.disponible + soldes.USDT.bloque) * cotation.dernier
    : soldes ? soldes.XAFe.disponible + soldes.XAFe.bloque : null;
  const variation = cotation?.variation24h ?? 0;
  const couleur = variation >= 0 ? BUY : SELL;

  return (
    <Screen tab="accueil" large gap={2}>
      {/* la bêta : que personne ne croie tenir de l'argent réel */}
      {ouvert.beta && (
        <Stack direction="row" gap={1.25} alignItems="flex-start" role="note" data-bandeau-beta
          sx={{ p: 1.5, borderRadius: 4, bgcolor: tones.amber.bg, color: tones.amber.fg }}>
          <ScienceOutlined fontSize="small" sx={{ mt: 0.25 }} />
          <Typography variant="body2" sx={{ color: "inherit" }}>
            <b>{t("Bêta", "Beta")}</b> · {t(BETA.message, BETA.messageEn) || t("Tout l'argent ici est de l'argent de test, sans valeur réelle.", "All the money here is test money, with no real value.")}{" "}
            <Box component={Link} to="/compte/aide?depuis=%2F" sx={{ color: "inherit", fontWeight: 600 }}>{t("Signaler un problème", "Report a problem")}</Box>
          </Typography>
        </Stack>
      )}
      <Stack direction="row" alignItems="center" gap={1.5}>
        <ButtonBase component={Link} to="/compte" sx={{ borderRadius: 20 }} aria-label={t("Mon compte", "My account")}>
          <Avatar sx={{ bgcolor: "primary.main", fontWeight: 600 }}>{initiales(compte?.nom)}</Avatar>
        </ButtonBase>
        <Typography variant="subtitle1" sx={{ flex: 1 }}>{t(`Bonjour ${compte?.nom?.split(" ")[0] ?? ""}`, `Hello ${compte?.nom?.split(" ")[0] ?? ""}`)}</Typography>
        <IconButton component={Link} to="/notifications" aria-label={"Notifications" /* langue-ok */}>
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
            <Typography variant="body2" sx={{ color: "inherit", opacity: 0.85 }}>{soldes.USDT.disponible + soldes.USDT.bloque > 0 ? t("Solde total · XAFe + USDT, estimé en XAF", "Total balance · XAFe + USDT, estimated in XAF") : t("Solde total", "Total balance")}</Typography>
            <IconButton size="small" onClick={session.basculerMasque} sx={{ color: "inherit", m: -1 }} aria-label={session.montantsMasques ? t("Montrer les montants", "Show amounts") : t("Masquer les montants", "Hide amounts")}>
              {session.montantsMasques ? <VisibilityOffOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}
            </IconButton>
          </Stack>
          <Typography variant="h3" sx={{ fontSize: totalXaf !== null && totalXaf >= 1e9 ? 32 : 40 }}>
            <Masquable>{totalXaf === null ? "—" : xaf(totalXaf)}</Masquable> XAF
          </Typography>
          <Stack direction="row" gap={1.5} mt={0.5}>
            <Poche badge="xafe" label="XAFe" valeur={xaf(soldes.XAFe.disponible)} bloque={soldes.XAFe.bloque > 0 ? t(`${xaf(soldes.XAFe.bloque)} bloqués`, `${xaf(soldes.XAFe.bloque)} on hold`) : undefined} />
            <Poche badge="usdt" label="USDT" valeur={enTranches(soldes.USDT.disponible, 2)} bloque={soldes.USDT.bloque > 0 ? t(`${enTranches(soldes.USDT.bloque, 2)} bloqués`, `${enTranches(soldes.USDT.bloque, 2)} on hold`) : undefined}
              equivalent={cotation?.dernier != null && soldes.USDT.disponible + soldes.USDT.bloque > 0 ? `≈ ${xaf((soldes.USDT.disponible + soldes.USDT.bloque) * cotation.dernier)} XAF` : undefined} />
          </Stack>
          {/* le XAFe est un jeton : la promesse 1 XAFe = 1 XAF se vérifie, à un geste */}
          <Typography component={Link} to="/preuve" variant="caption" sx={{ color: "inherit", opacity: 0.85, alignSelf: "flex-start", textUnderlineOffset: 3, display: "inline-flex", alignItems: "center", minHeight: 32 }}>
            {t("1 XAFe = 1 XAF · voir la preuve sur la blockchain", "1 XAFe = 1 XAF · see the proof on the blockchain")}
          </Typography>
        </Card>
      ) : (
        <Squelette hauteur={196} />
      )}

      <PremiersPas compte={compte} soldes={soldes} historique={historique} numeros={numeros} sorties={ouvert.sorties} />

      {compte?.verificationEnCours && (
        <Stack direction="row" alignItems="center" gap={1.5} sx={{ bgcolor: tones.blue.bg, color: tones.blue.fg, borderRadius: 4, px: 2, py: 1.25 }}>
          <VerifiedUserOutlined />
          <Typography variant="body2" sx={{ color: "inherit", flex: 1 }}>{t("Vos pièces sont en vérification. On vous prévient dès que c'est fait.", "Your documents are being reviewed. We'll let you know as soon as it's done.")}</Typography>
        </Stack>
      )}

      {enAttente?.map((d) => (
        <ButtonBase key={d.reference} component={Link} to={`/entrer/transaction/${d.reference}`} sx={{ borderRadius: 4, textAlign: "left" }}>
          <Stack direction="row" alignItems="center" gap={1.5} sx={{ bgcolor: tones.amber.bg, color: tones.amber.fg, borderRadius: 4, px: 2, py: 1.25, width: "100%" }}>
            <HourglassTopRounded />
            <Stack sx={{ flex: 1 }}>
              <Typography fontWeight={600} sx={{ color: "inherit" }}>{t(`Dépôt en attente · ${d.reference}`, `Pending deposit · ${d.reference}`)}</Typography>
              <Typography variant="body2" sx={{ color: "inherit", opacity: 0.85 }}>
                {d.declarations.some((x) => x.etat === "attendu") ? t("On cherche le SMS de votre paiement…", "Looking for your payment SMS…") : t("Entrez le transaction ID de votre paiement.", "Enter your payment's transaction ID.")}
              </Typography>
            </Stack>
            <ChevronRightRounded />
          </Stack>
        </ButtonBase>
      ))}

      <Stack direction="row" gap={1.5}>
        <Tile icon={<ArrowDownwardRounded />} label={t("Entrer des XAF", "Add XAF")} to="/entrer/operateur" tone="green" note={ouvert.pret && !ouvert.entrees ? t("Fermé (bêta)", "Closed (beta)") : undefined} />
        <Tile icon={<ArrowUpwardRounded />} label={t("Sortir des XAF", "Withdraw XAF")} to="/sortir/montant" tone="amber" note={ouvert.pret && !ouvert.sorties ? (ouvert.beta ? t("Fermé (bêta)", "Closed (beta)") : t("Bientôt", "Coming soon")) : undefined} />
        <Tile icon={<CurrencyBitcoinRounded />} label={"Crypto" /* langue-ok */} to="/crypto" tone="blue" note={ouvert.pret && !ouvert.crypto ? t("Bientôt", "Coming soon") : undefined} />
      </Stack>
      </Stack>
      <Stack gap={2}>

      {ouvert.pret && !ouvert.marche ? (
        /* le marché n'est pas encore ouvert : pas de cours qui bouge sur un marché où l'on ne peut rien faire */
        <Card sx={{ width: "100%" }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="body2">{"USDT/XAFe" /* langue-ok */}</Typography>
            <Chip label={t("Bientôt", "Coming soon")} size="small" sx={{ bgcolor: tones.amber.bg, color: tones.amber.fg, height: 28 }} />
          </Stack>
          <Typography variant="subtitle1" fontWeight={600}>{t("Le marché ouvre bientôt", "The market opens soon")}</Typography>
          <Typography variant="body2">{t("Acheter et vendre des USDT sera possible très prochainement. Pour l'instant, ajoutez des XAFe à votre compte.", "Buying and selling USDT will be available very soon. For now, add XAFe to your account.")}</Typography>
        </Card>
      ) : (
      <ButtonBase component={Link} to="/marche" sx={{ textAlign: "left", borderRadius: 6 }}>
        <Card sx={{ width: "100%" }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="body2">{"USDT/XAFe" /* langue-ok */}</Typography>
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
      )}
      {/* l'achat rapide : pour qui ne veut pas poser un ordre au carnet — rien à acheter ni à vendre tant que le compte est vide */}
      {!vide && ouvert.rapide && <Stack direction="row" gap={1.5}>
        <Button component={Link} to="/rapide?sens=achat" variant="contained" disableElevation sx={{ flex: 1, bgcolor: BUY, "&:hover": { bgcolor: BUY } }}>{t("Acheter des USDT", "Buy USDT")}</Button>
        <Button component={Link} to="/rapide?sens=vente" variant="outlined" sx={{ flex: 1, color: SELL, borderColor: SELL }}>{t("Vendre", "Sell")}</Button>
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

function PremiersPas({ compte, soldes, historique, numeros, sorties }: { compte?: Compte; soldes?: Soldes; historique?: Operation[]; numeros?: Numero[]; sorties: boolean }) {
  const [plusTard, setPlusTard] = useState(() => { try { return localStorage.getItem(CLE_PLUS_TARD) === "1"; } catch { return false; } });
  if (!compte || !soldes || !historique || !numeros) return null;
  const etapes = [
    { fait: historique.some((o) => o.nature === "depot" && o.etat === "credite") || soldes.XAFe.disponible + soldes.XAFe.bloque + soldes.USDT.disponible + soldes.USDT.bloque > 0,
      titre: t("Entrez vos premiers XAF", "Add your first XAF"), texte: t("Payez notre numéro MTN MoMo ou Orange Money, puis donnez-nous le transaction ID de votre SMS : vos XAFe arrivent en quelques instants.", "Pay our MTN MoMo or Orange Money number, then give us the transaction ID from your SMS: your XAFe arrive within moments."), label: t("Entrer des XAF", "Add XAF"), to: "/entrer/operateur" },
    /* tant que les sorties ne sont pas ouvertes, le numéro de sortie n'est pas une étape */
    ...(sorties ? [{ fait: numeros.some((n) => n.verifieLe && !n.retireLe),
      titre: t("Ajoutez votre numéro MoMo", "Add your MoMo number"), texte: t("C'est vers lui que vous sortirez vos XAF. Il devient actif 24 h après sa vérification : faites-le dès maintenant.", "This is where you'll withdraw your XAF. It becomes active 24 hours after it's verified, so do it now."), label: t("Ajouter mon numéro", "Add my number"), to: "/compte/numeros/ajouter" }] : []),
    { fait: compte.palier >= 1 || Boolean(compte.verificationEnCours) || plusTard,
      titre: t("Vérifiez votre identité", "Verify your identity"), texte: PALIERS[1].entreeJour == null
        /* sans plafond (0027), il n'y a pas de plafond à relever : on dit pourquoi vérifier, pas un « 0 à 0 » */
        ? t("Glisil doit savoir qui est derrière chaque compte. Une pièce d'identité et un selfie suffisent.", "Glisil needs to know who is behind each account. An ID document and a selfie are all it takes.")
        : t(`Votre plafond passe de ${xaf(PALIERS[0].entreeJour ?? 0)} à ${xaf(PALIERS[1].entreeJour)} XAF par jour. Une pièce d'identité et un selfie suffisent.`, `Your limit goes from ${xaf(PALIERS[0].entreeJour ?? 0)} to ${xaf(PALIERS[1].entreeJour)} XAF per day. An ID document and a selfie are all it takes.`), label: t("Vérifier mon identité", "Verify my identity"), to: "/compte/paliers/identite", plusTard: true },
  ];
  const faites = etapes.filter((e) => e.fait).length;
  const suivante = etapes.find((e) => !e.fait);
  if (!suivante) return null;
  return (
    <Card sx={{ border: 1, borderColor: "divider" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="caption" sx={{ fontWeight: 600, color: "primary.main" }}>{t("POUR BIEN DÉMARRER", "GETTING STARTED")}</Typography>
        <Typography variant="caption">{t(`${faites + 1} sur ${etapes.length}`, `${faites + 1} of ${etapes.length}`)}</Typography>
      </Stack>
      <LinearProgress variant="determinate" value={(faites / etapes.length) * 100} sx={{ height: 4, borderRadius: 2, bgcolor: "divider" }} aria-label={t("Premiers pas", "First steps")} />
      <Typography variant="subtitle1" fontWeight={600}>{suivante.titre}</Typography>
      <Typography variant="body2">{suivante.texte}</Typography>
      <Stack direction="row" gap={1} sx={{ mt: 0.5 }}>
        <Button component={Link} to={suivante.to} variant="contained" size="small">{suivante.label}</Button>
        {suivante.plusTard && <Button size="small" color="inherit" sx={{ color: "text.secondary" }} onClick={() => { try { localStorage.setItem(CLE_PLUS_TARD, "1"); } catch { /* sans stockage, l'étape revient à la prochaine ouverture */ } setPlusTard(true); }}>{t("Plus tard", "Later")}</Button>}
      </Stack>
    </Card>
  );
}

/** Les cinq dernières opérations, dites comme dans l'historique ; le détail est à un clic. */
function Recents({ operations }: { operations: Operation[] }) {
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle1" component="h2" fontWeight={600}>{t("Dernières opérations", "Recent activity")}</Typography>
        <Button component={Link} to="/historique" size="small">{t("Tout voir", "See all")}</Button>
      </Stack>
      <List>
        {operations.map((o) => {
          const a = apparence(o);
          return (
            <Row key={`${o.nature}-${o.reference}`} icon={a.icone} tone={a.tone} primary={a.titre} secondary={quand(o.quand)} right={a.droite}
              rightColor={a.couleur} to={o.nature === "ordre" ? `/marche/ordres/${o.reference}` : `/historique/${o.reference}`} />
          );
        })}
      </List>
    </Box>
  );
}

function Poche({ badge, label, valeur, bloque, equivalent }: { badge: "xafe" | "usdt"; label: string; valeur: string; bloque?: string; equivalent?: string }) {
  return (
    <Stack direction="row" alignItems="center" gap={1} sx={{ flex: 1, minWidth: 0, bgcolor: "rgba(255,255,255,0.14)", borderRadius: 3, p: 1.25 }}>
      <Badge kind={badge} size={32} />
      <Stack sx={{ minWidth: 0 }}>
        <Typography variant="caption" sx={{ color: "inherit" }}>{label}</Typography>
        <Typography fontWeight={600} sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}><Masquable>{valeur}</Masquable></Typography>
        {bloque && <Typography variant="caption" sx={{ color: "inherit" }}><Masquable>{bloque}</Masquable></Typography>}
        {equivalent && <Typography variant="caption" sx={{ color: "inherit" }}><Masquable>{equivalent}</Masquable></Typography>}
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
    <Screen title={"Notifications" /* langue-ok : le même mot en anglais */} back="/">
      {!data ? <Squelette /> : data.length === 0 ? (
        <EtatVide icone={<NotificationsNoneRounded sx={{ fontSize: 36 }} />} titre={t("Aucune notification", "No notifications")}
          texte={t("Un dépôt crédité, une sortie envoyée, un ordre exécuté : vous serez prévenu ici.", "A deposit credited, a withdrawal sent, an order filled: you'll be notified here.")} />
      ) : (
        [...groupes].map(([jour, ns]) => (
          <Box key={jour}>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>{jour}</Typography>
            <List>
              {ns.map((n) => (
                <Row key={n.id} icon={<Icon tone={n.lue ? "neutral" : "green"}><NotificationsNoneRounded /></Icon>} tone={n.lue ? "neutral" : "green"} primary={titreDuServeur(n.titre)} secondary={`${quand(n.quand)} · ${texteDuServeur(n.texte)}`} to={n.cible} />
              ))}
            </List>
          </Box>
        ))
      )}
    </Screen>
  );
}
