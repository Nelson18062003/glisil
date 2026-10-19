import { CssBaseline, ThemeProvider } from "@mui/material";
import { StrictMode, useSyncExternalStore, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { GuichetProvider, ouvrirLeGuichet } from "./guichet";
import { routeur } from "./navigation/routes";
import { SessionProvider } from "./session/session";
import { theme } from "./theme";
import { abonnerLangue, langue } from "./noyau/langue";

const guichet = ouvrirLeGuichet();
document.documentElement.lang = langue();

/** Changer de langue remonte les écrans : tout texte, où qu'il soit calculé, est relu dans la nouvelle langue. */
function LangueProvider({ children }: { children: ReactNode }) {
  const l = useSyncExternalStore(abonnerLangue, langue);
  return <div key={l} style={{ display: "contents" }}>{children}</div>;
}

createRoot(document.getElementById("racine")!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GuichetProvider guichet={guichet}>
        <SessionProvider>
          <LangueProvider>
            <RouterProvider router={routeur} />
          </LangueProvider>
        </SessionProvider>
      </GuichetProvider>
    </ThemeProvider>
  </StrictMode>,
);
