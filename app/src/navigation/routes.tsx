/*
 * Les chemins de l'application, tels que design/NAVIGATION.md les écrit : un
 * écran qui n'est pas ici n'existe pas. Les gardes : chaque phase de l'entrée
 * a son chemin (noyau/entree.ts) — sans session → Bienvenue ; puis le code
 * e-mail, le mot de passe (Google), l'application d'authentification, les
 * codes de secours, le profil. Une session complète saute l'entrée, et l'on
 * revient exactement à l'écran demandé.
 */
import { Box, CircularProgress } from "@mui/material";
import { createBrowserRouter, Navigate, Outlet, useLocation } from "react-router-dom";
import { Accueil, Notifications } from "../ecrans/accueil";
import { Bienvenue, BienvenueCode, RetourGoogle } from "../ecrans/bienvenue";
import { CodesDeSecoursAEcrire } from "../ecrans/bienvenue/codes-de-secours";
import { DeuxFacteurs, DeuxFacteursCode, Secours } from "../ecrans/bienvenue/deux-facteurs";
import { Inscription } from "../ecrans/bienvenue/inscription";
import { ChoisirMotDePasse, Oubli, OubliCode, OubliNouveau } from "../ecrans/bienvenue/mot-de-passe";
import { Compte, CompteAide, CompteApi, CompteFermer, CompteInformations, CompteNumeros, CompteNumerosAjouter, ComptePaliers, ComptePaliersEntreprise, ComptePaliersIdentite, CompteSecurite } from "../ecrans/compte";
import { Crypto, CryptoDeposer, CryptoEnvoye, CryptoRetirerAdresse, CryptoRetirerCode, CryptoRetirerMontant, CryptoRetirerVerifier } from "../ecrans/crypto";
import { EntrerCredite, EntrerMontant, EntrerOperateur, EntrerPayer, EntrerTransaction } from "../ecrans/entrer";
import { Historique, HistoriqueDetail } from "../ecrans/historique";
import { SiApprouve, SiOuvert, SiRetraitsOuverts } from "../ecrans/bientot";
import { t } from "../noyau/langue";
import { CompteFerme, Conditions, ConditionsAReaccepter, Confidentialite } from "../ecrans/legal";
import { Preuve } from "../ecrans/preuve";
import { Marche, MarcheCarnet, MarcheExecute, MarcheGraphique, MarcheOrdreDetail, MarcheOrdres, MarcheRegles } from "../ecrans/marche";
import { Rapide, RapideFait, RapidePrix } from "../ecrans/rapide";
import { SortirCode, SortirDestination, SortirEnvoye, SortirMontant, SortirVerifier } from "../ecrans/sortir";
import { useCompte } from "../guichet";
import { cheminDeLaPhase, cheminPermis } from "../noyau/entree";
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
 * puis les conditions à réaccepter quand leur version a changé. Le compte se
 * relit en direct : accepter, ou être rouvert par l'équipe, rend l'écran
 * demandé sans recharger.
 */
function Garde() {
  const { etat } = useSession();
  const location = useLocation();
  const { data } = useCompte(etat.phase === "connecte");
  if (etat.phase === "chargement") return <Attente />;
  if (etat.phase !== "connecte") return <Navigate to={cheminDeLaPhase(etat)} replace state={etat.phase === "anonyme" ? { apres: location.pathname + location.search } : undefined} />;
  const compte = data ?? etat.compte;
  if (compte.fermeLe || compte.desactive) return <CompteFerme />;
  if (!compte.conditionsAJour) return <ConditionsAReaccepter />;
  return <CadreApplication><Outlet /></CadreApplication>;
}

/** Les écrans d'entrée : chaque phase ouvre son chemin (et quelques voisins) ; une session complète les saute. */
function Porte() {
  const { etat } = useSession();
  const location = useLocation();
  if (etat.phase === "chargement") return <Attente />;
  if (etat.phase === "connecte") {
    const apres = (location.state as { apres?: string } | null)?.apres;
    return <Navigate to={apres && !apres.startsWith("/bienvenue") ? apres : "/"} replace />;
  }
  if (!cheminPermis(etat, location.pathname)) return <Navigate to={cheminDeLaPhase(etat)} replace state={location.state} />;
  return <Outlet />;
}

export const routeur = createBrowserRouter([
  /* les textes qui engagent se lisent sans compte : les magasins d'applications demandent une adresse publique */
  { path: "/conditions", element: <Conditions /> },
  { path: "/confidentialite", element: <Confidentialite /> },
  /* la preuve de réserve : publique, sans compte — n'importe qui vérifie 1 XAFe = 1 XAF */
  { path: "/preuve", element: <Preuve /> },
  {
    element: <Porte />,
    children: [
      { path: "/bienvenue", element: <Bienvenue /> },
      { path: "/bienvenue/code", element: <BienvenueCode /> },
      { path: "/bienvenue/retour", element: <RetourGoogle /> },
      { path: "/bienvenue/mot-de-passe", element: <ChoisirMotDePasse /> },
      { path: "/bienvenue/deux-facteurs", element: <DeuxFacteurs /> },
      { path: "/bienvenue/deux-facteurs/code", element: <DeuxFacteursCode /> },
      { path: "/bienvenue/secours", element: <Secours /> },
      { path: "/bienvenue/codes-de-secours", element: <CodesDeSecoursAEcrire /> },
      { path: "/bienvenue/inscription", element: <Inscription /> },
      { path: "/bienvenue/oubli", element: <Oubli /> },
      { path: "/bienvenue/oubli/code", element: <OubliCode /> },
      { path: "/bienvenue/oubli/nouveau", element: <OubliNouveau /> },
    ],
  },
  /* l'ancien écran du code secret : il n'existe plus, on rentre par l'entrée */
  { path: "/bienvenue/profil", element: <Navigate to="/bienvenue" replace /> },
  {
    element: <Garde />,
    children: [
      { path: "/", element: <Accueil /> },
      { path: "/notifications", element: <Notifications /> },
      { path: "/verrouillage", element: <Navigate to="/" replace /> },

      /* les dépôts réels : fermés pendant la bêta, sauf pour un compte autorisé ; le suivi d'un dépôt déjà ouvert reste lisible */
      /* 0047 : chaque geste d'argent attend aussi que l'équipe ait approuvé le compte */
      { element: <SiOuvert porte="entrees" />, children: [{ element: <SiApprouve ecran={() => t("Entrer des XAF", "Add XAF")} />, children: [
        { path: "/entrer/operateur", element: <EntrerOperateur /> },
        { path: "/entrer/montant", element: <EntrerMontant /> },
      ] }] },
      { path: "/entrer/payer/:ref", element: <EntrerPayer /> },
      { path: "/entrer/transaction/:ref", element: <EntrerTransaction /> },
      { path: "/entrer/credite/:ref", element: <EntrerCredite /> },

      /* 0048 : et rien ne sort pendant la pause qui suit un changement de sécurité */
      { element: <SiOuvert porte="sorties" />, children: [{ element: <SiApprouve ecran={() => t("Sortir des XAF", "Withdraw XAF")} />, children: [{ element: <SiRetraitsOuverts ecran={() => t("Sortir des XAF", "Withdraw XAF")} />, children: [
        { path: "/sortir/montant", element: <SortirMontant /> },
        { path: "/sortir/destination", element: <SortirDestination /> },
        { path: "/sortir/verifier", element: <SortirVerifier /> },
        { path: "/sortir/code", element: <SortirCode /> },
      ] }] }] },
      { path: "/sortir/envoye/:ref", element: <SortirEnvoye /> },

      { element: <SiOuvert porte="marche" />, children: [
        { path: "/marche", element: <Marche /> },
        { path: "/marche/graphique", element: <MarcheGraphique /> },
        { path: "/marche/carnet", element: <MarcheCarnet /> },
        { path: "/marche/regles", element: <MarcheRegles /> },
      ] },
      { path: "/marche/ordres", element: <MarcheOrdres /> },
      { path: "/marche/ordres/:id", element: <MarcheOrdreDetail /> },
      { path: "/marche/execute/:id", element: <MarcheExecute /> },

      { element: <SiOuvert porte="rapide" />, children: [{ element: <SiApprouve ecran={() => t("Acheter ou vendre", "Buy or sell")} />, children: [
        { path: "/rapide", element: <Rapide /> },
        { path: "/rapide/prix", element: <RapidePrix /> },
      ] }] },
      { path: "/rapide/fait", element: <RapideFait /> },

      { element: <SiOuvert porte="crypto" />, children: [{ path: "/crypto", element: <Crypto /> }] },
      { element: <SiOuvert porte="cryptoDepots" />, children: [{ element: <SiApprouve ecran={() => t("Déposer", "Deposit")} retour="/crypto" />, children: [
        { path: "/crypto/deposer/:actif", element: <CryptoDeposer /> },
      ] }] },
      { element: <SiOuvert porte="cryptoRetraits" />, children: [{ element: <SiApprouve ecran={() => t("Retirer", "Withdraw")} retour="/crypto" />, children: [{ element: <SiRetraitsOuverts ecran={() => t("Retirer", "Withdraw")} retour="/crypto" />, children: [
        { path: "/crypto/retirer/:actif/adresse", element: <CryptoRetirerAdresse /> },
        { path: "/crypto/retirer/:actif/montant", element: <CryptoRetirerMontant /> },
        { path: "/crypto/retirer/:actif/verifier", element: <CryptoRetirerVerifier /> },
        { path: "/crypto/retirer/:actif/code", element: <CryptoRetirerCode /> },
      ] }] }] },
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
