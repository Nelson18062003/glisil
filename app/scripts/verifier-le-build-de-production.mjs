// LE BUILD DE PRODUCTION SE FERME, IL NE SE RABAT PAS.
//
//   node --experimental-strip-types scripts/verifier-le-build-de-production.mjs
//
// Joue la règle de vite.config.ts (exigerLaProduction) comme Vercel la jouerait.
// Témoin : la configuration d'avant ne refusait rien — elle bâtissait la
// démonstration sur le vrai domaine dès qu'une variable manquait.
import assert from "node:assert/strict";
import { exigerLaProduction, PROJET_DE_PRODUCTION } from "../vite.config.ts";

const refuse = (env) => { try { exigerLaProduction(env); return false; } catch { return true; } };
const cle = "eyJ.cle.publique";

assert.equal(refuse({}), false, "un build local, sans VERCEL_ENV : inchangé");
assert.equal(refuse({ VERCEL_ENV: "preview" }), false, "une préversion (la bêta) : inchangée");
assert.equal(refuse({ VERCEL_ENV: "production" }), true, "production sans URL ni clé : refusé");
assert.equal(refuse({ VERCEL_ENV: "production", VITE_SUPABASE_URL: PROJET_DE_PRODUCTION }), true, "production sans clé : refusé");
assert.equal(refuse({ VERCEL_ENV: "production", VITE_GUICHET: "demo" }), false, "une démonstration voulue : permise");
assert.equal(refuse({ VERCEL_ENV: "production", VITE_PROFIL: "production", VITE_SUPABASE_URL: "https://erngzpklfslbfznioxxr.supabase.co", VITE_SUPABASE_ANON_KEY: cle }), true,
  "le profil de production qui vise la bêta : refusé");
assert.equal(refuse({ VERCEL_ENV: "production", VITE_PROFIL: "production", VITE_SUPABASE_URL: PROJET_DE_PRODUCTION, VITE_SUPABASE_ANON_KEY: cle }), false,
  "le profil de production sur son projet : permis");
console.log("  ✓ sans configuration, le build de production refuse ; une démonstration voulue passe ; la production ne vise que son projet");

const avant = () => {};   // la configuration d'avant : aucune règle
assert.equal((() => { try { avant({ VERCEL_ENV: "production" }); return false; } catch { return true; } })(), false, "témoin : l'ancienne configuration laissait passer");
console.log("  ✓ témoin pris : l'ancienne configuration bâtissait la démonstration en production");
console.log("✓ le build de production se ferme");
