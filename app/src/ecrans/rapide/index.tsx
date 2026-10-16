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
  const choisir = (c: string) => setSaisie(c === "Tout" ? String(sens === "achat" ? Math.trunc(dispo) : Math.trunc(dispo * 100) / 100) : c.replace(/\D/g, ""));
  const prixFerme = () => lancer(async () => {
    const devis = await guichet.devisRapide({ sens, montant, ferme: true });
    navigate("/rapide/prix", { state: { devis, montant } });
  });

  const aide = !soldes ? " "
    : trop ? `Vous n'avez que ${sens === "achat" ? xafe(Math.trunc(dispo)) : usdt(dispo)} ${unite} disponibles`
    : montant > 0 && estimation.isError ? lisible(estimation.error).titre
    : e ? (sens === "achat" ? `Vous recevez ${usdt(e.quantite)} USDT` : `Vous recevez ${xafe(e.total)} XAFe`)
    : `Disponible : ${sens === "achat" ? xafe(Math.trunc(dispo)) : usdt(dispo)} ${unite}`;

  return (
    <Screen title={sens === "achat" ? "Acheter des USDT" : "Vendre des USDT"} back="/" gap={1.5}>
      <Stack direction="row" sx={{ height: 40, borderRadius: 3, overflow: "hidden", bgcolor: "background.paper" }}>
        {(["achat", "vente"] as const).map((s) => (
          <Button key={s} onClick={() => changer(s)} disableElevation variant={sens === s ? "contained" : "text"} aria-pressed={sens === s}
            sx={{ flex: 1, borderRadius: 3, minHeight: 40, bgcolor: sens === s ? (s === "achat" ? BUY : SELL) : "transparent", color: sens === s ? "#fff" : "text.secondary", "&:hover": { bgcolor: sens === s ? (s === "achat" ? BUY : SELL) : undefined } }}>
            {s === "achat" ? "Acheter" : "Vendre"}
          </Button>
        ))}
      </Stack>
      {soldes && dispo <= 0 ? (
        sens === "achat" ? (
          <EtatVide icone={<ArrowDownwardRounded sx={{ fontSize: 36 }} />} tone="green" titre="D'abord, des XAFe"
            texte="On achète des USDT avec des XAFe. Entrez des XAF par Mobile Money : ils deviennent des XAFe sur votre solde, tout de suite."
            action={{ label: "Entrer des XAF", to: "/entrer/operateur" }} />
        ) : (
          <EtatVide icone={<CurrencyBitcoinRounded sx={{ fontSize: 36 }} />} tone="blue" titre="Pas encore d'USDT à vendre"
            texte="Achetez-en avec vos XAFe, ou déposez des USDT depuis un autre wallet."
            action={{ label: "Acheter des USDT", onClick: () => changer("achat") }} secondaire={{ label: "Déposer des USDT", to: "/crypto/deposer/USDT" }} />
        )
      ) : (<>
      <Amount value={saisie ? (sens === "achat" ? xafe(montant) : saisie.replace(".", ",")) : "0"} unit={unite} hint={aide} hintColor={trop || (montant > 0 && estimation.isError) ? "error.main" : undefined} />
      <Typography variant="caption" textAlign="center" sx={{ mt: -2 }}>
        {e ? `≈ ${fPrix(e.prix)} XAFe par USDT, frais compris` : `Au prix du carnet, frais de ${pourcent(RAPIDE.marge)} compris`}
      </Typography>
      <Chips items={sens === "achat" ? ["50 000", "200 000", "Tout"] : ["50", "200", "Tout"]} onSelect={choisir} />
      <Box sx={{ flex: 1 }} />
      <Keypad onKey={touche} triple={sens === "achat" ? "000" : ","} />
      <Button variant="contained" disabled={!ok || enCours} onClick={() => void prixFerme()} startIcon={<BoltRounded />}>Voir le prix</Button>
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

  useEffect(() => { const t = setInterval(() => setMaintenant(Date.now()), 250); return () => clearInterval(t); }, []);
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
    <Screen title="Votre prix" back={`/rapide?sens=${devis.sens}`} gap={1.5}>
      <Card>
        <Line label="Vous payez" value={achat ? `${xafe(devis.total)} XAFe` : `${usdt(devis.quantite)} USDT`} strong />
        <Line label="Vous recevez" value={achat ? `${usdt(devis.quantite)} USDT` : `${xafe(devis.total)} XAFe`} strong />
        <Line label="Prix" value={`${fPrix(devis.prix)} XAFe par USDT`} />
        <Line label={`Dont frais (${pourcent(devis.marge)})`} value={`${xafe(devis.frais)} XAFe`} />
      </Card>
      <Stack gap={0.75} sx={{ px: 0.5 }} data-compte-a-rebours="1">
        <Typography variant="body2" textAlign="center" sx={{ color: expire ? "error.main" : undefined }}>
          {expire ? "Ce prix a expiré" : `Prix garanti encore ${reste} s`}
        </Typography>
        <LinearProgress variant="determinate" value={Math.min(100, (reste / RAPIDE.validiteSecondes) * 100)} sx={{ height: 6, borderRadius: 3 }} color={expire ? "error" : "primary"} />
      </Stack>
      <Typography variant="body2" textAlign="center">
        Pris au carnet, au meilleur prix du moment. Si le carnet bouge contre vous avant votre confirmation, rien ne se fait.
      </Typography>
      <Box sx={{ flex: 1 }} />
      {expire
        ? <Button variant="contained" disabled={enCours} onClick={() => void nouveau()}>Nouveau prix</Button>
        : <Button variant="contained" disabled={enCours} onClick={() => void confirmer()} sx={{ bgcolor: achat ? BUY : SELL, "&:hover": { bgcolor: achat ? BUY : SELL } }}>
            {achat ? "Confirmer l'achat" : "Confirmer la vente"}
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
      title={achat ? "USDT achetés" : "USDT vendus"}
      amount={achat ? `+${usdt(d.quantite)} USDT` : `+${xafe(d.total)} XAFe`}
      caption={achat ? `Pour ${xafe(d.total)} XAFe, à ${fPrix(d.prix)} par USDT, frais compris.` : `${usdt(d.quantite)} USDT à ${fPrix(d.prix)} par USDT, frais compris.`}
      primary={{ label: "Retour à l'accueil", to: "/" }}
      secondary={{ label: "Voir le marché", to: "/marche" }}
    >
      <Card>
        <Line label="Frais" value={`${xafe(d.frais)} XAFe`} />
        {d.ordre && <Line label="Référence" value={d.ordre} mono />}
      </Card>
    </Success>
  );
}
