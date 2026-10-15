// LA PORTE DE TOTEM, ATTAQUÉE.
//
//   node --experimental-strip-types supabase/functions/verifier-la-porte.ts
//
// Fait tourner le VRAI code de la porte (_shared/porte.ts) sous Node, devant un
// faux moteur, et essaie d'entrer : sans signature, avec une mauvaise clé, avec
// une signature d'hier, avec un corps retouché, au nom d'un autre terminal.
// Puis vérifie que ce qui passe arrive au moteur avec les bons arguments, lot
// compris, et que le guichet des commandes réclame, rend compte, et refuse
// une commande déjà prise. « Deno.serve » n'est pas éprouvé ici : c'est une
// ligne ; tout le reste l'est.
import assert from "node:assert/strict";
import { FENETRE_SECONDES, lireEntetes, signer, traiterCommandes, traiterSms, verifier } from "./_shared/porte.ts";

const CLES: Record<string, string> = { "akwa-1": "secret-akwa", "bonaberi-2": "secret-bonaberi" };
const cleDuTerminal = async (t: string) => CLES[t] ?? null;
const maintenant = () => 1_760_000_000;

const entetes = (terminal: string, horodatage: number | string, signature: string) =>
  lireEntetes({ get: (n) => ({ "x-totem-terminal": terminal, "x-totem-horodatage": String(horodatage), "x-totem-signature": signature })[n] ?? null });

let n = 0;
const ok = (texte: string) => { n++; console.log(`✓ ${texte}`); };

/* ------------------------------------------------------- la signature */
{
  const corps = JSON.stringify({ source_id: 1 });
  const bonne = await signer("secret-akwa", maintenant(), corps);
  assert.equal(await verifier(entetes("akwa-1", maintenant(), bonne), corps, cleDuTerminal, maintenant), null);
  ok("une requête bien signée entre");

  const refus = (r: unknown) => assert.deepEqual(r, { statut: 401, corps: { erreur: "signature refusée" } });
  refus(await verifier(entetes("akwa-1", maintenant(), "0".repeat(64)), corps, cleDuTerminal, maintenant));
  refus(await verifier(entetes("akwa-1", maintenant(), await signer("mauvaise", maintenant(), corps)), corps, cleDuTerminal, maintenant));
  refus(await verifier(entetes("inconnu", maintenant(), await signer("secret-akwa", maintenant(), corps)), corps, cleDuTerminal, maintenant));
  refus(await verifier(entetes("akwa-1", maintenant(), bonne), corps + " ", cleDuTerminal, maintenant));
  refus(await verifier(lireEntetes({ get: () => null }), corps, cleDuTerminal, maintenant));
  ok("sans signature, avec une mauvaise clé, un terminal inconnu ou un corps retouché : refusé, toujours de la même façon");

  const vieux = maintenant() - FENETRE_SECONDES - 1;
  refus(await verifier(entetes("akwa-1", vieux, await signer("secret-akwa", vieux, corps)), corps, cleDuTerminal, maintenant));
  const limite = maintenant() - FENETRE_SECONDES;
  assert.equal(await verifier(entetes("akwa-1", limite, await signer("secret-akwa", limite, corps)), corps, cleDuTerminal, maintenant), null);
  ok("une signature de plus de cinq minutes est refusée : rejouer une vieille requête ne sert à rien");

  /* la signature de bonaberi, présentée au nom d'akwa : refusée — un boîtier ne parle que pour lui */
  refus(await verifier(entetes("akwa-1", maintenant(), await signer("secret-bonaberi", maintenant(), corps)), corps, cleDuTerminal, maintenant));
  ok("la clé d'un autre boîtier ne vaut rien ici");
}

/* ---------------------------------------------------------- les SMS */
{
  const appels: { nom: string; args: Record<string, unknown> }[] = [];
  const rpc = async (nom: string, args: Record<string, unknown>) => {
    appels.push({ nom, args });
    if (args.p_source_id === 13) throw new Error("solde insuffisant");
    return { resultat: args.p_reference === "20394817101" ? "credite" : "retenue", reference: "XAFe-DP-000418" };
  };
  const ligne = { terminal: "akwa-1", source_id: 48213, operateur: "mtn", float_numero: "677000000", sens: "entree", montant: 1000000, numero: "677123456", reference: "20394817101", texte: "Vous avez recu…", emis_le: "2026-10-12T13:02:11Z" };
  const r = await traiterSms(rpc, "akwa-1", ligne);
  assert.equal(r.statut, 200);
  assert.deepEqual(r.corps, { source_id: 48213, resultat: "credite", reference: "XAFe-DP-000418" });
  assert.deepEqual(appels[0], { nom: "totem_sms_recu", args: { p_terminal: "akwa-1", p_source_id: 48213, p_operateur: "mtn", p_float_numero: "677000000", p_numero_payeur: "677123456", p_montant: 1000000, p_reference: "20394817101", p_texte: "Vous avez recu…", p_emis_le: "2026-10-12T13:02:11Z" } });
  ok("un SMS arrive au moteur avec exactement ses champs, et la réponse du moteur revient au boîtier");

  const lot = await traiterSms(rpc, "akwa-1", { lignes: [ligne, { ...ligne, source_id: 2, reference: "X" }, { ...ligne, source_id: 3, sens: "sortie" }, { ...ligne, source_id: 13 }, { ...ligne, source_id: 4, terminal: "bonaberi-2" }, { source_id: "" }] });
  assert.equal(lot.statut, 200);
  const res = lot.corps as Record<string, unknown>[];
  assert.equal(res.length, 6);
  assert.equal(res[0].resultat, "credite");
  assert.equal(res[1].resultat, "retenue");
  assert.equal(res[2].resultat, "ignore");
  assert.equal(res[3].resultat, "erreur");
  assert.equal(res[4].resultat, "refuse");
  assert.equal(res[5].resultat, "refuse");
  assert.equal(appels.length, 4, "quatre lignes ont atteint le moteur : les deux bonnes, celle qui échoue, et celle de l'autre terminal n'y va pas");
  ok("un lot se traite ligne par ligne : une ligne cassée, une sortie, une ligne d'un autre boîtier ne font pas tomber les autres");

  assert.equal((await traiterSms(rpc, "akwa-1", { lignes: [] })).statut, 400);
  ok("un lot vide est refusé");
}

/* ----------------------------------------------------- les commandes */
{
  const appels: { nom: string; args: Record<string, unknown> }[] = [];
  let prise = false;
  const rpc = async (nom: string, args: Record<string, unknown>) => {
    appels.push({ nom, args });
    if (nom === "totem_commandes_en_attente") return [{ id: 7, parametres: { operateur: "mtn", numero: "677123456", montant: 746250 } }];
    if (nom === "totem_reclamer_commande") { if (prise) throw new Error("commande déjà prise ou inconnue"); prise = true; return { id: 7, etat: "en_cours" }; }
    if (nom === "totem_resultat_commande") return { commande: args.p_ok ? "faite" : "en_attente", sortie: "en_cours" };
    if (nom === "totem_messages_en_attente") return [{ id: 3, numero: "699112233", texte: "XAFe Exchange : votre code est 123456." }];
    if (nom === "totem_resultat_message") return { message: args.p_ok ? "envoye" : "echoue" };
    if (nom === "totem_remboursements_en_attente") return [{ id: 5, numero: "670999333", montant: 15000 }];
    if (nom === "totem_reclamer_remboursement") return { id: 5, etat: "en_cours" };
    if (nom === "totem_resultat_remboursement") return { remboursement: args.p_ok ? "fait" : "echoue" };
    throw new Error(`rpc inattendue ${nom}`);
  };
  const url = (chemin: string) => new URL(`https://x.supabase.co/functions/v1/totem-commandes${chemin}`);

  const liste = await traiterCommandes(rpc, "akwa-1", "GET", url("?type=transferts"), null);
  assert.equal(liste.statut, 200);
  assert.equal((liste.corps as unknown[]).length, 1);
  assert.deepEqual(appels[0], { nom: "totem_commandes_en_attente", args: { p_terminal: "akwa-1" } });
  ok("GET relève les transferts en attente DE CE terminal");

  const r1 = await traiterCommandes(rpc, "akwa-1", "PATCH", url("/7"), { etat: "en_cours" });
  assert.equal(r1.statut, 200);
  const r2 = await traiterCommandes(rpc, "akwa-1", "PATCH", url("/7"), { etat: "en_cours" });
  assert.equal(r2.statut, 409, "la même commande réclamée deux fois : la seconde est refusée, 409");
  ok("réclamer une commande ne réussit qu'une fois");

  const fait = await traiterCommandes(rpc, "akwa-1", "PATCH", url("/7"), { etat: "faite", resultat: "Transfert reussi", reference_operateur: "20394817999" });
  assert.deepEqual(appels[appels.length - 1], { nom: "totem_resultat_commande", args: { p_id: 7, p_terminal: "akwa-1", p_ok: true, p_resultat: "Transfert reussi", p_reference_operateur: "20394817999" } });
  assert.deepEqual(fait.corps, { commande: "faite", sortie: "en_cours" });
  const rate = await traiterCommandes(rpc, "akwa-1", "PATCH", url("/7"), { etat: "echouee", resultat: "réseau muet" });
  assert.equal((appels[appels.length - 1].args as Record<string, unknown>).p_ok, false);
  assert.equal(rate.statut, 200);
  ok("rendre compte transmet le résultat et la référence de l'opérateur, en bien comme en mal");

  const sms = await traiterCommandes(rpc, "akwa-1", "GET", url("?type=sms"), null);
  assert.equal((sms.corps as unknown[]).length, 1);
  const envoye = await traiterCommandes(rpc, "akwa-1", "PATCH", url("/3"), { type: "sms", etat: "envoye" });
  assert.deepEqual(appels[appels.length - 1], { nom: "totem_resultat_message", args: { p_id: 3, p_terminal: "akwa-1", p_ok: true, p_resultat: null } });
  assert.deepEqual(envoye.corps, { message: "envoye" });
  ok("les SMS à envoyer passent par le même guichet, avec leur propre type");

  await traiterCommandes(rpc, "akwa-1", "PATCH", url("/7"), { etat: "echouee", resultat: "réseau muet", tentative: 2 });
  assert.deepEqual(appels[appels.length - 1].args, { p_id: 7, p_terminal: "akwa-1", p_ok: false, p_resultat: "réseau muet", p_reference_operateur: null, p_tentative: 2 });
  const avant = appels.length;
  assert.equal((await traiterCommandes(rpc, "akwa-1", "PATCH", url("/7"), { etat: "echouee", tentative: "deux" })).statut, 400);
  assert.equal(appels.length, avant, "une tentative illisible n'atteint pas le moteur");
  ok("un transfert rend compte de SA tentative : le moteur reconnaît un échec renvoyé faute d'accusé");

  const rbt = await traiterCommandes(rpc, "akwa-1", "GET", url("?type=remboursements"), null);
  assert.deepEqual(appels[appels.length - 1], { nom: "totem_remboursements_en_attente", args: { p_terminal: "akwa-1" } });
  assert.equal((rbt.corps as unknown[]).length, 1);
  await traiterCommandes(rpc, "akwa-1", "PATCH", url("/5"), { type: "remboursements", etat: "en_cours" });
  assert.deepEqual(appels[appels.length - 1], { nom: "totem_reclamer_remboursement", args: { p_id: 5, p_terminal: "akwa-1" } });
  const rendu = await traiterCommandes(rpc, "akwa-1", "PATCH", url("/5"), { type: "remboursements", etat: "fait", resultat: "Transfert reussi", reference_operateur: "20394817999", tentative: 0 });
  assert.deepEqual(appels[appels.length - 1], { nom: "totem_resultat_remboursement", args: { p_id: 5, p_terminal: "akwa-1", p_ok: true, p_resultat: "Transfert reussi", p_reference_operateur: "20394817999" } });
  assert.deepEqual(rendu.corps, { remboursement: "fait" });
  ok("les remboursements ont leur guichet : relevés, réclamés, rendus — l'argent retenu repart vraiment au payeur");

  assert.equal((await traiterCommandes(rpc, "akwa-1", "PATCH", url("/7"), { etat: "bizarre" })).statut, 400);
  assert.equal((await traiterCommandes(rpc, "akwa-1", "DELETE", url("/7"), null)).statut, 405);
  assert.equal((await traiterCommandes(rpc, "akwa-1", "GET", url("?type=autre"), null)).statut, 400);
  assert.equal((await traiterCommandes(rpc, "akwa-1", "GET", url("?type=constructor"), null)).statut, 400, "un nom hérité d'Object n'est pas un guichet");
  ok("un état inconnu, un verbe inconnu, un type inconnu : refusés avant le moteur");
}

console.log(`✓ la porte tient (${n} vérifications)`);
