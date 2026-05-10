import { join } from "node:path";
import enTranslations from "./i18n/en.json";
import frTranslations from "./i18n/fr.json";

// Type-safe translations
type Translations = typeof enTranslations;
type TemplateName = keyof Translations;
type Locale = "en" | "fr";

const translations: Record<Locale, Translations> = {
  en: enTranslations,
  fr: frTranslations,
};

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
  return template.replaceAll(/\{\{(\w+)\}\}/g, (_, key) => {
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
    const kebabCaseName = templateName.replaceAll(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();

    // Build-time switch (not runtime): CI builds the bundle with NODE_ENV=production, so Bun
    // inlines this and DCE keeps only the /app/email/templates branch in the deployed bundle.
    // Source-mode runs (bun --hot) keep the import.meta.dirname branch, which resolves at runtime.
    const templatePath =
      process.env.NODE_ENV === "production"
        ? join("/app/email/templates", `${kebabCaseName}-email.html`)
        : join(import.meta.dirname, "templates", `${kebabCaseName}-email.html`);

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
