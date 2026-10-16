import { strict as assert } from "node:assert";
import { test } from "node:test";
import { appliquerSupport, CONDITIONS, CONFIDENTIALITE, lienEmail, lienWhatsapp, SUPPORT, VERSION_CONDITIONS } from "./conditions";

test("la version des conditions est une date, comme la base l'exige", () => {
  assert.match(VERSION_CONDITIONS, /^\d{4}-\d{2}-\d{2}$/);
});

test("le support lu en base remplace le défaut ; une valeur abîmée ne l'efface pas", () => {
  appliquerSupport({ support: { email: "aide@glisil.com", whatsapp: "+237677123456" } });
  assert.equal(SUPPORT.email, "aide@glisil.com");
  assert.equal(SUPPORT.whatsapp, "237677123456");
  appliquerSupport({ support: { email: "pas une adresse", whatsapp: "677" } });
  assert.equal(SUPPORT.email, "aide@glisil.com");
  assert.equal(SUPPORT.whatsapp, "237677123456");
  assert.equal(lienWhatsapp("Bonjour"), "https://wa.me/237677123456?text=Bonjour");
  assert.equal(lienEmail("Sujet à é"), "mailto:aide@glisil.com?subject=Sujet%20%C3%A0%20%C3%A9");
});

test("les textes qui engagent ne promettent rien que le produit ne fasse pas", () => {
  const tout = [CONDITIONS, CONFIDENTIALITE].flatMap((d) => d.articles.flatMap((a) => a.paragraphes)).join(" ");
  assert.ok(!/garanti par l'État|sans risque|rendement/i.test(tout), "aucune promesse de garantie ou de rendement");
  assert.match(tout, /18 ans/);
  assert.match(tout, /Fermer mon compte/);
});
