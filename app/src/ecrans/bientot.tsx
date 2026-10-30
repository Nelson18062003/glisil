/*
 * Ce qui n'est pas encore ouvert. Glisil ouvre par les dépôts : tant que
 * l'équipe n'a pas ouvert les sorties, le marché, l'achat rapide ou la
 * crypto, leurs écrans le disent ICI — avant un montant tapé pour rien — et
 * la base refuse de toute façon. Les écrans de suivi (une sortie envoyée, un
 * ordre passé) restent lisibles : ils montrent ce qui existe déjà.
 */
import HowToRegOutlined from "@mui/icons-material/HowToRegOutlined";
import ScheduleRounded from "@mui/icons-material/ScheduleRounded";
import { Outlet } from "react-router-dom";
import { useCompte, useOuvertures } from "../guichet";
import { BETA } from "../noyau/argent";
import { xaf } from "../noyau/format";
import { t } from "../noyau/langue";
import { EtatVide, Screen } from "../ui";

export type Porte = "sorties" | "marche" | "rapide" | "crypto" | "cryptoDepots" | "cryptoRetraits" | "entrees";

/* Pendant la bêta, une porte fermée ne « arrive » pas bientôt : elle est fermée parce que l'argent est de test. */
const PENDANT_LA_BETA: Partial<Record<Porte, () => { titre: string; texte: string }>> = {
  sorties: () => ({ titre: t("Les sorties sont fermées pendant la bêta", "Withdrawals are closed during the beta"), texte: t("L'argent de la bêta est de l'argent de test : il ne peut pas sortir de Glisil vers Mobile Money. Servez-vous-en pour essayer le marché.", "Beta money is test money: it can't leave Glisil for Mobile Money. Use it to try out the market.") }),
  cryptoRetraits: () => ({ titre: t("Les retraits sont fermés pendant la bêta", "Withdrawals are closed during the beta"), texte: t("L'argent de la bêta est de l'argent de test : il ne peut pas partir vers un wallet externe. Servez-vous-en pour essayer le marché.", "Beta money is test money: it can't be sent to an external wallet. Use it to try out the market.") }),
  entrees: () => ({ titre: t("Pas de vrai paiement pendant la bêta", "No real payments during the beta"), texte: BETA.dotation.XAFe > 0
    ? t(`Tout l'argent ici est de l'argent de test : vous avez reçu ${xaf(BETA.dotation.XAFe)} XAFe${BETA.dotation.USDT > 0 ? ` et ${xaf(BETA.dotation.USDT)} USDT` : ""} à votre inscription. Aucun paiement Mobile Money n'est accepté pour l'instant.`,
        `All the money here is test money: you received ${xaf(BETA.dotation.XAFe)} XAFe${BETA.dotation.USDT > 0 ? ` and ${xaf(BETA.dotation.USDT)} USDT` : ""} when you signed up. No Mobile Money payments are accepted for now.`)
    : t("Tout l'argent ici est de l'argent de test. Aucun paiement Mobile Money n'est accepté pour l'instant.", "All the money here is test money. No Mobile Money payments are accepted for now.") }),
};

/* une fonction, pas une constante : les textes se relisent dans la langue de l'écran */
const textes = (): Record<Porte, { ecran: string; titre: string; texte: string; retour: string }> => ({
  sorties: {
    ecran: t("Sortir des XAF", "Withdraw XAF"), retour: "/",
    titre: t("Les sorties vers Mobile Money arrivent bientôt", "Withdrawals to Mobile Money are coming soon"),
    texte: t("Glisil ouvre d'abord les dépôts. Vos XAFe restent en sécurité sur votre compte ; on vous prévient dès que vous pouvez les sortir.", "Glisil is opening deposits first. Your XAFe stay safe in your account; we'll let you know as soon as you can withdraw them."),
  },
  marche: {
    ecran: t("Marché", "Market"), retour: "/",
    titre: t("Le marché ouvre bientôt", "The market opens soon"),
    texte: t("Acheter et vendre des USDT et des USDC au carnet sera possible très prochainement. Pour l'instant, vous pouvez ajouter des XAFe à votre compte.", "Buying and selling USDT and USDC on the order book will be available very soon. For now, you can add XAFe to your account."),
  },
  rapide: {
    ecran: t("Acheter ou vendre", "Buy or sell"), retour: "/",
    titre: t("L'achat et la vente d'USDT et d'USDC arrivent bientôt", "Buying and selling USDT and USDC is coming soon"),
    texte: t("Pour l'instant, Glisil ouvre par les dépôts : vous pouvez ajouter des XAFe à votre compte.", "For now, Glisil is opening with deposits: you can add XAFe to your account."),
  },
  crypto: {
    ecran: "Crypto", retour: "/", // langue-ok
    titre: t("La crypto arrive bientôt", "Crypto is coming soon"),
    texte: t("Déposer, retirer, acheter ou vendre des USDT et des USDC sera possible très prochainement. Pour l'instant, vous pouvez ajouter des XAFe à votre compte.", "Depositing, withdrawing, buying and selling USDT and USDC will be available very soon. For now, you can add XAFe to your account."),
  },
  cryptoDepots: {
    ecran: t("Déposer", "Deposit"), retour: "/crypto",
    titre: t("Les dépôts crypto arrivent bientôt", "Crypto deposits are coming soon"),
    texte: t("Votre adresse de dépôt vous sera donnée dès l'ouverture. N'envoyez rien d'ici là.", "You'll get your deposit address as soon as it opens. Don't send anything until then."),
  },
  cryptoRetraits: {
    ecran: t("Retirer", "Withdraw"), retour: "/crypto",
    titre: t("Les retraits crypto arrivent bientôt", "Crypto withdrawals are coming soon"),
    texte: t("L'envoi vers un wallet externe n'est pas encore ouvert. Vos avoirs restent disponibles sur votre compte.", "Sending to an external wallet isn't open yet. Your funds remain available in your account."),
  },
  entrees: {
    ecran: t("Entrer des XAF", "Add XAF"), retour: "/",
    titre: t("Les dépôts arrivent bientôt", "Deposits are coming soon"),
    texte: t("Ajouter des XAFe par Mobile Money sera possible très prochainement.", "Adding XAFe via Mobile Money will be available very soon."),
  },
});

export function PasEncoreOuvert({ porte }: { porte: Porte }) {
  const beta = BETA.actif ? PENDANT_LA_BETA[porte]?.() : undefined;
  const x = { ...textes()[porte], ...beta };
  /* pendant la bêta, ou quand ce sont les dépôts qui sont fermés, on ne renvoie pas vers un dépôt */
  const action = BETA.actif || porte === "entrees" ? { label: t("Essayer le marché", "Try the market"), to: "/marche" } : { label: t("Ajouter des XAFe", "Add XAFe"), to: "/entrer/operateur" };
  return (
    <Screen title={x.ecran} back={x.retour}>
      <EtatVide icone={<ScheduleRounded sx={{ fontSize: 36 }} />} tone="amber" titre={x.titre} texte={x.texte}
        action={action} secondaire={{ label: t("Retour à l'accueil", "Back to Home"), to: "/" }} />
    </Screen>
  );
}

/**
 * 0047 : un compte que l'équipe n'a pas encore approuvé visite tout Glisil — le marché, les cours, son
 * compte — mais ne commence aucun geste d'argent. L'écran le dit AVANT un montant tapé pour rien ; la
 * base refuse de toute façon (« compte en attente d'approbation »).
 */
export function EnAttenteDApprobation({ ecran, retour = "/" }: { ecran: string; retour?: string }) {
  return (
    <Screen title={ecran} back={retour}>
      <EtatVide icone={<HowToRegOutlined sx={{ fontSize: 36 }} />} tone="amber"
        titre={t("Votre compte est en cours de vérification", "Your account is being reviewed")}
        texte={t("L'équipe Glisil vérifie chaque nouveau compte avant sa première opération. Vous recevrez un e-mail dès qu'il est approuvé. En attendant, vous pouvez visiter le marché et suivre les cours.",
          "The Glisil team reviews every new account before its first transaction. You'll get an email as soon as it's approved. Meanwhile, you can explore the market and follow prices.")}
        action={{ label: t("Voir le marché", "Explore the market"), to: "/marche" }} secondaire={{ label: t("Retour à l'accueil", "Back to Home"), to: "/" }} />
    </Screen>
  );
}

/** Les gestes d'argent derrière l'approbation : approuvé, l'écran demandé ; en attente, l'écran qui le dit. */
export function SiApprouve({ ecran, retour }: { ecran: () => string; retour?: string }) {
  const { data: compte } = useCompte();
  if (!compte) return null;
  return compte.approuve ? <Outlet /> : <EnAttenteDApprobation ecran={ecran()} retour={retour} />;
}

/** Une famille de chemins derrière son interrupteur : ouverte, l'écran demandé ; fermée, « bientôt ». */
export function SiOuvert({ porte }: { porte: Porte }) {
  const ouvert = useOuvertures();
  if (!ouvert.pret) return null;
  return ouvert[porte] ? <Outlet /> : <PasEncoreOuvert porte={porte} />;
}
