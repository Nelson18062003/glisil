// Le jeton XAFe, éprouvé : une référence ne frappe qu'une fois, seule la
// plateforme frappe, la pause arrête tout, une adresse gelée ne bouge pas.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const XAF = (n) => BigInt(n) * 1_000_000n;
const ref = (texte) => ethers.keccak256(ethers.toUtf8Bytes(texte));

describe("XAFe", function () {
  async function deployer() {
    const [admin, plateforme, alice, bob, inconnu] = await ethers.getSigners();
    const Jeton = await ethers.getContractFactory("XAFe");
    const jeton = await Jeton.deploy(admin.address);
    await jeton.grantRole(await jeton.FRAPPEUR_ROLE(), plateforme.address);
    await jeton.grantRole(await jeton.DESTRUCTEUR_ROLE(), plateforme.address);
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

  it("laisse un client rendre lui-même ses XAFe, avec l'empreinte de son compte", async function () {
    const { jeton, plateforme, alice } = await loadFixture(deployer);
    await jeton.connect(plateforme).frapper(alice.address, XAF(100_000), ref("r1"));
    await expect(jeton.connect(alice).rendre(XAF(25_000), ref("compte-alice")))
      .to.emit(jeton, "Rendu").withArgs(alice.address, XAF(25_000), ref("compte-alice"));
    expect(await jeton.balanceOf(alice.address)).to.equal(XAF(75_000));
    await expect(jeton.connect(alice).rendre(XAF(1), ethers.ZeroHash)).to.be.revertedWithCustomError(jeton, "ReferenceVide");
  });

  it("en pause, plus rien ne bouge — ni frappe, ni transfert, ni destruction", async function () {
    const { jeton, admin, plateforme, alice, bob } = await loadFixture(deployer);
    await jeton.connect(plateforme).frapper(alice.address, XAF(100_000), ref("r1"));
    await jeton.connect(admin).pauser();
    await expect(jeton.connect(plateforme).frapper(bob.address, XAF(1), ref("r2"))).to.be.revertedWithCustomError(jeton, "EnforcedPause");
    await expect(jeton.connect(alice).transfer(bob.address, XAF(1))).to.be.revertedWithCustomError(jeton, "EnforcedPause");
    await expect(jeton.connect(alice).rendre(XAF(1), ref("c"))).to.be.revertedWithCustomError(jeton, "EnforcedPause");
    await expect(jeton.connect(alice).pauser()).to.be.revertedWithCustomError(jeton, "AccessControlUnauthorizedAccount");
    await jeton.connect(admin).reprendre();
    await jeton.connect(alice).transfer(bob.address, XAF(1));
    expect(await jeton.balanceOf(bob.address)).to.equal(XAF(1));
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
