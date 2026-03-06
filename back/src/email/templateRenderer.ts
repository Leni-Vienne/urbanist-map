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

/**
 * Simple template renderer that replaces {{placeholder}} with values
 * SECURITY: Ensures values are HTML-escaped to prevent injection attacks
 * @param template HTML template string with {{placeholder}} markers
 * @param data Key-value pairs to replace in the template
 * @returns Rendered HTML string
 */
function escapeHtml(unsafe: string) {
  return unsafe
    .replaceAll(/&/g, "&amp;")
    .replaceAll(/</g, "&lt;")
    .replaceAll(/>/g, "&gt;")
    .replaceAll(/"/g, "&quot;")
    .replaceAll(/'/g, "&#039;");
}

/**
 * Simple template renderer that replaces {{placeholder}} with values
 * SECURITY: Ensures values are HTML-escaped to prevent injection attacks
 * @param template HTML template string with {{placeholder}} markers
 * @param data Key-value pairs to replace in the template
 * @returns Rendered HTML string
 */
function renderTemplate(template: string, data: Record<string, string>): string {
  return template.replaceAll(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = data[key] ?? "";
    return escapeHtml(value);
  });
}

/**
 * Load and render an email template with translations
 * @param templateName Name of the template (e.g., 'verification', 'passwordReset')
 * @param variables Dynamic variables to inject (e.g., { verificationUrl: '...' })
 * @param locale User's preferred language (defaults to 'en')
 * @returns Object with subject and rendered HTML
 */
export async function renderEmailTemplate(
  templateName: TemplateName,
  variables: Record<string, string>,
  locale: Locale = "en",
): Promise<{ subject: string; html: string }> {
  try {
    // Get translations for the specified locale
    const translation = translations[locale]?.[templateName];
    if (!translation) {
      throw new Error(`Translation not found for template: ${templateName}, locale: ${locale}`);
    }

    // Convert camelCase template name to kebab-case for file lookup
    const kebabCaseName = templateName.replaceAll(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();

    // Load HTML template file
    // In production (Docker), templates are mounted at /app/email
    // In development, use relative path from this file
    const templatePath =
      process.env.NODE_ENV === "production"
        ? join("/app/email/templates", `${kebabCaseName}-email.html`)
        : join(__dirname, "templates", `${kebabCaseName}-email.html`);

    const templateFile = Bun.file(templatePath);

    if (!(await templateFile.exists())) {
      throw new Error(`Template file not found: ${templatePath}`);
    }

    const template = await templateFile.text();

    // Merge translations with dynamic variables
    const data = {
      ...translation,
      ...variables,
    };

    // Render the template
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
