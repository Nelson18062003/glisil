import { Box, CircularProgress } from "@mui/material";
import { createBrowserRouter, Navigate, Outlet, useLocation } from "react-router-dom";
import { ClientDetail, Clients } from "../pages/clients";
import { Connexion } from "../pages/connexion";
import { Entrees } from "../pages/entrees";
import { Journal } from "../pages/journal";
import { Marche } from "../pages/marche";
import { Parametres } from "../pages/parametres";
import { Sorties } from "../pages/sorties";
import { Tableau } from "../pages/tableau";
import { Terminaux } from "../pages/terminaux";
import { Wallets } from "../pages/wallets";
import { EquipePage } from "../pages/equipe";
import { useSession } from "../session/session";

function Attente() {
  return <Box sx={{ minHeight: "100dvh", display: "grid", placeItems: "center" }}><CircularProgress /></Box>;
}

function Garde() {
  const { pret, profil } = useSession();
  const location = useLocation();
  if (!pret) return <Attente />;
  if (!profil) return <Navigate to="/connexion" replace state={{ apres: location.pathname + location.search }} />;
  return <Outlet />;
}

function Porte() {
  const { pret, profil } = useSession();
  const location = useLocation();
  if (!pret) return <Attente />;
  if (profil) return <Navigate to={(location.state as { apres?: string } | null)?.apres ?? "/"} replace />;
  return <Outlet />;
}

export const routeur = createBrowserRouter([
  { element: <Porte />, children: [{ path: "/connexion", element: <Connexion /> }] },
  {
    element: <Garde />,
    children: [
      { path: "/", element: <Tableau /> },
      { path: "/entrees", element: <Entrees /> },
      { path: "/sorties", element: <Sorties /> },
      { path: "/terminaux", element: <Terminaux /> },
      { path: "/wallets", element: <Wallets /> },
      { path: "/clients", element: <Clients /> },
      { path: "/clients/:id", element: <ClientDetail /> },
      { path: "/marche", element: <Marche /> },
      { path: "/parametres", element: <Parametres /> },
      { path: "/journal", element: <Journal /> },
      { path: "/equipe", element: <EquipePage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
