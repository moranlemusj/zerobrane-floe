import { defineConfig } from "drizzle-kit";

const url = process.env.NEON_DATABASE_URL;
if (!url) {
  throw new Error(
    "NEON_DATABASE_URL not set. Add it to .env (the repo root) or export it in your shell.",
  );
}

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
