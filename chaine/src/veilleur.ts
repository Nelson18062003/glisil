/*
 * LE VEILLEUR DE CHAÎNE : un tour toutes les quelques secondes.
 *   1. garder des adresses de dépôt prêtes (dérivées de la graine) ;
 *   2. créditer les dépôts assez confirmés ;
 *   3. balayer les adresses de dépôt vers le wallet chaud ;
 *   4. envoyer les retraits, reprendre ceux déjà signés, confirmer.
 *
 *   XAFE_GRAINE=…  MOTEUR_URL=https://<projet>.supabase.co/rest/v1  MOTEUR_CLE=<clé de service>
 *   BEP20_RPC=…  BEP20_USDT=0x…  BEP20_XAFE=0x…  [BEP20_CONFIRMATIONS=15]  [PAUSE_SECONDES=15]
 *   npm run veilleur
 */
import { ChaineBep20 } from "./bep20.ts";
import { graineValide } from "./cles.ts";
import { moteur, type Rpc } from "./moteur.ts";

export async function tour(chaine: ChaineBep20, rpc: Rpc) {
  const adresses = await chaine.preparerAdresses(rpc);
  const credites = await chaine.crediterDepots(rpc);
  const balayees = await chaine.balayer(rpc);
  const retraits = await chaine.envoyerRetraits(rpc);
  return { ...adresses, credites, balayees, ...retraits };
}

async function principal() {
  const env = process.env;
  const graine = env.XAFE_GRAINE ?? "";
  if (!graineValide(graine)) { console.error("✗ XAFE_GRAINE manque ou n'est pas une graine valide (12 ou 24 mots)"); process.exit(1); }
  for (const k of ["MOTEUR_URL", "MOTEUR_CLE", "BEP20_RPC", "BEP20_USDT", "BEP20_XAFE"]) if (!env[k]) { console.error(`✗ ${k} manque`); process.exit(1); }
  const rpc = moteur(env.MOTEUR_URL!, env.MOTEUR_CLE!);
  const chaine = new ChaineBep20({ rpcUrl: env.BEP20_RPC!, usdt: env.BEP20_USDT!, xafe: env.BEP20_XAFE!, graine, confirmations: Number(env.BEP20_CONFIRMATIONS ?? 15) });
  await chaine.demarrer();
  console.log(`· veilleur BEP20, wallet chaud ${chaine.chaud.address}`);
  const pause = Number(env.PAUSE_SECONDES ?? 15) * 1000;
  for (;;) {
    try {
      const b = await tour(chaine, rpc);
      if (b.credites || b.envoyes || b.confirmes || b.echoues || b.balayees || b.ajoutees) console.log(`· ${new Date().toISOString()} ${JSON.stringify(b)}`);
    } catch (e) {
      console.error(`✗ ${new Date().toISOString()} ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, pause));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) void principal();
