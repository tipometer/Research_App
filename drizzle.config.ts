import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

// drizzle-kit 0.31.5 ignores `ssl` when `dbCredentials.url` is used — parse the
// URL into components so TLS config is honored. See spec §6.2 TLS fallback.
const url = new URL(connectionString);
const isLocal = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, "").split("?")[0],
    ...(isLocal
      ? {}
      : { ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true } }),
  },
});
