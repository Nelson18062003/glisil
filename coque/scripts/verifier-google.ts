// « Continuer avec Google » dans la coque : la seule adresse qu'on ouvre, et le retour rendu à la page.
//   node --experimental-strip-types scripts/verifier-google.ts
import assert from 'node:assert/strict';
import { RETOUR_GOOGLE, estAdresseGoogleDeSupabase, scriptDeRetourGoogle } from '../src/pont.ts';

const bonne = 'https://dfixghiwqlwulmzixlpf.supabase.co/auth/v1/authorize?provider=google&redirect_to=glisil%3A%2F%2Fauth-retour&code_challenge=x';
assert.equal(estAdresseGoogleDeSupabase(bonne), true, 'la page d\'autorisation de Supabase, pour Google');
for (const mauvaise of [
  'http://dfixghiwqlwulmzixlpf.supabase.co/auth/v1/authorize?provider=google',          // pas https
  'https://dfixghiwqlwulmzixlpf.supabase.co.piege.com/auth/v1/authorize?provider=google', // un faux domaine
  'https://piege.com/auth/v1/authorize?provider=google',
  'https://dfixghiwqlwulmzixlpf.supabase.co/rest/v1/rpc/x?provider=google',              // pas l'autorisation
  'https://dfixghiwqlwulmzixlpf.supabase.co/auth/v1/authorize?provider=github',
  'javascript:alert(1)',
]) assert.equal(estAdresseGoogleDeSupabase(mauvaise), false, mauvaise);
console.log('  ✓ seule la page d\'autorisation Google d\'un projet Supabase s\'ouvre');

const piege = `${RETOUR_GOOGLE}?code=abc"); alert(1); ("`;
const s = scriptDeRetourGoogle(piege);
const m = /^window\.dispatchEvent\(new CustomEvent\('glisil:retour-oauth', \{ detail: (".*") \}\)\); true;$/.exec(s);
assert.ok(m, s);
assert.equal(JSON.parse(m![1]), piege, 'le retour est une chaîne JSON entière, jamais du code');
console.log('  ✓ le retour arrive à la page comme une donnée, jamais comme du code');
console.log('✓ la coque ouvre Google comme il faut');
