import { Link, Text, TextHeading, TextSmall, TextTitlePage } from "primitives";
import type { ReactNode } from "react";
import * as admin from "./admin";
import * as client from "./client";

/*
 * Un chemin = un écran. Pas de routeur : les maquettes se visitent par
 * adresse (et se capturent une à une par le script de captures).
 */
const CLIENT: Record<string, { title: string; screen: () => ReactNode }> = {
  connexion: { title: "Connexion", screen: client.Connexion },
  portefeuille: { title: "Portefeuille", screen: client.Portefeuille },
  "entrer-xaf": { title: "Entrer des XAF (MoMo → XAFe)", screen: client.EntrerXAF },
  "suivi-depot": { title: "TOTEM détecte, XAFe crédités", screen: client.SuiviDepot },
  "sortir-xaf": { title: "Sortir des XAF (XAFe → MoMo)", screen: client.SortirXAF },
  marche: { title: "Marché spot XAFe/USDT", screen: client.Marche },
  crypto: { title: "Dépôt et retrait crypto (BEP20 · TRC20)", screen: client.Crypto },
  historique: { title: "Historique et références", screen: client.Historique },
  compte: { title: "Compte, paliers et limites", screen: client.Compte },
};

const ADMIN: Record<string, { title: string; screen: () => ReactNode }> = {
  reserves: { title: "Réserves et circulation", screen: admin.Reserves },
  entrees: { title: "Entrées (dépôts XAF)", screen: admin.Entrees },
  sorties: { title: "Sorties (retraits XAF)", screen: admin.Sorties },
  terminaux: { title: "Terminaux TOTEM", screen: admin.Terminaux },
  marche: { title: "Marché (surveillance et réglages)", screen: admin.Marche },
  clients: { title: "Clients et paliers", screen: admin.Clients },
};

function Index() {
  return (
    <div className="index">
      <div className="col">
        <TextTitlePage>Maquettes XAFe</TextTitlePage>
        <Text className="t-sec">
          Construites avec le Simple Design System de Figma. Client : application
          Android (390 px). Admin : application web (1440 px).
        </Text>
      </div>
      <div className="col">
        <TextHeading>Client (téléphone)</TextHeading>
        <div className="index-list">
          {Object.entries(CLIENT).map(([k, v], i) => (
            <Link key={k} href={`/client/${k}`}>
              {i + 1}. {v.title}
            </Link>
          ))}
        </div>
      </div>
      <div className="col">
        <TextHeading>Admin (web)</TextHeading>
        <div className="index-list">
          {Object.entries(ADMIN).map(([k, v], i) => (
            <Link key={k} href={`/admin/${k}`}>
              {i + 1}. {v.title}
            </Link>
          ))}
        </div>
      </div>
      <TextSmall className="t-sec">
        Les montants, taux et délais sont des exemples ; les limites de paliers et
        les adresses de contrats restent à fixer.
      </TextSmall>
    </div>
  );
}

export default function App() {
  const [, area, name] = window.location.pathname.split("/");
  if (area === "client" && name && CLIENT[name]) return <>{CLIENT[name].screen()}</>;
  if (area === "admin" && name && ADMIN[name]) return <>{ADMIN[name].screen()}</>;
  return <Index />;
}
