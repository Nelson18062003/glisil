import { CssBaseline, ThemeProvider } from "@mui/material";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { GuichetProvider, ouvrirLeGuichet } from "./guichet";
import { routeur } from "./navigation/routes";
import { SessionProvider } from "./session/session";
import { theme } from "./theme";

const guichet = ouvrirLeGuichet();

createRoot(document.getElementById("racine")!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GuichetProvider guichet={guichet}>
        <SessionProvider>
          <RouterProvider router={routeur} />
        </SessionProvider>
      </GuichetProvider>
    </ThemeProvider>
  </StrictMode>,
);
