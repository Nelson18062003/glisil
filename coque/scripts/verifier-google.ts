// « Continuer avec Google » dans la coque : la seule adresse qu'on ouvre, et le retour rendu à la page.
//   node --experimental-strip-types scripts/verifier-google.ts
import assert from 'node:assert/strict';
import { RETOUR_GOOGLE, SCRIPT_INJECTE, estAdresseGoogleDeSupabase, estAdresseGoogleDirecte, scriptDeRetourGoogle } from '../src/pont.ts';

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

const BASE = 'https://app.glisil.com';
const directe = (q: Record<string, string>) => `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
  client_id: '1-a.apps.googleusercontent.com', redirect_uri: `${BASE}/bienvenue/retour`, response_type: 'id_token',
  scope: 'openid email profile', nonce: 'n', state: 'c.e', ...q }).toString()}`;
assert.equal(estAdresseGoogleDirecte(directe({}), BASE), true, 'la page de Google, retour sur l\'application');
for (const mauvaise of [
  directe({ redirect_uri: 'https://piege.com/bienvenue/retour' }),          // le jeton partirait ailleurs
  directe({ redirect_uri: `${BASE}.piege.com/bienvenue/retour` }),
  directe({ redirect_uri: `${BASE}/autre` }),
  directe({ response_type: 'code' }),
  directe({}).replace('accounts.google.com', 'accounts.google.com.piege.com'),
  directe({}).replace('https:', 'http:'),
  directe({}).replace('/o/oauth2/v2/auth', '/o/oauth2/v2/autre'),
]) assert.equal(estAdresseGoogleDirecte(mauvaise, BASE), false, mauvaise);
/* TÉMOIN : l'ancien contrôle refuse le chemin direct — d'où le pont v3, que l'application attend avant de s'en servir */
assert.equal(estAdresseGoogleDeSupabase(directe({})), false);
assert.match(SCRIPT_INJECTE, /version: 3, google: true/);
console.log('  ✓ le chemin direct ne s\'ouvre que vers Google, avec le retour de l\'application (pont v3)');

const piege = `${RETOUR_GOOGLE}?code=abc"); alert(1); ("`;
const s = scriptDeRetourGoogle(piege);
const m = /^window\.dispatchEvent\(new CustomEvent\('glisil:retour-oauth', \{ detail: (".*") \}\)\); true;$/.exec(s);
assert.ok(m, s);
assert.equal(JSON.parse(m![1]), piege, 'le retour est une chaîne JSON entière, jamais du code');
console.log('  ✓ le retour arrive à la page comme une donnée, jamais comme du code');
console.log('✓ la coque ouvre Google comme il faut');
