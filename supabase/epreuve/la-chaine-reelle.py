"""LA CHAÎNE RÉELLE : de vrais formats de SMS d'opérateurs, lus par le VRAI
robot TOTEM, jusqu'au VRAI moteur XAFe — sans une imitation au milieu.

    sh supabase/epreuve/eprouver.sh     (lance ceci si le dépôt TOTEM est à côté)

Ce qui est réel ici :
  · les SMS : les neuf formats recopiés de vrais SMS MTN et Orange que garde
    le dépôt TOTEM (tests/test_analyse_sms.py), avec ses noms difficiles ;
  · le lecteur et la ligne : `analyser` et `PorteXafe._ligne` de TOTEM, tels
    qu'ils tournent sur le Pi ;
  · la signature et l'envoi : `PorteXafe._appel` de TOTEM (HMAC, horodatage) ;
  · la porte : `supabase/functions/_shared/porte.ts` (porte-locale.mjs) ;
  · le moteur, la base, l'auth : la pile Supabase de supabase/epreuve ;
  · les clients : inscrits par OTP chez GoTrue, avec le numéro qui paie, et
    qui tapent le transaction ID TEL QU'IL EST ÉCRIT dans leur SMS.

Ce qu'on exige : chaque encaissement est crédité, au franc près, au client
dont le numéro a payé — qu'il ait tapé l'ID avant ou après l'arrivée du SMS ;
un intrus qui a tapé un ID d'avance ne reçoit rien ; un SMS de sortie
(transfert, cash in, dépôt vers un client) ne part jamais chez XAFe.
"""
import json, os, subprocess, sys, urllib.request, importlib.util
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

def inscrire(telephone):
    http(f"{AUTH}/otp", {"phone": telephone})
    _, j = http(f"{AUTH}/verify", {"type": "sms", "phone": telephone, "token": "123456"})
    return j["access_token"], j["user"]["id"]

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
            ligne = porte._ligne(source, datetime.now(timezone.utc).isoformat(), "MobileMoney", texte, "carte", "x", None, NOS_CARTES)
            sorties_ecartees += ligne == "sans objet"
            source += 1
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
        if f_i == 0 and k == 2:
            # l'intrus tape cet ID d'avance, sur son propre dossier
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
        clients[payeur][3] += p.montant
        envoyes += 1
        if statut != 200:
            verifier(False, f"la porte répond à « {texte[:40]}… »", f"{statut} {rep}")

verifier(envoyes == 5 * len(NOMS), f"{envoyes} encaissements réels lus par TOTEM et poussés, signés, à la porte")
verifier(sorties_ecartees == 4 * len(NOMS), f"{sorties_ecartees} SMS de sortie écartés par TOTEM, jamais poussés chez XAFe")
for payeur, (jeton, ident, dossier, attendu) in clients.items():
    _, s = rpc("mes_soldes", {}, jeton)
    recu = float((s or {}).get("XAFe", {}).get("disponible", 0))
    verifier(recu == attendu, f"le client du {payeur} reçoit exactement {attendu:,} XAFe".replace(",", " "), f"reçu {recu}")
_, s = rpc("mes_soldes", {}, mallory_jeton)
verifier(not s or float(s.get("XAFe", {}).get("disponible", 0)) == 0, "l'intrus qui a tapé un ID d'avance ne reçoit rien", json.dumps(s))
reste = int(sql("select count(*) from entrees_retenues where etat = 'retenue' and source_id between 50000 and 59999"))
verifier(reste == 0, "aucun encaissement ne reste retenu : chaque ID tapé tel qu'écrit dans le SMS a trouvé son paiement", f"{reste} retenus")
print("✓ la chaîne réelle tient, du lecteur de TOTEM au moteur XAFe" if not echecs else f"✗ {echecs} exigence(s) non tenue(s)")
sys.exit(1 if echecs else 0)
