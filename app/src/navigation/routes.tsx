/*
 * Les chemins de l'application, tels que design/NAVIGATION.md les écrit : un
 * écran qui n'est pas ici n'existe pas. Les gardes : sans session → Bienvenue ;
 * profil incomplet → nom + code ; compte verrouillé → le verrou par-dessus
 * l'écran demandé, et l'on revient exactement là après le code.
 */
import { Box, CircularProgress } from "@mui/material";
import { createBrowserRouter, Navigate, Outlet, useLocation } from "react-router-dom";
import { Accueil, Notifications } from "../ecrans/accueil";
import { Bienvenue, BienvenueCode, BienvenueProfil, Verrouillage } from "../ecrans/bienvenue";
import { Inscription } from "../ecrans/bienvenue/inscription";
import { Compte, CompteAide, CompteApi, CompteFermer, CompteInformations, CompteNumeros, CompteNumerosAjouter, ComptePaliers, ComptePaliersEntreprise, ComptePaliersIdentite, CompteSecurite } from "../ecrans/compte";
import { Crypto, CryptoDeposer, CryptoEnvoye, CryptoRetirerAdresse, CryptoRetirerCode, CryptoRetirerMontant, CryptoRetirerVerifier } from "../ecrans/crypto";
import { EntrerCredite, EntrerMontant, EntrerOperateur, EntrerPayer, EntrerTransaction } from "../ecrans/entrer";
import { Historique, HistoriqueDetail } from "../ecrans/historique";
import { CompteFerme, Conditions, ConditionsAReaccepter, Confidentialite } from "../ecrans/legal";
import { Marche, MarcheCarnet, MarcheExecute, MarcheGraphique, MarcheOrdreDetail, MarcheOrdres } from "../ecrans/marche";
import { Rapide, RapideFait, RapidePrix } from "../ecrans/rapide";
import { SortirCode, SortirDestination, SortirEnvoye, SortirMontant, SortirVerifier } from "../ecrans/sortir";
import { useCompte } from "../guichet";
import { CadreApplication } from "../ui";
import { useSession } from "../session/session";

function Attente() {
  return (
    <Box sx={{ minHeight: "100dvh", display: "grid", placeItems: "center", bgcolor: "background.default" }}>
      <CircularProgress />
    </Box>
  );
}

/**
 * Les écrans qui demandent une session complète. Par-dessus l'écran demandé,
 * dans cet ordre : le compte fermé ou suspendu (rien d'autre n'est possible),
 * le verrou du code secret, puis les conditions à réaccepter quand leur
 * version a changé. Le compte se relit en direct : accepter, ou être rouvert
 * par l'équipe, rend l'écran demandé sans recharger.
 */
function Garde() {
  const { etat } = useSession();
  const location = useLocation();
  const { data } = useCompte();
  if (etat.phase === "chargement") return <Attente />;
  if (etat.phase === "anonyme") return <Navigate to="/bienvenue" replace state={{ apres: location.pathname + location.search }} />;
  if (etat.phase === "inscription") return <Navigate to="/bienvenue/inscription" replace />;
  if (etat.phase === "profil") return <Navigate to="/bienvenue/profil" replace />;
  const compte = data ?? etat.compte;
  if (compte.fermeLe || compte.desactive) return <CompteFerme />;
  if (etat.verrouille) return <Verrouillage />;
  if (!compte.conditionsAJour) return <ConditionsAReaccepter />;
  return <CadreApplication><Outlet /></CadreApplication>;
}

/** Les écrans d'entrée : une session complète les saute. */
function Porte() {
  const { etat } = useSession();
  const location = useLocation();
  if (etat.phase === "chargement") return <Attente />;
  if (etat.phase === "connecte") {
    const apres = (location.state as { apres?: string } | null)?.apres;
    return <Navigate to={apres && apres !== "/bienvenue" ? apres : "/"} replace />;
  }
  if (etat.phase === "inscription" && location.pathname !== "/bienvenue/inscription") return <Navigate to="/bienvenue/inscription" replace />;
  if (etat.phase === "profil" && location.pathname !== "/bienvenue/profil") return <Navigate to="/bienvenue/profil" replace />;
  if (etat.phase === "anonyme" && (location.pathname === "/bienvenue/profil" || location.pathname === "/bienvenue/inscription")) return <Navigate to="/bienvenue" replace />;
  return <Outlet />;
}

export const routeur = createBrowserRouter([
  /* les textes qui engagent se lisent sans compte : les magasins d'applications demandent une adresse publique */
  { path: "/conditions", element: <Conditions /> },
  { path: "/confidentialite", element: <Confidentialite /> },
  {
    element: <Porte />,
    children: [
      { path: "/bienvenue", element: <Bienvenue /> },
      { path: "/bienvenue/code", element: <BienvenueCode /> },
      { path: "/bienvenue/inscription", element: <Inscription /> },
      { path: "/bienvenue/profil", element: <BienvenueProfil /> },
    ],
  },
  {
    element: <Garde />,
    children: [
      { path: "/", element: <Accueil /> },
      { path: "/notifications", element: <Notifications /> },
      { path: "/verrouillage", element: <Navigate to="/" replace /> },

      { path: "/entrer/operateur", element: <EntrerOperateur /> },
      { path: "/entrer/montant", element: <EntrerMontant /> },
      { path: "/entrer/payer/:ref", element: <EntrerPayer /> },
      { path: "/entrer/transaction/:ref", element: <EntrerTransaction /> },
      { path: "/entrer/credite/:ref", element: <EntrerCredite /> },

      { path: "/sortir/montant", element: <SortirMontant /> },
      { path: "/sortir/destination", element: <SortirDestination /> },
      { path: "/sortir/verifier", element: <SortirVerifier /> },
      { path: "/sortir/code", element: <SortirCode /> },
      { path: "/sortir/envoye/:ref", element: <SortirEnvoye /> },

      { path: "/marche", element: <Marche /> },
      { path: "/marche/graphique", element: <MarcheGraphique /> },
      { path: "/marche/carnet", element: <MarcheCarnet /> },
      { path: "/marche/ordres", element: <MarcheOrdres /> },
      { path: "/marche/ordres/:id", element: <MarcheOrdreDetail /> },
      { path: "/marche/execute/:id", element: <MarcheExecute /> },

      { path: "/rapide", element: <Rapide /> },
      { path: "/rapide/prix", element: <RapidePrix /> },
      { path: "/rapide/fait", element: <RapideFait /> },

      { path: "/crypto", element: <Crypto /> },
      { path: "/crypto/deposer/:actif", element: <CryptoDeposer /> },
      { path: "/crypto/retirer/:actif/adresse", element: <CryptoRetirerAdresse /> },
      { path: "/crypto/retirer/:actif/montant", element: <CryptoRetirerMontant /> },
      { path: "/crypto/retirer/:actif/verifier", element: <CryptoRetirerVerifier /> },
      { path: "/crypto/retirer/:actif/code", element: <CryptoRetirerCode /> },
      { path: "/crypto/envoye/:ref", element: <CryptoEnvoye /> },

      { path: "/historique", element: <Historique /> },
      { path: "/historique/:ref", element: <HistoriqueDetail /> },

      { path: "/compte", element: <Compte /> },
      { path: "/compte/numeros", element: <CompteNumeros /> },
      { path: "/compte/numeros/ajouter", element: <CompteNumerosAjouter /> },
      { path: "/compte/paliers", element: <ComptePaliers /> },
      { path: "/compte/paliers/identite", element: <ComptePaliersIdentite /> },
      { path: "/compte/paliers/entreprise", element: <ComptePaliersEntreprise /> },
      { path: "/compte/securite", element: <CompteSecurite /> },
      { path: "/compte/api", element: <CompteApi /> },
      { path: "/compte/aide", element: <CompteAide /> },
      { path: "/compte/informations", element: <CompteInformations /> },
      { path: "/compte/fermer", element: <CompteFermer /> },

      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
