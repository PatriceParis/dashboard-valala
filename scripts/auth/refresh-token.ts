// =============================================================
// Refresh the LinkedIn access token using the refresh token.
// Updates .env.local with the new access token + expiry.
// =============================================================

import * as dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

const ENV_FILE = path.join(process.cwd(), ".env.local");

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

async function main() {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const refreshToken = process.env.LINKEDIN_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, LINKEDIN_REFRESH_TOKEN required");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Refresh failed ${res.status}: ${text}`);
  }
  const data = (await res.json()) as TokenResponse;
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  console.log("New access token obtained. Expires:", expiresAt);

  if (!fs.existsSync(ENV_FILE)) {
    console.warn(".env.local not found — skipping write");
    console.log("LINKEDIN_ACCESS_TOKEN=" + data.access_token);
    console.log("LINKEDIN_TOKEN_EXPIRES_AT=" + expiresAt);
    return;
  }

  let env = fs.readFileSync(ENV_FILE, "utf-8");
  env = upsertEnv(env, "LINKEDIN_ACCESS_TOKEN", data.access_token);
  env = upsertEnv(env, "LINKEDIN_TOKEN_EXPIRES_AT", expiresAt);
  if (data.refresh_token) {
    env = upsertEnv(env, "LINKEDIN_REFRESH_TOKEN", data.refresh_token);
  }
  fs.writeFileSync(ENV_FILE, env);
  console.log("Updated .env.local");
  console.log("Next: update LINKEDIN_ACCESS_TOKEN in Vercel project env vars.");
}

function upsertEnv(content: string, key: string, value: string): string {
  const re = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  return re.test(content) ? content.replace(re, line) : content + (content.endsWith("\n") ? "" : "\n") + line + "\n";
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
