// Le jeton XAFe, éprouvé : une référence ne frappe qu'une fois, seule la
// plateforme frappe, et pas au-delà du plafond du jour ; la pause arrête tout,
// une adresse gelée ne bouge pas, et ses fonds se reprennent.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const XAF = (n) => BigInt(n) * 1_000_000n;
const ref = (texte) => ethers.keccak256(ethers.toUtf8Bytes(texte));

describe("XAFe", function () {
  async function deployer() {
    const [admin, plateforme, alice, bob, inconnu] = await ethers.getSigners();
    const Jeton = await ethers.getContractFactory("XAFe");
    const jeton = await Jeton.deploy(admin.address, XAF(10_000_000));
    // l'admin ne naît qu'avec le rôle d'administrer : il donne chaque rôle opérationnel, ici
    await jeton.grantRole(await jeton.FRAPPEUR_ROLE(), plateforme.address);
    await jeton.grantRole(await jeton.DESTRUCTEUR_ROLE(), plateforme.address);
    await jeton.grantRole(await jeton.GELEUR_ROLE(), admin.address);
    await jeton.grantRole(await jeton.PAUSEUR_ROLE(), admin.address);
    return { jeton, admin, plateforme, alice, bob, inconnu };
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

  it("détruit ce qui revient à la plateforme, et seulement sur son propre solde", async function () {
    const { jeton, plateforme, alice } = await loadFixture(deployer);
    await jeton.connect(plateforme).frapper(alice.address, XAF(100_000), ref("r1"));
    await jeton.connect(alice).transfer(plateforme.address, XAF(30_000)); // Alice renvoie à son adresse de dépôt
    await expect(jeton.connect(plateforme).detruire(XAF(30_000), ref("XAFe-DP-000418")))
      .to.emit(jeton, "Detruit").withArgs(plateforme.address, XAF(30_000), ref("XAFe-DP-000418"));
    expect(await jeton.totalSupply()).to.equal(XAF(70_000));
    await expect(jeton.connect(plateforme).detruire(XAF(1), ref("x"))).to.be.revertedWithCustomError(jeton, "ERC20InsufficientBalance");
    await expect(jeton.connect(alice).detruire(XAF(1), ref("x"))).to.be.revertedWithCustomError(jeton, "AccessControlUnauthorizedAccount");
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

  it("l'admin ne naît qu'avec le rôle d'administrer, et ne se transmet qu'en deux temps", async function () {
    const [admin, alice] = await ethers.getSigners();
    const jeton = await (await ethers.getContractFactory("XAFe")).deploy(admin.address, XAF(1_000_000));
    for (const role of ["FRAPPEUR_ROLE", "DESTRUCTEUR_ROLE", "GELEUR_ROLE", "PAUSEUR_ROLE"]) {
      expect(await jeton.hasRole(await jeton[role](), admin.address)).to.equal(false, `l'admin ne reçoit pas ${role}`);
    }
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

  it("n'a pas de voie pour brûler ses XAFe contre une référence que la plateforme ne lit pas", async function () {
    const { jeton } = await loadFixture(deployer);
    expect(jeton.interface.getFunction("rendre")).to.equal(null);
  });

  it("en pause, plus rien ne bouge — ni frappe, ni transfert, ni destruction", async function () {
    const { jeton, admin, plateforme, alice, bob } = await loadFixture(deployer);
    await jeton.connect(plateforme).frapper(alice.address, XAF(100_000), ref("r1"));
    await jeton.connect(alice).transfer(plateforme.address, XAF(10));
    await jeton.connect(admin).inscrireAdressesDeDepot([bob.address], true);
    await jeton.connect(alice).transfer(bob.address, XAF(10));
    await jeton.connect(alice).approve(bob.address, XAF(5));
    await jeton.connect(admin).pauser();
    await expect(jeton.connect(plateforme).frapper(bob.address, XAF(1), ref("r2"))).to.be.revertedWithCustomError(jeton, "EnforcedPause");
    await expect(jeton.connect(alice).transfer(bob.address, XAF(1))).to.be.revertedWithCustomError(jeton, "EnforcedPause");
    await expect(jeton.connect(bob).transferFrom(alice.address, bob.address, XAF(1))).to.be.revertedWithCustomError(jeton, "EnforcedPause");
    await expect(jeton.connect(plateforme).detruire(XAF(1), ref("d1"))).to.be.revertedWithCustomError(jeton, "EnforcedPause");
    await expect(jeton.connect(plateforme).detruireDepot(bob.address, XAF(1), ref("d2"))).to.be.revertedWithCustomError(jeton, "EnforcedPause");
    await expect(jeton.connect(alice).pauser()).to.be.revertedWithCustomError(jeton, "AccessControlUnauthorizedAccount");
    await jeton.connect(admin).reprendre();
    await jeton.connect(alice).transfer(bob.address, XAF(1));
    expect(await jeton.balanceOf(bob.address)).to.equal(XAF(11));
  });

  it("une destruction porte sa référence, une seule fois", async function () {
    const { jeton, admin, plateforme, alice, bob } = await loadFixture(deployer);
    await jeton.connect(plateforme).frapper(alice.address, XAF(100_000), ref("r1"));
    await jeton.connect(alice).transfer(plateforme.address, XAF(20));
    await jeton.connect(admin).inscrireAdressesDeDepot([bob.address], true);
    await jeton.connect(alice).transfer(bob.address, XAF(20));
    await expect(jeton.connect(plateforme).detruire(XAF(1), ethers.ZeroHash)).to.be.revertedWithCustomError(jeton, "ReferenceVide");
    await expect(jeton.connect(plateforme).detruireDepot(bob.address, XAF(1), ethers.ZeroHash)).to.be.revertedWithCustomError(jeton, "ReferenceVide");
    await jeton.connect(plateforme).detruire(XAF(1), ref("XAFe-RT-000007"));
    await expect(jeton.connect(plateforme).detruire(XAF(1), ref("XAFe-RT-000007")))
      .to.be.revertedWithCustomError(jeton, "ReferenceDejaUtilisee").withArgs(ref("XAFe-RT-000007"));
    await expect(jeton.connect(plateforme).detruireDepot(bob.address, XAF(1), ref("XAFe-RT-000007")))
      .to.be.revertedWithCustomError(jeton, "ReferenceDejaUtilisee").withArgs(ref("XAFe-RT-000007"));
    expect(await jeton.destructionReferencee(ref("XAFe-RT-000007"))).to.equal(true);
    expect(await jeton.totalSupply()).to.equal(XAF(100_000) - XAF(1), "une seule destruction a eu lieu");
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
});
