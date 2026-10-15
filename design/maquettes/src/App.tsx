import { Box, Link, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { Accueil } from "./screens/accueil";
import { Compte } from "./screens/compte";
import { Code, Connexion } from "./screens/connexion";
import { Crypto, CryptoDeposer } from "./screens/crypto";
import { EntrerConfirme, EntrerMontant, EntrerOperateur, EntrerPayer } from "./screens/entrer";
import { Historique, HistoriqueDetail } from "./screens/historique";
import { Marche, MarcheCarnet, MarcheGraphique, MarcheOrdrePlace, MarcheOrdres } from "./screens/marche";
import { SortirDestination, SortirMontant, SortirRecap } from "./screens/sortir";

/* Un chemin = un écran. L'ordre est celui du parcours, et celui des captures. */
export const SCREENS: { path: string; title: string; screen: () => ReactNode }[] = [
  { path: "connexion", title: "Connexion", screen: Connexion },
  { path: "code", title: "Code reçu par SMS", screen: Code },
  { path: "accueil", title: "Accueil", screen: Accueil },
  { path: "entrer/operateur", title: "Entrer des XAF · d'où vient l'argent", screen: EntrerOperateur },
  { path: "entrer/montant", title: "Entrer des XAF · montant", screen: EntrerMontant },
  { path: "entrer/payer", title: "Entrer des XAF · payer", screen: EntrerPayer },
  { path: "entrer/confirme", title: "Entrer des XAF · crédité par TOTEM", screen: EntrerConfirme },
  { path: "sortir/montant", title: "Sortir des XAF · montant", screen: SortirMontant },
  { path: "sortir/destination", title: "Sortir des XAF · vers quel numéro", screen: SortirDestination },
  { path: "sortir/recap", title: "Sortir des XAF · vérifier et confirmer", screen: SortirRecap },
  { path: "marche", title: "Marché spot · formulaire d'ordre et carnet", screen: Marche },
  { path: "marche/graphique", title: "Marché · graphique et statistiques", screen: MarcheGraphique },
  { path: "marche/carnet", title: "Marché · carnet complet et transactions", screen: MarcheCarnet },
  { path: "marche/ordres", title: "Marché · mes ordres", screen: MarcheOrdres },
  { path: "marche/ordre-place", title: "Marché · ordre exécuté", screen: MarcheOrdrePlace },
  { path: "crypto", title: "Crypto", screen: Crypto },
  { path: "crypto/deposer", title: "Crypto · déposer des USDT", screen: CryptoDeposer },
  { path: "historique", title: "Historique", screen: Historique },
  { path: "historique/detail", title: "Historique · détail d'une opération", screen: HistoriqueDetail },
  { path: "compte", title: "Compte", screen: Compte },
];

function Index() {
  return (
    <Box sx={{ maxWidth: 720, mx: "auto", p: 4 }}>
      <Typography variant="h4" gutterBottom>
        Glisil · maquettes
      </Typography>
      <Typography variant="body2" gutterBottom>
        Application Android (412 × 915). Un écran, une chose.
      </Typography>
      <Stack gap={1} mt={3}>
        {SCREENS.map((s, i) => (
          <Link key={s.path} href={`/client/${s.path}`} underline="hover">
            {i + 1}. {s.title}
          </Link>
        ))}
      </Stack>
    </Box>
  );
}

export default function App() {
  const path = window.location.pathname.replace(/^\/client\//, "").replace(/\/$/, "");
  const found = SCREENS.find((s) => s.path === path);
  return found ? <>{found.screen()}</> : <Index />;
}
