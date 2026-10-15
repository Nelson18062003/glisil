/*
 * L'ADMIN inscrit au contrat les adresses de dépôt XAFe que le veilleur a
 * préparées (le registre : seules ces adresses peuvent voir leurs XAFe
 * détruits). C'est un geste de l'admin, avec SA clé — en production, un
 * wallet matériel ; le veilleur n'a pas ce rôle.
 *
 *   BEP20_RPC=…  BEP20_XAFE=0x…  ADMIN_CLE=0x…  node --experimental-strip-types src/inscrire.ts 0xadresse1 0xadresse2 …
 */
import { Contract, JsonRpcProvider, Wallet } from "ethers";

export async function inscrire(rpcUrl: string, xafe: string, cleAdmin: string, adresses: string[]) {
  const admin = new Wallet(cleAdmin, new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true }));
  const c = new Contract(xafe, ["function inscrireAdressesDeDepot(address[] adresses, bool inscrites)"], admin);
  for (let i = 0; i < adresses.length; i += 100) await (await c.inscrireAdressesDeDepot(adresses.slice(i, i + 100), true)).wait(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { BEP20_RPC, BEP20_XAFE, ADMIN_CLE } = process.env;
  if (!BEP20_RPC || !BEP20_XAFE || !ADMIN_CLE) { console.error("✗ BEP20_RPC, BEP20_XAFE et ADMIN_CLE sont nécessaires"); process.exit(1); }
  await inscrire(BEP20_RPC, BEP20_XAFE, ADMIN_CLE, process.argv.slice(2));
  console.log(`✓ ${process.argv.length - 2} adresse(s) inscrites`);
}
