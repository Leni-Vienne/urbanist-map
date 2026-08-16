import type SMTPTransport from "nodemailer/lib/smtp-transport";
import nodemailer from "nodemailer";

interface EmailServiceConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

function readConfig(): EmailServiceConfig {
  const smtpPort = Number.parseInt(process.env.SMTP_PORT ?? "", 10);
  const config: EmailServiceConfig = {
    host:
      process.env.SMTP_HOST ??
      (process.env.SES_REGION
        ? `email-smtp.${process.env.SES_REGION}.amazonaws.com`
        : "email-smtp.us-east-1.amazonaws.com"),
    port: smtpPort > 0 ? smtpPort : 587,
    user: process.env.SMTP_USERNAME ?? "",
    password: process.env.SMTP_PASSWORD ?? "",
    from: process.env.FROM_EMAIL ?? "",
  };

  if (process.env.NODE_ENV === "development" && config.host === "localhost") {
    if (!config.from) {
      console.warn("FROM_EMAIL configuration missing");
    }
  } else if (!config.user || !config.password || !config.from) {
    console.warn(
      "SMTP configuration incomplete. Required: SMTP_USERNAME, SMTP_PASSWORD, FROM_EMAIL",
    );
  }

  return config;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const config = readConfig();

  try {
    const transportConfig: SMTPTransport.Options = {
      host: config.host,
      port: config.port,
      secure: process.env.SMTP_SECURE === "true",
    };

    // Mailpit (dev) doesn't need authentication
    if (config.user && config.password) {
      transportConfig.auth = {
        user: config.user,
        pass: config.password,
      };
    }

    const transporter = nodemailer.createTransport(transportConfig);

    const result = await transporter.sendMail({
      from: config.from,
      to,
      subject,
      html,
    });
    console.log(`Email sent successfully to ${to}:`, result.messageId);
  } catch (error) {
    console.error("Email sending error:", error);

    if (process.env.NODE_ENV === "development") {
      console.log(`[DEV FALLBACK] Email to ${to}`);
      console.log(`Subject: ${subject}`);
      console.log("SMTP Config:", {
        host: config.host,
        port: config.port,
        user: config.user,
        from: config.from,
      });
    } else {
      throw error;
    }
  }
}
