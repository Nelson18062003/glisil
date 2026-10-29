"""LA CHAÎNE RÉELLE : de vrais formats de SMS d'opérateurs, lus par le VRAI
robot TOTEM, jusqu'au VRAI moteur XAFe — sans une imitation au milieu.

    sh supabase/epreuve/eprouver.sh     (lance ceci si le dépôt TOTEM est à côté)

Ce qui est réel ici :
  · les SMS : les neuf formats recopiés de vrais SMS MTN et Orange que garde
    le dépôt TOTEM (tests/test_analyse_sms.py), avec ses noms difficiles ;
  · le lecteur et la ligne : `analyser` et `PorteXafe._ligne` de TOTEM, tels
    qu'ils tournent sur le Pi ;
  · la signature et l'envoi : `PorteXafe._appel` de TOTEM (HMAC sur horodatage,
    méthode, chemin et corps) — et une réclamation capturée, rejouée ailleurs ;
  · la porte : `supabase/functions/_shared/porte.ts` (porte-locale.mjs) ;
  · le moteur, la base, l'auth : la pile Supabase de supabase/epreuve ;
  · les clients : inscrits chez GoTrue (e-mail, mot de passe, TOTP), avec le numéro qui paie, et
    qui tapent le transaction ID TEL QU'IL EST ÉCRIT dans leur SMS.

Ce qu'on exige : chaque encaissement est crédité, au franc près, au client
dont le numéro a payé — qu'il ait tapé l'ID avant ou après l'arrivée du SMS ;
un intrus qui a tapé un ID d'avance ne reçoit rien (le paiement disputé va à l'équipe) ; un SMS de sortie
(transfert, cash in, dépôt vers un client) n'y crédite jamais personne : il n'y vaut que preuve d'un remboursement.
"""
import base64, hashlib, hmac, json, os, struct, subprocess, sys, time, urllib.request, importlib.util
from datetime import datetime, timezone

TOTEM = os.path.abspath(os.environ.get("TOTEM", os.path.join(os.path.dirname(__file__), "../../../totem")))
sys.path.insert(0, TOTEM)
from totem.analyse_sms import analyser            # noqa: E402
from totem.xafe import PorteXafe                  # noqa: E402

AUTH = f"http://127.0.0.1:{os.environ.get('PORT_AUTH', '59999')}"
REST = f"http://127.0.0.1:{os.environ.get('PORT_REST', '53000')}"
PORTE = f"http://127.0.0.1:{os.environ.get('PORT_PORTE', '54321')}"
CLE = "cle-akwa-de-l-epreuve"
NOS_CARTES = ("696103864", "677000000")

echecs = 0
def verifier(cond, texte, detail=""):
    global echecs
    print(("✓ " if cond else "✗ ") + texte + ("" if cond or not detail else f"\n    {detail}"))
    if not cond:
        echecs += 1

def sql(requete):
    r = subprocess.run(["psql", "-h", "127.0.0.1", "-p", os.environ.get("PORT_DB", "55432"), "-U", "supabase_admin",
                        "-d", "postgres", "-Atc", requete], capture_output=True, text=True,
                       env={**os.environ, "PGPASSWORD": os.environ.get("MDP", "essai")})
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()

def http(url, corps=None, jeton=None, methode=None):
    donnees = json.dumps(corps).encode() if corps is not None else None
    req = urllib.request.Request(url, data=donnees, method=methode or ("POST" if donnees else "GET"))
    req.add_header("Content-Type", "application/json")
    if jeton:
        req.add_header("apikey", jeton)
        req.add_header("Authorization", f"Bearer {jeton}")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")

def totp(secret):
    """RFC 6238, comme l'application d'authentification du client."""
    cle = base64.b32decode(secret.upper() + "=" * (-len(secret) % 8))
    h = hmac.new(cle, struct.pack(">Q", int(time.time()) // 30), hashlib.sha1).digest()
    o = h[-1] & 15
    return f"{(struct.unpack('>I', h[o:o + 4])[0] & 0x7fffffff) % 1_000_000:06d}"

def inscrire(telephone):
    """Comme l'application : e-mail et mot de passe, l'application d'authentification enrôlée et
    vérifiée par GoTrue (aal2), les codes de secours, puis le compte ouvert avec le numéro qui paie."""
    chiffres = telephone[-9:]
    _, a = http(f"{AUTH}/signup", {"email": f"chaine.{chiffres}@example.com", "password": "Glisil-essai-2026"})
    faible = a["access_token"]
    _, f = http(f"{AUTH}/factors", {"factor_type": "totp", "friendly_name": "essai"}, faible)
    _, c = http(f"{AUTH}/factors/{f['id']}/challenge", {}, faible)
    _, v = http(f"{AUTH}/factors/{f['id']}/verify", {"challenge_id": c["id"], "code": totp(f["totp"]["secret"])}, faible)
    jeton = v["access_token"]
    rpc("generer_codes_de_secours", {}, jeton)
    rpc("confirmer_codes_de_secours", {}, jeton)
    nom = "".join("abcdefghij"[int(x)] for x in chiffres)        # un nom ne porte pas de chiffres
    statut, r = rpc("ouvrir_mon_compte", {"p_prenom": "Client", "p_nom": nom, "p_naissance": "1990-05-14", "p_telephone": "+" + telephone,
                                          "p_ville": "Douala", "p_pays": "CM", "p_conditions": "2026-10-29"}, jeton)
    if statut != 200:
        raise RuntimeError(f"ouvrir_mon_compte {telephone} : {statut} {r}")
    return jeton, a["user"]["id"]

def rpc(nom, args, jeton):
    return http(f"{REST}/rpc/{nom}", args, jeton)

# ---- le corpus : les vrais formats du dépôt TOTEM ----------------------------
spec = importlib.util.spec_from_file_location("corpus", os.path.join(TOTEM, "tests/test_analyse_sms.py"))
corpus = importlib.util.module_from_spec(spec)
sys.path.insert(0, os.path.join(TOTEM, "tests"))
spec.loader.exec_module(corpus)
classe = next(getattr(corpus, n) for n in dir(corpus) if hasattr(getattr(corpus, n), "FORMATS"))
FORMATS, NOMS = classe.FORMATS, classe.NOMS

# ---- le décor ----------------------------------------------------------------
sql(f"""insert into terminaux (id, nom, cle, vu_le) values ('akwa-1', 'Akwa 1', '{CLE}', now())
          on conflict (id) do update set cle = excluded.cle, vu_le = now();
        insert into floats (operateur, numero, terminal) values ('om', '696103864', 'akwa-1'), ('mtn', '677000000', 'akwa-1')
          on conflict do nothing;""")

porte = PorteXafe(PORTE, CLE, "akwa-1", None)
porte.fournir_float = lambda iccid: ("om", "696103864") if iccid == "orange" else ("mtn", "677000000")

conteste = None
clients = {}          # numéro payeur (9 chiffres) -> (jeton, id, dossier, attendu)
mallory_jeton, mallory_id = inscrire("237677120009")
envoyes = 0
sorties_ecartees = 0
source = 50_000
for f_i, gabarit in enumerate(FORMATS):
    for k, nom in enumerate(NOMS):
        texte = gabarit.format(N=nom)
        p = analyser(texte, numeros=NOS_CARTES)
        if p is None or p.sens != "entree":
            # Ce que le robot fait d'une sortie : la porte la clôt « sans objet », sans réseau.
            # Une SORTIE part chez XAFe comme PREUVE d'un remboursement payé à la main (même ID, même montant,
            # même numéro) — jamais comme un crédit ; un sens que TOTEM ne sait pas trancher reste au boîtier.
            ligne = porte._ligne(source, datetime.now(timezone.utc).isoformat(), "MobileMoney", texte, "carte", "x", None, NOS_CARTES)
            source += 1
            if isinstance(ligne, dict) and ligne["sens"] == "sortie":
                statut, rep = porte._appel("POST", "totem-sms", {"lignes": [ligne]})[:2]
                if statut != 200:
                    verifier(False, f"la porte répond à la sortie « {texte[:40]}… »", f"{statut} {rep}")
            sorties_ecartees += ligne == "sans objet" or (isinstance(ligne, dict) and ligne["sens"] == "sortie")
            continue
        # une référence à lui : neuf noms, neuf paiements différents
        ref = p.reference[:-1] + str(k)
        texte = texte.replace(p.reference, ref)
        carte = "orange" if ref.startswith("PP") else "mtn"
        payeur = p.numero[-9:]
        if payeur not in clients:
            jeton, ident = inscrire("237" + payeur)
            sql(f"update comptes set palier = 2 where id = '{ident}'")   # le palier a ses scénarios ; ici, les montants
            _, d = rpc("ouvrir_depot", {"p_operateur": "om" if carte == "orange" else "mtn", "p_cle": f"chaine-{payeur}"}, jeton)
            clients[payeur] = [jeton, ident, d["reference"], 0]
        jeton, ident, dossier, _ = clients[payeur]
        dispute = f_i == 0 and k == 2
        if dispute:
            # l'intrus tape cet ID d'avance, sur son propre dossier. Le numéro d'un compte n'est pas prouvé
            # (aucun code par SMS) : il ne départage personne, et ce paiement part chez l'équipe.
            _, dm = rpc("ouvrir_depot", {"p_operateur": "mtn"}, mallory_jeton)
            rpc("declarer_transaction", {"p_reference": dm["reference"], "p_transaction_id": ref}, mallory_jeton)
        emis = datetime.now(timezone.utc).isoformat()
        ligne = porte._ligne(source, emis, "MobileMoney", texte, "carte", carte, emis, NOS_CARTES)
        source += 1
        avant = k % 2 == 0
        if avant:
            rpc("declarer_transaction", {"p_reference": dossier, "p_transaction_id": ref}, jeton)
        statut, rep = porte._appel("POST", "totem-sms", {"lignes": [ligne]})[:2]
        if not avant:
            rpc("declarer_transaction", {"p_reference": dossier, "p_transaction_id": ref}, jeton)
        if dispute:
            conteste = (source - 1, p.montant)
        else:
            clients[payeur][3] += p.montant
        envoyes += 1
        if statut != 200:
            verifier(False, f"la porte répond à « {texte[:40]}… »", f"{statut} {rep}")

verifier(envoyes == 5 * len(NOMS), f"{envoyes} encaissements réels lus par TOTEM et poussés, signés, à la porte")
verifier(sorties_ecartees == 4 * len(NOMS), f"{sorties_ecartees} SMS de sortie : preuves de remboursement ou gardés au boîtier, jamais crédités")
for payeur, (jeton, ident, dossier, attendu) in clients.items():
    _, s = rpc("mes_soldes", {}, jeton)
    recu = float((s or {}).get("XAFe", {}).get("disponible", 0))
    verifier(recu == attendu, f"le client du {payeur} reçoit exactement {attendu:,} XAFe".replace(",", " "), f"reçu {recu}")
_, s = rpc("mes_soldes", {}, mallory_jeton)
verifier(not s or float(s.get("XAFe", {}).get("disponible", 0)) == 0, "l'intrus qui a tapé un ID d'avance ne reçoit rien", json.dumps(s))
retenus = sql("select source_id || '|' || montant::bigint || '|' || bloquee || '|' || motif from entrees_retenues"
               " where etat = 'retenue' and source_id between 50000 and 59999").splitlines()
verifier(retenus == [f"{conteste[0]}|{conteste[1]}|true|plusieurs comptes ont tapé ce transaction ID : l'équipe vérifie"],
         "seul le paiement dont l'ID a été tapé par deux comptes reste retenu, bloqué pour l'équipe ; "
         "chaque autre ID tapé tel qu'écrit dans le SMS a trouvé son paiement", "\n".join(retenus))
# ---- la relève et la réclamation, signées par le robot, rejouées par un intrus --
# Deux SMS à faire partir de ce boîtier. Le robot relève et prend le premier ;
# quelqu'un capture ce PATCH en route et le rejoue — sur l'autre, sur un autre
# guichet, sous une autre méthode — dans les cinq minutes que vaut la
# signature (#54). Seule la requête capturée, telle quelle, est rejouée.
import totem.xafe as module_xafe                  # noqa: E402
ids = sql("""insert into messages_sortants (terminal, operateur, numero, texte, cle, expire_le)
             select 'akwa-1', 'mtn', '677120001', 'Glisil : votre code est 000000.', 'chaine-' || g || '-' || extract(epoch from clock_timestamp()), now() + interval '10 minutes'
               from generate_series(1, 2) g returning id""").split()
premier, second = int(ids[0]), int(ids[1])
releve = [d["id"] for d in porte.commandes_en_attente()]
verifier(f"sms:{premier}" in releve and f"sms:{second}" in releve, "le robot relève les SMS à envoyer de SON boîtier, signé", str(releve))
captures = []
vrai_urlopen = module_xafe.urllib.request.urlopen
module_xafe.urllib.request.urlopen = lambda req, timeout=None: (captures.append(req), vrai_urlopen(req, timeout=timeout))[1]
try:
    pris = porte.reclamer(f"sms:{premier}")
finally:
    module_xafe.urllib.request.urlopen = vrai_urlopen
verifier(bool(pris), "le robot réclame le premier, signé avec la méthode et le chemin")
capture = captures[-1]
def rejouer(chemin, methode="PATCH"):
    req = urllib.request.Request(f"{PORTE}/functions/v1/{chemin}", data=capture.data, method=methode)
    for nom, valeur in capture.header_items():
        req.add_header(nom, valeur)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
rejeux = {c: rejouer(c) for c in (f"totem-commandes/{second}", f"totem-commandes/{second}?type=transferts")}
rejeux["POST"] = rejouer(f"totem-commandes/{premier}", "POST")
verifier(set(rejeux.values()) == {401}, "le PATCH capturé, rejoué sur l'autre SMS, un autre guichet ou une autre méthode : refusé", str(rejeux))
verifier(sql(f"select etat from messages_sortants where id = {second}") == "en_attente", "le second SMS n'a été pris par personne")
verifier(rejouer(f"totem-commandes/{premier}") == 409, "rejouée telle quelle sur SA commande, la requête retombe sur la règle (déjà prise)")
verifier(bool(porte.reclamer(f"sms:{second}")), "le robot, lui, prend le second")

print("✓ la chaîne réelle tient, du lecteur de TOTEM au moteur XAFe" if not echecs else f"✗ {echecs} exigence(s) non tenue(s)")
sys.exit(1 if echecs else 0)
