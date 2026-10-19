/*
 * L'achat (et la vente) rapide : 1 Montant → 2 Prix ferme → 3 Fait.
 * Pour qui ne veut pas poser un ordre au carnet : on donne un montant, on voit
 * ce qu'on reçoit, on confirme. Le prix tient quelques secondes. La plateforme
 * n'a pas de stock : elle prend au carnet pour le client, et garde sa marge.
 */
import ArrowDownwardRounded from "@mui/icons-material/ArrowDownwardRounded";
import BoltRounded from "@mui/icons-material/BoltRounded";
import CurrencyBitcoinRounded from "@mui/icons-material/CurrencyBitcoinRounded";
import { Box, Button, LinearProgress, Stack, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useEstimationRapide, useGuichet, useRafraichir, useSoldes } from "../../guichet";
import type { DevisRapide, SensRapide } from "../../guichet/types";
import { RAPIDE } from "../../noyau/argent";
import { lisible } from "../../noyau/erreurs";
import { enTranches, pourcent, prix as fPrix, usdt } from "../../noyau/format";
import { langue, t } from "../../noyau/langue";
import { Amount, BUY, Card, Chips, EtatVide, FeuilleErreur, Keypad, Line, Screen, SELL, Success } from "../../ui";
import { useGesteUnique } from "../../ui/gestes";

const xafe = (n: number) => enTranches(n, Math.round(n * 100) % 100 ? 2 : 0);

/* --------------------------------------------------------- 1 · montant */

export function Rapide() {
  const navigate = useNavigate();
  const guichet = useGuichet();
  const [params] = useSearchParams();
  const { data: soldes } = useSoldes();
  const [sens, setSens] = useState<SensRapide>(params.get("sens") === "vente" ? "vente" : "achat");
  const [saisie, setSaisie] = useState("");
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();

  const montant = Number(saisie.replace(",", ".")) || 0;
  const unite = sens === "achat" ? "XAFe" : "USDT";
  const dispo = soldes ? (sens === "achat" ? soldes.XAFe.disponible : soldes.USDT.disponible) : 0;
  const trop = soldes ? montant > dispo + 1e-9 : false;
  const estimation = useEstimationRapide(sens, montant);
  const e = montant > 0 && !estimation.isError ? estimation.data : undefined;
  const ok = montant > 0 && !trop && Boolean(e) && !estimation.isError;

  const changer = (s: SensRapide) => { setSens(s); setSaisie(""); };
  const touche = (k: string) => {
    if (k === "⌫") return setSaisie(saisie.slice(0, -1));
    if (k === ",") return setSaisie(saisie.includes(".") ? saisie : (saisie || "0") + ".");
    const suite = (saisie + k).replace(/^0+(?=\d)/, "");
    if (sens === "achat" && suite.includes(".")) return;
    if (/\.\d{3,}$/.test(suite)) return;
    if (suite.length <= 12) setSaisie(suite);
  };
  /* les puces portent une clé (« tout », un montant brut) ; leur libellé se lit dans la langue de l'écran */
  const choisir = (c: string) => setSaisie(c === "tout" ? String(sens === "achat" ? Math.trunc(dispo) : Math.trunc(dispo * 100) / 100) : c.replace(/\D/g, ""));
  const prixFerme = () => lancer(async () => {
    const devis = await guichet.devisRapide({ sens, montant, ferme: true });
    navigate("/rapide/prix", { state: { devis, montant } });
  });

  const aide = !soldes ? " "
    : trop ? t(`Vous n'avez que ${sens === "achat" ? xafe(Math.trunc(dispo)) : usdt(dispo)} ${unite} disponibles`, `You only have ${sens === "achat" ? xafe(Math.trunc(dispo)) : usdt(dispo)} ${unite} available`)
    : montant > 0 && estimation.isError ? lisible(estimation.error).titre
    : e ? (sens === "achat" ? t(`Vous recevez ${usdt(e.quantite)} USDT`, `You get ${usdt(e.quantite)} USDT`) : t(`Vous recevez ${xafe(e.total)} XAFe`, `You get ${xafe(e.total)} XAFe`))
    : t(`Disponible : ${sens === "achat" ? xafe(Math.trunc(dispo)) : usdt(dispo)} ${unite}`, `Available: ${sens === "achat" ? xafe(Math.trunc(dispo)) : usdt(dispo)} ${unite}`);

  return (
    <Screen title={sens === "achat" ? t("Acheter des USDT", "Buy USDT") : t("Vendre des USDT", "Sell USDT")} back="/" gap={1.5}>
      <Stack direction="row" sx={{ height: 40, borderRadius: 3, overflow: "hidden", bgcolor: "background.paper" }}>
        {(["achat", "vente"] as const).map((s) => (
          <Button key={s} onClick={() => changer(s)} disableElevation variant={sens === s ? "contained" : "text"} aria-pressed={sens === s}
            sx={{ flex: 1, borderRadius: 3, minHeight: 40, bgcolor: sens === s ? (s === "achat" ? BUY : SELL) : "transparent", color: sens === s ? "#fff" : "text.secondary", "&:hover": { bgcolor: sens === s ? (s === "achat" ? BUY : SELL) : undefined } }}>
            {s === "achat" ? t("Acheter", "Buy") : t("Vendre", "Sell")}
          </Button>
        ))}
      </Stack>
      {soldes && dispo <= 0 ? (
        sens === "achat" ? (
          <EtatVide icone={<ArrowDownwardRounded sx={{ fontSize: 36 }} />} tone="green" titre={t("D'abord, des XAFe", "First, get some XAFe")}
            texte={t("On achète des USDT avec des XAFe. Entrez des XAF par Mobile Money : ils deviennent des XAFe sur votre solde, tout de suite.", "You buy USDT with XAFe. Add XAF with Mobile Money: they become XAFe in your balance right away.")}
            action={{ label: t("Entrer des XAF", "Add XAF"), to: "/entrer/operateur" }} />
        ) : (
          <EtatVide icone={<CurrencyBitcoinRounded sx={{ fontSize: 36 }} />} tone="blue" titre={t("Pas encore d'USDT à vendre", "No USDT to sell yet")}
            texte={t("Achetez-en avec vos XAFe, ou déposez des USDT depuis un autre wallet.", "Buy some with your XAFe, or deposit USDT from another wallet.")}
            action={{ label: t("Acheter des USDT", "Buy USDT"), onClick: () => changer("achat") }} secondaire={{ label: t("Déposer des USDT", "Deposit USDT"), to: "/crypto/deposer/USDT" }} />
        )
      ) : (<>
      <Amount value={saisie ? (sens === "achat" ? xafe(montant) : (langue() === "en" ? saisie : saisie.replace(".", ","))) : "0"} unit={unite} hint={aide} hintColor={trop || (montant > 0 && estimation.isError) ? "error.main" : undefined} />
      <Typography variant="caption" textAlign="center" sx={{ mt: -2 }}>
        {e ? t(`≈ ${fPrix(e.prix)} XAFe par USDT, frais compris`, `≈ ${fPrix(e.prix)} XAFe per USDT, fees included`)
          : RAPIDE.marge > 0 ? t(`Au prix du carnet, frais de ${pourcent(RAPIDE.marge)} compris`, `At the order book price, ${pourcent(RAPIDE.marge)} fee included`)
          : t("Au prix du carnet, sans frais", "At the order book price, no fees")}
      </Typography>
      <Chips items={sens === "achat" ? ["50000", "200000", "tout"] : ["50", "200", "tout"]} onSelect={choisir}
        libelle={(c) => (c === "tout" ? t("Tout", "All") : sens === "achat" ? xafe(Number(c)) : c)} />
      <Box sx={{ flex: 1 }} />
      <Keypad onKey={touche} triple={sens === "achat" ? "000" : ","} />
      <Button variant="contained" disabled={!ok || enCours} onClick={() => void prixFerme()} startIcon={<BoltRounded />}>{t("Voir le prix", "See the price")}</Button>
      </>)}
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Screen>
  );
}

/* ------------------------------------------------------ 2 · prix ferme */

export function RapidePrix() {
  const navigate = useNavigate();
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const lieu = useLocation();
  const etat = lieu.state as { devis?: DevisRapide; montant?: number } | null;
  const [devis, setDevis] = useState<DevisRapide | null>(etat?.devis ?? null);
  const [maintenant, setMaintenant] = useState(Date.now());
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique();

  useEffect(() => { const minuteur = setInterval(() => setMaintenant(Date.now()), 250); return () => clearInterval(minuteur); }, []);
  if (!devis || etat?.montant == null) return <Navigate to="/rapide" replace />;

  const fin = devis.expireLe ? new Date(devis.expireLe).getTime() : 0;
  const reste = Math.max(0, Math.ceil((fin - maintenant) / 1000));
  const expire = reste <= 0;
  const achat = devis.sens === "achat";

  const nouveau = () => lancer(async () => { setDevis(await guichet.devisRapide({ sens: devis.sens, montant: etat.montant!, ferme: true })); });
  const confirmer = () => lancer(async () => {
    const fait = await guichet.executerDevis(devis.id!);
    await rafraichir();
    navigate("/rapide/fait", { replace: true, state: { devis: fait } });
  });

  return (
    <Screen title={t("Votre prix", "Your price")} back={`/rapide?sens=${devis.sens}`} gap={1.5}>
      <Card>
        <Line label={t("Vous payez", "You pay")} value={achat ? `${xafe(devis.total)} XAFe` : `${usdt(devis.quantite)} USDT`} strong />
        <Line label={t("Vous recevez", "You get")} value={achat ? `${usdt(devis.quantite)} USDT` : `${xafe(devis.total)} XAFe`} strong />
        <Line label={t("Prix", "Price")} value={t(`${fPrix(devis.prix)} XAFe par USDT`, `${fPrix(devis.prix)} XAFe per USDT`)} />
        <Line label={t(`Dont frais (${pourcent(devis.marge)})`, `Including fees (${pourcent(devis.marge)})`)} value={`${xafe(devis.frais)} XAFe`} />
      </Card>
      <Stack gap={0.75} sx={{ px: 0.5 }} data-compte-a-rebours="1">
        <Typography variant="body2" textAlign="center" sx={{ color: expire ? "error.main" : undefined }}>
          {expire ? t("Ce prix a expiré", "This price has expired") : t(`Prix garanti encore ${reste} s`, `Price guaranteed for another ${reste} s`)}
        </Typography>
        <LinearProgress variant="determinate" value={Math.min(100, (reste / RAPIDE.validiteSecondes) * 100)} sx={{ height: 6, borderRadius: 3 }} color={expire ? "error" : "primary"} />
      </Stack>
      <Typography variant="body2" textAlign="center">
        {t("Pris au carnet, au meilleur prix du moment. Si le carnet bouge contre vous avant votre confirmation, rien ne se fait.", "Filled from the order book at the best current price. If the book moves against you before you confirm, nothing happens.")}
      </Typography>
      <Box sx={{ flex: 1 }} />
      {expire
        ? <Button variant="contained" disabled={enCours} onClick={() => void nouveau()}>{t("Nouveau prix", "New price")}</Button>
        : <Button variant="contained" disabled={enCours} onClick={() => void confirmer()} sx={{ bgcolor: achat ? BUY : SELL, "&:hover": { bgcolor: achat ? BUY : SELL } }}>
            {achat ? t("Confirmer l'achat", "Confirm purchase") : t("Confirmer la vente", "Confirm sale")}
          </Button>}
      <FeuilleErreur erreur={erreur} onFermer={() => { effacerErreur(); if (!expire) void nouveau(); }} />
    </Screen>
  );
}

/* ----------------------------------------------------------- 3 · fait */

export function RapideFait() {
  const etat = useLocation().state as { devis?: DevisRapide } | null;
  const d = etat?.devis;
  if (!d) return <Navigate to="/" replace />;
  const achat = d.sens === "achat";
  return (
    <Success
      title={achat ? t("USDT achetés", "USDT bought") : t("USDT vendus", "USDT sold")}
      amount={achat ? `+${usdt(d.quantite)} USDT` : `+${xafe(d.total)} XAFe`}
      caption={achat ? t(`Pour ${xafe(d.total)} XAFe, à ${fPrix(d.prix)} par USDT, frais compris.`, `For ${xafe(d.total)} XAFe, at ${fPrix(d.prix)} per USDT, fees included.`)
        : t(`${usdt(d.quantite)} USDT à ${fPrix(d.prix)} par USDT, frais compris.`, `${usdt(d.quantite)} USDT at ${fPrix(d.prix)} per USDT, fees included.`)}
      primary={{ label: t("Retour à l'accueil", "Back to Home"), to: "/" }}
      secondary={{ label: t("Voir le marché", "View the Market"), to: "/marche" }}
    >
      <Card>
        <Line label={t("Frais", "Fees")} value={`${xafe(d.frais)} XAFe`} />
        {d.ordre && <Line label={t("Référence", "Reference")} value={d.ordre} mono />}
      </Card>
    </Success>
  );
}
