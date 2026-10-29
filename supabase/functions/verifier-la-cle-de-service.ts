// LA CLÉ DE SERVICE, DANS LES EN-TÊTES DU VEILLEUR.
//
//   node --experimental-strip-types supabase/functions/verifier-la-cle-de-service.ts
//
// Un projet Supabase neuf peut donner des clés « sb_secret_… », qui ne sont pas
// des JWT : envoyées en « Authorization: Bearer », l'API les refuse et le
// veilleur ne fait plus rien. Témoin : l'ancienne règle (Bearer toujours).
import assert from "node:assert/strict";
import { entetesDeService } from "../../chaine/src/moteur.ts";

const jwt = "entete-factice.charge-factice.signature-factice";   // la FORME d'un JWT, rien de plus
const neuve = "sb_secret_" + "factice";

assert.deepEqual(entetesDeService(jwt), { apikey: jwt, authorization: `Bearer ${jwt}`, "content-type": "application/json" });
assert.deepEqual(entetesDeService(neuve), { apikey: neuve, "content-type": "application/json" });
console.log("  ✓ une clé héritée (JWT) va en apikey et en Bearer ; une clé sb_secret_ en apikey seulement");

const ancienne = (cle: string) => ({ apikey: cle, authorization: `Bearer ${cle}`, "content-type": "application/json" });
assert.notDeepEqual(ancienne(neuve), entetesDeService(neuve), "témoin : l'ancienne règle mettait sb_secret_ en Bearer");
console.log("  ✓ témoin pris : l'ancienne règle envoyait sb_secret_ en Bearer");
console.log("✓ la clé de service va où l'API l'attend");
