const databaseUrl = process.env.DATABASE_URL?.trim();
const jwtSecret = process.env.JWT_SECRET;
const portValue = process.env.PORT ?? "3000";

if (!databaseUrl) {
  throw new Error("Missing required environment variable: DATABASE_URL");
}

try {
  const parsedUrl = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol)) {
    throw new Error();
  }
} catch {
  throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL");
}

if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be set and contain at least 32 characters");
}

const port = Number(portValue);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

export const DATABASE_URL = databaseUrl;
export const JWT_SECRET = jwtSecret;
export const PORT = port;

export const config = {
  databaseUrl: DATABASE_URL,
  jwtSecret: JWT_SECRET,
  port: PORT,
  nodeEnv: process.env.NODE_ENV ?? "development",
};
