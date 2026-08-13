import path from "node:path";
import enTranslations from "./i18n/en.json";
import frTranslations from "./i18n/fr.json";

// Type-safe translations
type Translations = typeof enTranslations;
type TemplateName = keyof Translations;
type Locale = "en" | "fr";

const translations = {
  en: enTranslations,
  fr: frTranslations,
} satisfies Record<Locale, Translations>;

function escapeHtml(unsafe: string) {
  return unsafe
    .replaceAll(/&/g, "&amp;")
    .replaceAll(/</g, "&lt;")
    .replaceAll(/>/g, "&gt;")
    .replaceAll(/"/g, "&quot;")
    .replaceAll(/'/g, "&#039;");
}

// Replaces {{placeholder}} markers with HTML-escaped values
function renderTemplate(template: string, data: Record<string, string>): string {
  return template.replaceAll(/\{\{(?<key>\w+)\}\}/g, (_, key) => {
    const value = data[key] ?? "";
    return escapeHtml(value);
  });
}

export async function renderEmailTemplate(
  templateName: TemplateName,
  variables: Record<string, string>,
): Promise<{ subject: string; html: string }> {
  try {
    // Locale is hardcoded to "en" until callers can plumb a user-preferred locale through.
    // The `fr` translations exist for that future wiring.
    const translation = translations.en[templateName];

    // Convert camelCase template name to kebab-case for file lookup
    const kebabCaseName = templateName
      .replaceAll(/(?<lower>[a-z])(?<upper>[A-Z])/g, "$<lower>-$<upper>")
      .toLowerCase();

    // Build-time switch (not runtime): CI builds the bundle with NODE_ENV=production, so Bun
    // inlines this and DCE keeps only the literal-path branch in the deployed bundle.
    // Source-mode runs (bun --hot) keep the import.meta.dirname branch, which resolves at runtime.
    const templatePath =
      process.env.NODE_ENV === "production"
        ? path.join("/home/bun/app/email/templates", `${kebabCaseName}-email.html`)
        : path.join(import.meta.dirname, "templates", `${kebabCaseName}-email.html`);

    const templateFile = Bun.file(templatePath);

    if (!(await templateFile.exists())) {
      throw new Error(`Template file not found: ${templatePath}`);
    }

    const template = await templateFile.text();

    const data = {
      ...translation,
      ...variables,
    };

    const html = renderTemplate(template, data);

    return {
      subject: translation.subject,
      html,
    };
  } catch (error) {
    console.error("Email template rendering error:", error);
    throw error;
  }
}
