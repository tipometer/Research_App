import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

const isLocal = /@(localhost|127\.0\.0\.1)(:|\/|$)/.test(connectionString);

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    url: connectionString,
    ...(isLocal
      ? {}
      : { ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true } }),
  },
});
