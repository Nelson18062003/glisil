import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/** Le seul projet Supabase de la production : un build « production » qui viserait un autre est refusé. */
export const PROJET_DE_PRODUCTION = "https://dfixghiwqlwulmzixlpf.supabase.co";

/**
 * Le build de PRODUCTION se ferme au lieu de se rabattre : sans l'URL et la clé
 * du moteur, l'application tournerait en DÉMONSTRATION (un guichet en mémoire,
 * qui accepte n'importe quoi) sur le vrai domaine. Vercel pose VERCEL_ENV ;
 * un build local (les harnais, la démo) n'en a pas et ne change pas.
 * Éprouvé par scripts/verifier-le-build-de-production.mjs.
 */
export function exigerLaProduction(env: Record<string, string | undefined>): void {
  if (env.VERCEL_ENV !== "production") return;
  if (env.VITE_GUICHET === "demo") return;   // une démonstration voulue, dite comme telle
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    throw new Error("build de production sans VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY : refusé (sinon, la démonstration irait en ligne)");
  }
  if (env.VITE_PROFIL === "production" && env.VITE_SUPABASE_URL.replace(/\/$/, "") !== PROJET_DE_PRODUCTION) {
    throw new Error(`VITE_PROFIL=production vise ${env.VITE_SUPABASE_URL} : seul ${PROJET_DE_PRODUCTION} est la production`);
  }
}

export default defineConfig(({ mode }) => {
  exigerLaProduction({ ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env });
  return {
    plugins: [react()],
    base: "/",
    build: { target: "es2020", sourcemap: false },
  };
});
