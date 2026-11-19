import { expect, test } from "bun:test";
import { createI18n } from "vue-i18n";
import en from "@/locales/messages/en.json";
import fr from "@/locales/messages/fr.json";
import { getProjectDisplayName } from "./projectDisplayName";

test("uses the current locale for unnamed OSM projects, including during a language switch", () => {
  const { global: i18n } = createI18n({ legacy: false, locale: "en", messages: { en, fr } });
  const project = {
    name: null,
    importSource: { type: "osm" },
    externalProperties: { construction: "light_rail" },
  };

  expect(getProjectDisplayName(project, i18n)).toBe("Light Rail");
  i18n.locale.value = "fr";
  expect(getProjectDisplayName(project, i18n)).toBe("Tram-train");
  expect(
    getProjectDisplayName(
      { ...project, externalProperties: { construction: "residential" } },
      i18n,
    ),
  ).toBe("Résidentiel");
  expect(
    getProjectDisplayName({ ...project, externalProperties: { construction: "industrial" } }, i18n),
  ).toBe("Industriel");
  expect(
    getProjectDisplayName(
      { ...project, externalProperties: { construction: "uncatalogued_subtype" } },
      i18n,
    ),
  ).toBe("Projet OpenStreetMap");
  expect(
    getProjectDisplayName(
      { ...project, externalProperties: { construction: "construction" } },
      i18n,
    ),
  ).toBe("Projet OpenStreetMap");
  expect(getProjectDisplayName({ name: null }, i18n)).toBe("Projet sans nom");
  expect(getProjectDisplayName({ ...project, name: "Central Line" }, i18n)).toBe("Central Line");
});
