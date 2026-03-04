import type SMTPTransport from "nodemailer/lib/smtp-transport";
import nodemailer from "nodemailer";

// Email service configuration interface
interface EmailServiceConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

// Email service using Amazon SES or Mailpit for development
class EmailService {
  private config: EmailServiceConfig;

  constructor(config: EmailServiceConfig) {
    this.config = config;
  }

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    try {
      // Use nodemailer for SMTP connection
      const transportConfig: SMTPTransport.Options = {
        host: this.config.host,
        port: this.config.port,
        secure: process.env.SMTP_SECURE === "true", // Use TLS/SSL
      };

      // Only add auth if credentials are provided (not needed for Mailpit)
      if (this.config.user && this.config.password) {
        transportConfig.auth = {
          user: this.config.user,
          pass: this.config.password,
        };
      }

      const transporter = nodemailer.createTransport(transportConfig);

      const mailOptions = {
        from: this.config.from,
        to: to,
        subject: subject,
        html: html,
      };

      const result = await transporter.sendMail(mailOptions);
      console.log(`Email sent successfully to ${to}:`, result.messageId);
    } catch (error) {
      console.error("Email sending error:", error);

      // In development, fallback to console logging
      if (process.env.NODE_ENV === "development") {
        console.log(`[DEV FALLBACK] Email to ${to}`);
        console.log(`Subject: ${subject}`);
        console.log("SMTP Config:", {
          host: this.config.host,
          port: this.config.port,
          user: this.config.user,
          from: this.config.from,
        });
      } else {
        throw error;
      }
    }
  }
}

// Initialize email service with environment configuration
export function getEmailService(): EmailService {
  const config: EmailServiceConfig = {
    // Use Mailpit for development, AWS SES for production
    host:
      process.env.SMTP_HOST ??
      (process.env.SES_REGION
        ? `email-smtp.${process.env.SES_REGION}.amazonaws.com`
        : "email-smtp.us-east-1.amazonaws.com"),
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USERNAME ?? "",
    password: process.env.SMTP_PASSWORD ?? "",
    from: process.env.FROM_EMAIL ?? "",
  };

  // For Mailpit (dev), credentials are optional
  if (process.env.NODE_ENV === "development" && config.host === "localhost") {
    // Mailpit doesn't need authentication
    if (!config.from) {
      console.warn("FROM_EMAIL configuration missing");
    }
    // For production (AWS SES), credentials are required
  } else if (!config.user || !config.password || !config.from) {
    console.warn(
      "SMTP configuration incomplete. Required: SMTP_USERNAME, SMTP_PASSWORD, FROM_EMAIL",
    );
  }

  return new EmailService(config);
}
