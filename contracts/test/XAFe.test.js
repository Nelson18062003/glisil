// Le jeton XAFe, éprouvé : une référence ne frappe qu'une fois, seule la
// plateforme frappe, et pas au-delà du plafond du jour ; la pause arrête tout,
// une adresse gelée ne bouge pas, et ses fonds se reprennent. La réserve vit
// dans le contrat : personne ne la transfère, le plafond ne la compte pas.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const XAF = (n) => BigInt(n) * 1_000_000n;
const ref = (texte) => ethers.keccak256(ethers.toUtf8Bytes(texte));

describe("XAFe", function () {
  async function deployer() {
    const [admin, plateforme, alice, bob, inconnu, inscripteur, pauseur] = await ethers.getSigners();
    const Jeton = await ethers.getContractFactory("XAFe");
    // tous les rôles d'un coup, par le constructeur : l'admin n'en reçoit aucun autre
    const jeton = await Jeton.deploy(admin.address, XAF(10_000_000), plateforme.address, plateforme.address, admin.address, admin.address, inscripteur.address);
    return { jeton, admin, plateforme, alice, bob, inconnu, inscripteur, pauseur };
  }
  /** le plafond de production : un milliard de XAF par jour et par chaîne */
  async function deployerAuMilliard() {
    const [admin, plateforme, alice, bob, inconnu, inscripteur, pauseur] = await ethers.getSigners();
    const jeton = await (await ethers.getContractFactory("XAFe")).deploy(admin.address, XAF(1_000_000_000), plateforme.address, plateforme.address, pauseur.address, admin.address, inscripteur.address);
    return { jeton, admin, plateforme, alice, bob, inconnu, inscripteur, pauseur };
  }

  it("vaut un franc : six décimales, nom et symbole XAFe", async function () {
    const { jeton } = await loadFixture(deployer);
    expect(await jeton.decimals()).to.equal(6);
    expect(await jeton.name()).to.equal("XAFe");
    expect(await jeton.symbol()).to.equal("XAFe");
    expect(await jeton.totalSupply()).to.equal(0n);
  });

  it("frappe pour un retrait, avec sa référence, une seule fois", async function () {
    const { jeton, plateforme, alice } = await loadFixture(deployer);
    await expect(jeton.connect(plateforme).frapper(alice.address, XAF(500_000), ref("XAFe-CR-000012")))
      .to.emit(jeton, "Frappe").withArgs(alice.address, XAF(500_000), ref("XAFe-CR-000012"));
    expect(await jeton.balanceOf(alice.address)).to.equal(XAF(500_000));
    expect(await jeton.totalSupply()).to.equal(XAF(500_000));
    await expect(jeton.connect(plateforme).frapper(alice.address, XAF(500_000), ref("XAFe-CR-000012")))
      .to.be.revertedWithCustomError(jeton, "ReferenceDejaUtilisee").withArgs(ref("XAFe-CR-000012"));
    expect(await jeton.balanceOf(alice.address)).to.equal(XAF(500_000), "la même référence rejouée n'a rien frappé");
  });

  it("refuse une frappe sans référence, sans montant, ou par n'importe qui", async function () {
    const { jeton, plateforme, alice, inconnu } = await loadFixture(deployer);
    await expect(jeton.connect(plateforme).frapper(alice.address, XAF(1), ethers.ZeroHash)).to.be.revertedWithCustomError(jeton, "ReferenceVide");
    await expect(jeton.connect(plateforme).frapper(alice.address, 0, ref("x"))).to.be.revertedWithCustomError(jeton, "MontantNul");
    await expect(jeton.connect(inconnu).frapper(inconnu.address, XAF(1), ref("vol"))).to.be.revertedWithCustomError(jeton, "AccessControlUnauthorizedAccount");
    await expect(jeton.connect(alice).frapper(alice.address, XAF(1), ref("vol"))).to.be.revertedWithCustomError(jeton, "AccessControlUnauthorizedAccount");
  });

  it("se transfère comme un ERC-20 ordinaire", async function () {
    const { jeton, plateforme, alice, bob } = await loadFixture(deployer);
    await jeton.connect(plateforme).frapper(alice.address, XAF(100_000), ref("r1"));
    await jeton.connect(alice).transfer(bob.address, XAF(40_000));
    expect(await jeton.balanceOf(alice.address)).to.equal(XAF(60_000));
    expect(await jeton.balanceOf(bob.address)).to.equal(XAF(40_000));
  });

  it("détruit dans la réserve ce qui quitte les comptes Glisil, jamais plus qu'elle ne tient", async function () {
    const { jeton, plateforme, alice } = await loadFixture(deployer);
    await jeton.connect(plateforme).frapperReserve(XAF(100_000), ref("XAFe-DP-000418"));
    await expect(jeton.connect(plateforme).detruireReserve(XAF(30_000), ref("XAFe-WD-000012")))
      .to.emit(jeton, "Detruit").withArgs(await jeton.getAddress(), XAF(30_000), ref("XAFe-WD-000012"));
    expect(await jeton.totalSupply()).to.equal(XAF(70_000));
    await expect(jeton.connect(plateforme).detruireReserve(XAF(70_001), ref("x"))).to.be.revertedWithCustomError(jeton, "ERC20InsufficientBalance");
    await expect(jeton.connect(alice).detruireReserve(XAF(1), ref("x"))).to.be.revertedWithCustomError(jeton, "AccessControlUnauthorizedAccount");
  });

  it("ne frappe pas au-delà du plafond du jour : une clé de frappe volée ne frappe pas sans limite", async function () {
    const { jeton, admin, plateforme, alice } = await loadFixture(deployer);
    await jeton.connect(plateforme).frapper(alice.address, XAF(9_000_000), ref("r1"));
    await expect(jeton.connect(plateforme).frapper(alice.address, XAF(1_000_001), ref("r2")))
      .to.be.revertedWithCustomError(jeton, "PlafondJourAtteint").withArgs(XAF(9_000_000), XAF(1_000_001), XAF(10_000_000));
    await jeton.connect(plateforme).frapper(alice.address, XAF(1_000_000), ref("r3"));
    await expect(jeton.connect(plateforme).fixerPlafondJour(XAF(1_000_000_000))).to.be.revertedWithCustomError(jeton, "AccessControlUnauthorizedAccount");
    await time.increase(24 * 3600);
    await jeton.connect(plateforme).frapper(alice.address, XAF(5_000_000), ref("r4"));
    await expect(jeton.connect(admin).fixerPlafondJour(XAF(50_000_000))).to.emit(jeton, "PlafondJour").withArgs(XAF(50_000_000));
    await jeton.connect(plateforme).frapper(alice.address, XAF(20_000_000), ref("r5"));
    expect(await jeton.totalSupply()).to.equal(XAF(35_000_000));
  });

  it("reprend ce qu'une clé volée a frappé : gel, puis destruction par l'admin seul", async function () {
    const { jeton, admin, plateforme, alice, inconnu } = await loadFixture(deployer);
    await jeton.connect(plateforme).frapper(inconnu.address, XAF(3_000_000), ref("frappe-volee"));
    await expect(jeton.connect(admin).detruireFondsGeles(inconnu.address, ref("incident-1")))
      .to.be.revertedWithCustomError(jeton, "AdresseNonGelee").withArgs(inconnu.address);
    await jeton.connect(admin).geler(inconnu.address, "incident 1 : clé de frappe compromise");
    await expect(jeton.connect(plateforme).detruireFondsGeles(inconnu.address, ref("incident-1")))
      .to.be.revertedWithCustomError(jeton, "AccessControlUnauthorizedAccount");
    await expect(jeton.connect(admin).detruireFondsGeles(inconnu.address, ref("incident-1")))
      .to.emit(jeton, "FondsGelesDetruits").withArgs(inconnu.address, XAF(3_000_000), ref("incident-1"));
    expect(await jeton.balanceOf(inconnu.address)).to.equal(0n);
    expect(await jeton.totalSupply()).to.equal(0n);
    await expect(jeton.connect(inconnu).transfer(alice.address, 0)).to.be.revertedWithCustomError(jeton, "AdresseGelee");
  });

  it("le constructeur pose chaque rôle ; l'admin n'administre que ; il ne se transmet qu'en deux temps", async function () {
    const [admin, alice, chaud, pauseur, geleur, inscripteur] = await ethers.getSigners();
    const jeton = await (await ethers.getContractFactory("XAFe")).deploy(admin.address, XAF(1_000_000), chaud.address, chaud.address, pauseur.address, geleur.address, inscripteur.address);
    for (const role of ["FRAPPEUR_ROLE", "DESTRUCTEUR_ROLE", "GELEUR_ROLE", "PAUSEUR_ROLE", "INSCRIPTEUR_ROLE"]) {
      expect(await jeton.hasRole(await jeton[role](), admin.address)).to.equal(false, `l'admin ne reçoit pas ${role}`);
    }
    const attendu = { FRAPPEUR_ROLE: chaud, DESTRUCTEUR_ROLE: chaud, PAUSEUR_ROLE: pauseur, GELEUR_ROLE: geleur, INSCRIPTEUR_ROLE: inscripteur };
    for (const [role, qui] of Object.entries(attendu)) expect(await jeton.hasRole(await jeton[role](), qui.address)).to.equal(true, role);
    expect(await jeton.hasRole(await jeton.DEFAULT_ADMIN_ROLE(), chaud.address)).to.equal(false, "le chaud n'administre pas");
    const sans = await (await ethers.getContractFactory("XAFe")).deploy(admin.address, XAF(1), ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress);
    expect(await sans.hasRole(await sans.FRAPPEUR_ROLE(), ethers.ZeroAddress)).to.equal(false, "une adresse nulle ne reçoit rien");
    await expect(jeton.frapper(admin.address, XAF(1), ref("r"))).to.be.revertedWithCustomError(jeton, "AccessControlUnauthorizedAccount");
    await expect(jeton.grantRole(await jeton.DEFAULT_ADMIN_ROLE(), alice.address)).to.be.revertedWithCustomError(jeton, "AccessControlEnforcedDefaultAdminRules");
    await jeton.beginDefaultAdminTransfer(alice.address);
    await expect(jeton.connect(alice).acceptDefaultAdminTransfer()).to.be.revertedWithCustomError(jeton, "AccessControlEnforcedDefaultAdminDelay");
    await time.increase(2 * 24 * 3600 + 1);
    await jeton.connect(alice).acceptDefaultAdminTransfer();
    expect(await jeton.defaultAdmin()).to.equal(alice.address);
  });

  it("détruit les retours sur l'adresse de dépôt inscrite, jamais sur le wallet d'un client", async function () {
    const { jeton, admin, plateforme, alice, bob } = await loadFixture(deployer);
    const depotAlice = bob; // l'adresse de dépôt que le moteur a donnée à Alice
    await jeton.connect(plateforme).frapper(alice.address, XAF(100_000), ref("r1"));
    await expect(jeton.connect(plateforme).inscrireAdressesDeDepot([depotAlice.address], true)).to.be.revertedWithCustomError(jeton, "AccessControlUnauthorizedAccount");
    await expect(jeton.connect(admin).inscrireAdressesDeDepot([depotAlice.address], true)).to.emit(jeton, "AdresseDeDepot").withArgs(depotAlice.address, true);
    await jeton.connect(alice).transfer(depotAlice.address, XAF(30_000));
    await expect(jeton.connect(plateforme).detruireDepot(depotAlice.address, XAF(30_000), ref("XAFe-RT-000001")))
      .to.emit(jeton, "Detruit").withArgs(depotAlice.address, XAF(30_000), ref("XAFe-RT-000001"));
    await expect(jeton.connect(plateforme).detruireDepot(alice.address, XAF(1), ref("x"))).to.be.revertedWithCustomError(jeton, "PasUneAdresseDeDepot").withArgs(alice.address);
    await expect(jeton.connect(alice).detruireDepot(depotAlice.address, 0, ref("x"))).to.be.revertedWithCustomError(jeton, "AccessControlUnauthorizedAccount");
    expect(await jeton.totalSupply()).to.equal(XAF(70_000));
  });

  it("n'a pas de voie pour brûler ses XAFe contre une référence que la plateforme ne lit pas, ni pour brûler « son propre solde »", async function () {
    const { jeton } = await loadFixture(deployer);
    expect(jeton.interface.getFunction("rendre")).to.equal(null);
    expect(jeton.interface.getFunction("detruire")).to.equal(null, "rien ne doit jamais dormir sur le wallet chaud");
  });

  it("en pause, plus rien ne bouge — ni frappe, ni transfert, ni destruction", async function () {
    const { jeton, admin, plateforme, alice, bob } = await loadFixture(deployer);
    await jeton.connect(plateforme).frapper(alice.address, XAF(100_000), ref("r1"));
    await jeton.connect(plateforme).frapperReserve(XAF(10), ref("dp1"));
    await jeton.connect(admin).inscrireAdressesDeDepot([bob.address], true);
    await jeton.connect(alice).transfer(bob.address, XAF(10));
    await jeton.connect(alice).approve(bob.address, XAF(5));
    await jeton.connect(admin).pauser();
    await expect(jeton.connect(plateforme).frapper(bob.address, XAF(1), ref("r2"))).to.be.revertedWithCustomError(jeton, "EnforcedPause");
    await expect(jeton.connect(alice).transfer(bob.address, XAF(1))).to.be.revertedWithCustomError(jeton, "EnforcedPause");
    await expect(jeton.connect(bob).transferFrom(alice.address, bob.address, XAF(1))).to.be.revertedWithCustomError(jeton, "EnforcedPause");
    await expect(jeton.connect(plateforme).detruireReserve(XAF(1), ref("d1"))).to.be.revertedWithCustomError(jeton, "EnforcedPause");
    await expect(jeton.connect(plateforme).detruireDepot(bob.address, XAF(1), ref("d2"))).to.be.revertedWithCustomError(jeton, "EnforcedPause");
    await expect(jeton.connect(alice).pauser()).to.be.revertedWithCustomError(jeton, "AccessControlUnauthorizedAccount");
    await jeton.connect(admin).reprendre();
    await jeton.connect(alice).transfer(bob.address, XAF(1));
    expect(await jeton.balanceOf(bob.address)).to.equal(XAF(11));
  });

  it("une destruction porte sa référence, une seule fois", async function () {
    const { jeton, admin, plateforme, alice, bob } = await loadFixture(deployer);
    await jeton.connect(plateforme).frapper(alice.address, XAF(100_000), ref("r1"));
    await jeton.connect(plateforme).frapperReserve(XAF(20), ref("dp1"));
    await jeton.connect(admin).inscrireAdressesDeDepot([bob.address], true);
    await jeton.connect(alice).transfer(bob.address, XAF(20));
    await expect(jeton.connect(plateforme).detruireReserve(XAF(1), ethers.ZeroHash)).to.be.revertedWithCustomError(jeton, "ReferenceVide");
    await expect(jeton.connect(plateforme).detruireDepot(bob.address, XAF(1), ethers.ZeroHash)).to.be.revertedWithCustomError(jeton, "ReferenceVide");
    await jeton.connect(plateforme).detruireReserve(XAF(1), ref("XAFe-RT-000007"));
    await expect(jeton.connect(plateforme).detruireReserve(XAF(1), ref("XAFe-RT-000007")))
      .to.be.revertedWithCustomError(jeton, "ReferenceDejaUtilisee").withArgs(ref("XAFe-RT-000007"));
    await expect(jeton.connect(plateforme).detruireDepot(bob.address, XAF(1), ref("XAFe-RT-000007")))
      .to.be.revertedWithCustomError(jeton, "ReferenceDejaUtilisee").withArgs(ref("XAFe-RT-000007"));
    expect(await jeton.destructionReferencee(ref("XAFe-RT-000007"))).to.equal(true);
    expect(await jeton.totalSupply()).to.equal(XAF(100_020) - XAF(1), "une seule destruction a eu lieu");
  });

  it("on ne gèle pas l'adresse zéro : ce serait une pause sans le rôle de pause", async function () {
    const { jeton, admin, plateforme, alice } = await loadFixture(deployer);
    await expect(jeton.connect(admin).geler(ethers.ZeroAddress, "erreur")).to.be.revertedWithCustomError(jeton, "AdresseNulle");
    await jeton.connect(plateforme).frapper(alice.address, XAF(1), ref("r1"));
    expect(await jeton.balanceOf(alice.address)).to.equal(XAF(1));
  });

  it("une adresse gelée ne dépense pas les autorisations qu'on lui a données, et ce qu'on a autorisé depuis elle ne sort pas", async function () {
    const { jeton, admin, plateforme, alice, bob, inconnu } = await loadFixture(deployer);
    await jeton.connect(plateforme).frapper(alice.address, XAF(100), ref("r1"));
    await jeton.connect(plateforme).frapper(bob.address, XAF(100), ref("r2"));
    await jeton.connect(alice).approve(inconnu.address, XAF(50));
    await jeton.connect(bob).approve(alice.address, XAF(50));
    await jeton.connect(admin).geler(alice.address, "enquête");
    await expect(jeton.connect(inconnu).transferFrom(alice.address, inconnu.address, XAF(1))).to.be.revertedWithCustomError(jeton, "AdresseGelee").withArgs(alice.address);
    await expect(jeton.connect(alice).transferFrom(bob.address, inconnu.address, XAF(1))).to.be.revertedWithCustomError(jeton, "AdresseGelee").withArgs(alice.address);
    await jeton.connect(admin).degeler(alice.address);
    await jeton.connect(alice).transferFrom(bob.address, inconnu.address, XAF(1));
    expect(await jeton.balanceOf(inconnu.address)).to.equal(XAF(1));
  });

  it("une adresse gelée ne peut ni envoyer ni recevoir, jusqu'au dégel", async function () {
    const { jeton, admin, plateforme, alice, bob } = await loadFixture(deployer);
    await jeton.connect(plateforme).frapper(alice.address, XAF(100_000), ref("r1"));
    await expect(jeton.connect(admin).geler(alice.address, "demande COSUMAF n° 12")).to.emit(jeton, "Gele").withArgs(alice.address, "demande COSUMAF n° 12");
    await expect(jeton.connect(alice).transfer(bob.address, XAF(1))).to.be.revertedWithCustomError(jeton, "AdresseGelee").withArgs(alice.address);
    await expect(jeton.connect(plateforme).frapper(alice.address, XAF(1), ref("r2"))).to.be.revertedWithCustomError(jeton, "AdresseGelee").withArgs(alice.address);
    await jeton.connect(plateforme).frapper(bob.address, XAF(10), ref("r3"));
    await expect(jeton.connect(bob).transfer(alice.address, XAF(1))).to.be.revertedWithCustomError(jeton, "AdresseGelee").withArgs(alice.address);
    await expect(jeton.connect(bob).geler(alice.address, "x")).to.be.revertedWithCustomError(jeton, "AccessControlUnauthorizedAccount");
    await jeton.connect(admin).degeler(alice.address);
    await jeton.connect(alice).transfer(bob.address, XAF(1));
    expect(await jeton.balanceOf(bob.address)).to.equal(XAF(11));
  });

  it("les rôles se donnent et se retirent par l'admin seul", async function () {
    const { jeton, admin, plateforme, alice } = await loadFixture(deployer);
    const FRAPPEUR = await jeton.FRAPPEUR_ROLE();
    await expect(jeton.connect(plateforme).grantRole(FRAPPEUR, alice.address)).to.be.revertedWithCustomError(jeton, "AccessControlUnauthorizedAccount");
    await jeton.connect(admin).revokeRole(FRAPPEUR, plateforme.address);
    await expect(jeton.connect(plateforme).frapper(alice.address, XAF(1), ref("r"))).to.be.revertedWithCustomError(jeton, "AccessControlUnauthorizedAccount");
  });
  /* ───────────────────────── la réserve dans le contrat (le correctif) ───────────────────────── */

  it("T1 · la réserve vit dans le contrat : frappée sans plafond, rien sur le chaud", async function () {
    const { jeton, plateforme } = await loadFixture(deployerAuMilliard);
    const contrat = await jeton.getAddress();
    await expect(jeton.connect(plateforme).frapperReserve(XAF(2_000_000_000), ref("XAFe-DP-1")))
      .to.emit(jeton, "Frappe").withArgs(contrat, XAF(2_000_000_000), ref("XAFe-DP-1"));
    expect(await jeton.reserve()).to.equal(XAF(2_000_000_000));
    expect(await jeton.balanceOf(contrat)).to.equal(XAF(2_000_000_000));
    expect(await jeton.frappeLeJour(BigInt(await time.latest()) / 86400n)).to.equal(0n, "la réserve ne compte pas dans le plafond");
    expect(await jeton.balanceOf(plateforme.address)).to.equal(0n);
  });

  it("T2 · personne ne transfère la réserve, et rien n'y entre par transfert", async function () {
    const { jeton, admin, plateforme, alice, bob } = await loadFixture(deployerAuMilliard);
    const contrat = await jeton.getAddress();
    await jeton.connect(plateforme).frapperReserve(XAF(1_000_000), ref("XAFe-DP-1"));
    await jeton.connect(plateforme).frapper(alice.address, XAF(10), ref("XAFe-CR-1"));
    await expect(jeton.connect(plateforme).transfer(bob.address, 1)).to.be.revertedWithCustomError(jeton, "ERC20InsufficientBalance");
    await expect(jeton.connect(alice).transfer(contrat, 1)).to.be.revertedWithCustomError(jeton, "VersLaReserve");
    await jeton.connect(alice).approve(bob.address, XAF(5));
    await expect(jeton.connect(bob).transferFrom(alice.address, contrat, 1)).to.be.revertedWithCustomError(jeton, "VersLaReserve");
    for (const qui of [admin, plateforme, alice, bob]) {
      await expect(jeton.connect(qui).transferFrom(contrat, qui.address, 1)).to.be.reverted;
    }
    expect(await jeton.reserve()).to.equal(XAF(1_000_000), "seul detruireReserve fait bouger la réserve");
  });

  it("T3 · detruireReserve brûle la réserve, une fois par référence, et seulement par le destructeur", async function () {
    const { jeton, plateforme, alice } = await loadFixture(deployerAuMilliard);
    const contrat = await jeton.getAddress();
    await jeton.connect(plateforme).frapperReserve(XAF(100), ref("dp"));
    await expect(jeton.connect(plateforme).detruireReserve(XAF(101), ref("w1"))).to.be.revertedWithCustomError(jeton, "ERC20InsufficientBalance");
    await expect(jeton.connect(plateforme).detruireReserve(0, ref("w1"))).to.be.revertedWithCustomError(jeton, "MontantNul");
    await expect(jeton.connect(plateforme).detruireReserve(XAF(1), ethers.ZeroHash)).to.be.revertedWithCustomError(jeton, "ReferenceVide");
    await expect(jeton.connect(alice).detruireReserve(XAF(1), ref("w1"))).to.be.revertedWithCustomError(jeton, "AccessControlUnauthorizedAccount");
    await expect(jeton.connect(plateforme).detruireReserve(XAF(40), ref("w1"))).to.emit(jeton, "Detruit").withArgs(contrat, XAF(40), ref("w1"));
    await expect(jeton.connect(plateforme).detruireReserve(XAF(1), ref("w1"))).to.be.revertedWithCustomError(jeton, "ReferenceDejaUtilisee");
    expect(await jeton.reserve()).to.equal(XAF(60));
  });

  it("T4 · une référence ne frappe qu'une fois, en réserve comme chez un client", async function () {
    const { jeton, plateforme, alice } = await loadFixture(deployerAuMilliard);
    await jeton.connect(plateforme).frapperReserve(XAF(1), ref("A"));
    await expect(jeton.connect(plateforme).frapper(alice.address, XAF(1), ref("A"))).to.be.revertedWithCustomError(jeton, "ReferenceDejaUtilisee");
    await jeton.connect(plateforme).frapper(alice.address, XAF(1), ref("B"));
    await expect(jeton.connect(plateforme).frapperReserve(XAF(1), ref("B"))).to.be.revertedWithCustomError(jeton, "ReferenceDejaUtilisee");
    await expect(jeton.connect(plateforme).frapperReserve(0, ref("C"))).to.be.revertedWithCustomError(jeton, "MontantNul");
    await expect(jeton.connect(plateforme).frapperReserve(XAF(1), ethers.ZeroHash)).to.be.revertedWithCustomError(jeton, "ReferenceVide");
    await expect(jeton.connect(alice).frapperReserve(XAF(1), ref("D"))).to.be.revertedWithCustomError(jeton, "AccessControlUnauthorizedAccount");
  });

  it("T5 · on ne frappe pas vers la réserve", async function () {
    const { jeton, plateforme } = await loadFixture(deployerAuMilliard);
    await expect(jeton.connect(plateforme).frapper(await jeton.getAddress(), XAF(1), ref("x"))).to.be.revertedWithCustomError(jeton, "AdresseDeLaReserve");
  });

  it("T6 · le plafond (un milliard par jour) ne compte que les frappes vers l'extérieur ; l'admin le change à tout moment", async function () {
    const { jeton, admin, plateforme, alice, bob } = await loadFixture(deployerAuMilliard);
    expect(await jeton.plafondJour()).to.equal(XAF(1_000_000_000));
    expect(await jeton.resteDuJour()).to.equal(XAF(1_000_000_000));
    await jeton.connect(plateforme).frapper(alice.address, XAF(600_000_000), ref("a"));
    await jeton.connect(plateforme).frapper(bob.address, XAF(400_000_000), ref("b"));
    expect(await jeton.resteDuJour()).to.equal(0n);
    await expect(jeton.connect(plateforme).frapper(bob.address, 1, ref("c"))).to.be.revertedWithCustomError(jeton, "PlafondJourAtteint");
    await jeton.connect(plateforme).frapperReserve(XAF(5_000_000_000), ref("reserve"));
    await time.increase(24 * 3600);
    await jeton.connect(plateforme).frapper(bob.address, 1, ref("c"));
    await expect(jeton.connect(admin).fixerPlafondJour(XAF(5_000_000_000))).to.emit(jeton, "PlafondJour").withArgs(XAF(5_000_000_000));
    await expect(jeton.connect(plateforme).fixerPlafondJour(XAF(1))).to.be.revertedWithCustomError(jeton, "AccessControlUnauthorizedAccount");
  });

  it("T7 · la réserve ne se gèle pas et ne s'inscrit pas comme adresse de dépôt", async function () {
    const { jeton, admin, plateforme, inscripteur } = await loadFixture(deployerAuMilliard);
    const contrat = await jeton.getAddress();
    await jeton.connect(plateforme).frapperReserve(XAF(1), ref("dp"));
    await expect(jeton.connect(admin).geler(contrat, "x")).to.be.revertedWithCustomError(jeton, "AdresseDeLaReserve");
    await expect(jeton.connect(admin).inscrireAdressesDeDepot([contrat], true)).to.be.revertedWithCustomError(jeton, "AdresseDeLaReserve");
    await expect(jeton.connect(admin).inscrireAdressesDeDepot([ethers.ZeroAddress], true)).to.be.revertedWithCustomError(jeton, "AdresseNulle");
    await expect(jeton.connect(inscripteur).inscrireAdressesNeuves([contrat])).to.be.revertedWithCustomError(jeton, "AdresseDeLaReserve");
    await expect(jeton.connect(plateforme).detruireDepot(contrat, XAF(1), ref("x"))).to.be.revertedWithCustomError(jeton, "PasUneAdresseDeDepot");
    await expect(jeton.connect(admin).detruireFondsGeles(contrat, ref("x"))).to.be.revertedWithCustomError(jeton, "AdresseNonGelee");
  });

  it("T8 · en pause, la réserve ne bouge pas", async function () {
    const { jeton, plateforme, pauseur } = await loadFixture(deployerAuMilliard);
    await jeton.connect(plateforme).frapperReserve(XAF(10), ref("dp"));
    await jeton.connect(pauseur).pauser();
    await expect(jeton.connect(plateforme).frapperReserve(XAF(1), ref("dp2"))).to.be.revertedWithCustomError(jeton, "EnforcedPause");
    await expect(jeton.connect(plateforme).detruireReserve(XAF(1), ref("w"))).to.be.revertedWithCustomError(jeton, "EnforcedPause");
  });

  it("T9 · le PAUSEUR arrête, seul l'admin reprend", async function () {
    const { jeton, admin, pauseur } = await loadFixture(deployerAuMilliard);
    await jeton.connect(pauseur).pauser();
    await expect(jeton.connect(pauseur).reprendre()).to.be.revertedWithCustomError(jeton, "AccessControlUnauthorizedAccount");
    await jeton.connect(admin).reprendre();
    expect(await jeton.paused()).to.equal(false);
  });

  it("T10 · l'inscripteur n'inscrit que des adresses neuves, ne retire rien, et renonce", async function () {
    const { jeton, admin, plateforme, alice, bob, inconnu, inscripteur } = await loadFixture(deployerAuMilliard);
    await expect(jeton.connect(inscripteur).inscrireAdressesNeuves([bob.address])).to.emit(jeton, "AdresseDeDepot").withArgs(bob.address, true);
    expect(await jeton.estAdresseDeDepot(bob.address)).to.equal(true);
    await jeton.connect(plateforme).frapper(alice.address, XAF(5), ref("a"));
    await expect(jeton.connect(inscripteur).inscrireAdressesNeuves([alice.address])).to.be.revertedWithCustomError(jeton, "AdresseDejaPortee").withArgs(alice.address);
    await expect(jeton.connect(inscripteur).inscrireAdressesNeuves([ethers.ZeroAddress])).to.be.revertedWithCustomError(jeton, "AdresseNulle");
    await expect(jeton.connect(inscripteur).inscrireAdressesDeDepot([bob.address], false)).to.be.revertedWithCustomError(jeton, "AccessControlUnauthorizedAccount");
    await expect(jeton.connect(plateforme).inscrireAdressesNeuves([inconnu.address])).to.be.revertedWithCustomError(jeton, "AccessControlUnauthorizedAccount");
    expect(await jeton.hasRole(await jeton.INSCRIPTEUR_ROLE(), admin.address)).to.equal(false);
    await jeton.connect(inscripteur).renounceRole(await jeton.INSCRIPTEUR_ROLE(), inscripteur.address);
    await expect(jeton.connect(inscripteur).inscrireAdressesNeuves([inconnu.address])).to.be.revertedWithCustomError(jeton, "AccessControlUnauthorizedAccount");
  });

  it("T11 · le chaud ne détient jamais de XAFe : dépôt, retrait, retour", async function () {
    const { jeton, plateforme, alice, inscripteur, bob } = await loadFixture(deployerAuMilliard);
    const depotAlice = bob;
    await jeton.connect(inscripteur).inscrireAdressesNeuves([depotAlice.address]);
    await jeton.connect(plateforme).frapperReserve(XAF(1_000_000), ref("XAFe-DP-1"));                 // un dépôt MoMo
    await jeton.connect(plateforme).frapper(alice.address, XAF(150_000), ref("XAFe-CR-1"));             // un retrait vers son wallet…
    await jeton.connect(plateforme).detruireReserve(XAF(150_000), ref("XAFe-CR-1#"));                   // … quitte la réserve
    await jeton.connect(alice).transfer(depotAlice.address, XAF(50_000));                               // un retour
    await jeton.connect(plateforme).detruireDepot(depotAlice.address, XAF(50_000), ref("XAFe-RT-1"));
    await jeton.connect(plateforme).frapperReserve(XAF(50_000), ref("XAFe-RT-1"));
    expect(await jeton.balanceOf(plateforme.address)).to.equal(0n);
    expect(await jeton.totalSupply()).to.equal((await jeton.reserve()) + (await jeton.balanceOf(alice.address)) + (await jeton.balanceOf(depotAlice.address)));
    expect(await jeton.reserve()).to.equal(XAF(900_000));
  });
});
