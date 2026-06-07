import "dotenv/config";

function require(key: string): string {
  const value = process.env[key];
  if (value !== undefined && value.trim() !== "") return value.trim();
  return "";
}

export interface Config {
  oceanApiToken: string;
  prospeoApiKey: string;
  brevoApiKey: string;
  brevoSenderName: string;
  brevoSenderEmail: string;
}

function loadConfig(): Config {
  const keys: Array<[keyof Config, string]> = [
    ["oceanApiToken", "OCEAN_API_TOKEN"],
    ["prospeoApiKey", "PROSPEO_API_KEY"],
    ["brevoApiKey", "BREVO_API_KEY"],
    ["brevoSenderName", "BREVO_SENDER_NAME"],
    ["brevoSenderEmail", "BREVO_SENDER_EMAIL"],
  ];

  const missing: string[] = [];
  const config = {} as Config;

  for (const [field, envKey] of keys) {
    const value = require(envKey);
    if (value === "") {
      missing.push(envKey);
    } else {
      // safe: every field in Config is a string, and keys[] enumerates them all
      (config as unknown as Record<string, string>)[field] = value;
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n` +
        missing.map((k) => `  • ${k}`).join("\n") +
        `\n\nCopy .env.example → .env and fill in the missing values.`
    );
  }

  return config;
}

export const config: Config = loadConfig();
