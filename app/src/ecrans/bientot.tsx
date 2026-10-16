/*
 * Ce qui n'est pas encore ouvert. Glisil ouvre par les dépôts : tant que
 * l'équipe n'a pas ouvert les sorties, le marché, l'achat rapide ou la
 * crypto, leurs écrans le disent ICI — avant un montant tapé pour rien — et
 * la base refuse de toute façon. Les écrans de suivi (une sortie envoyée, un
 * ordre passé) restent lisibles : ils montrent ce qui existe déjà.
 */
import ScheduleRounded from "@mui/icons-material/ScheduleRounded";
import { Outlet } from "react-router-dom";
import { useOuvertures } from "../guichet";
import { EtatVide, Screen } from "../ui";

export type Porte = "sorties" | "marche" | "rapide" | "crypto" | "cryptoDepots" | "cryptoRetraits";

const TEXTES: Record<Porte, { ecran: string; titre: string; texte: string; retour: string }> = {
  sorties: {
    ecran: "Sortir des XAF", retour: "/",
    titre: "Les sorties vers Mobile Money arrivent bientôt",
    texte: "Glisil ouvre d'abord les dépôts. Vos XAFe restent en sécurité sur votre compte ; on vous prévient dès que vous pouvez les sortir.",
  },
  marche: {
    ecran: "Marché", retour: "/",
    titre: "Le marché ouvre bientôt",
    texte: "Acheter et vendre des USDT au carnet sera possible très prochainement. Pour l'instant, vous pouvez ajouter des XAFe à votre compte.",
  },
  rapide: {
    ecran: "Acheter ou vendre", retour: "/",
    titre: "L'achat et la vente d'USDT arrivent bientôt",
    texte: "Pour l'instant, Glisil ouvre par les dépôts : vous pouvez ajouter des XAFe à votre compte.",
  },
  crypto: {
    ecran: "Crypto", retour: "/",
    titre: "La crypto arrive bientôt",
    texte: "Déposer, retirer, acheter ou vendre des USDT sera possible très prochainement. Pour l'instant, vous pouvez ajouter des XAFe à votre compte.",
  },
  cryptoDepots: {
    ecran: "Déposer", retour: "/crypto",
    titre: "Les dépôts crypto arrivent bientôt",
    texte: "Votre adresse de dépôt vous sera donnée dès l'ouverture. N'envoyez rien d'ici là.",
  },
  cryptoRetraits: {
    ecran: "Retirer", retour: "/crypto",
    titre: "Les retraits crypto arrivent bientôt",
    texte: "L'envoi vers un wallet externe n'est pas encore ouvert. Vos avoirs restent disponibles sur votre compte.",
  },
};

export function PasEncoreOuvert({ porte }: { porte: Porte }) {
  const t = TEXTES[porte];
  return (
    <Screen title={t.ecran} back={t.retour}>
      <EtatVide icone={<ScheduleRounded sx={{ fontSize: 36 }} />} tone="amber" titre={t.titre} texte={t.texte}
        action={{ label: "Ajouter des XAFe", to: "/entrer/operateur" }} secondaire={{ label: "Retour à l'accueil", to: "/" }} />
    </Screen>
  );
}

/** Une famille de chemins derrière son interrupteur : ouverte, l'écran demandé ; fermée, « bientôt ». */
export function SiOuvert({ porte }: { porte: Porte }) {
  const ouvert = useOuvertures();
  if (!ouvert.pret) return null;
  return ouvert[porte] ? <Outlet /> : <PasEncoreOuvert porte={porte} />;
}
