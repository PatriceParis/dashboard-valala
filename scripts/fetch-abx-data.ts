// =============================================================
// Build-time pipeline — ABX matching (V3)
// Joins LinkedIn company analytics + lemlist campaign leads + HubSpot
// companies/deals to compute influence funnel + ROAS.
// Writes data/abx.json (consumed by data-loader at SSG).
// =============================================================

import * as dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

import { HubSpotClient, HubSpotApiError } from "./hubspot-client";
import { toISODate, addDays } from "../src/lib/utils";

const DATA_DIR = path.join(process.cwd(), "data");

// Local types (mirror src/lib/types.ts)
interface CompanyAnalyticsFile {
  window: "7d" | "30d" | "90d";
  entries: Array<{
    orgId: string;
    name: string;
    vanityName?: string;
    impressions: number;
    clicks: number;
    spend: number;
  }>;
}
interface OutboundFile {
  campaigns: Array<{ id: string; name: string }>;
  dailyActivity: unknown[];
}
interface ABXCompanyMatch {
  id: string;
  name: string;
  domain?: string;
  linkedinSlug?: string;
  sources: Array<"paid" | "outbound">;
  confidence: number;
  matchKind: "domain" | "slug" | "fuzzy";
  reached: boolean;
  inCRM: boolean;
  quoted: boolean;
  won: boolean;
  pipelineEUR?: number;
  revenueEUR?: number;
  firstCRMDate?: string;
}
interface ABXFunnel {
  reached: number;
  inCRM: number;
  quoted: number;
  won: number;
  pipelineEUR: number;
  revenueEUR: number;
  spendEUR: number;
}
interface ABXData {
  matches: ABXCompanyMatch[];
  funnel: ABXFunnel;
  lastUpdated: string;
}

function writeJson(filename: string, payload: unknown) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(payload, null, 2));
  console.log(`  wrote data/${filename}`);
}

function writeEmpty(reason: string) {
  console.warn(`[abx] skipped: ${reason}`);
  writeJson("abx.json", {
    matches: [],
    funnel: { reached: 0, inCRM: 0, quoted: 0, won: 0, pipelineEUR: 0, revenueEUR: 0, spendEUR: 0 },
    lastUpdated: new Date().toISOString(),
  } satisfies ABXData);
}

function readJson<T>(file: string, fallback: T): T {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

// -------- Normalizers / matchers ------------------------------

const STOPWORDS = new Set(["sa", "sas", "sarl", "ltd", "llc", "gmbh", "inc", "corp", "group", "groupe", "co"]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function normalizeDomain(s: string | undefined): string | undefined {
  if (!s) return undefined;
  return s.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
}

function fuzzyScore(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  // Sørensen-style (intersection / min size) → subset matches count.
  // Ex: "Decathlon France" vs "Decathlon" → 1 / min(2,1) = 1.0 (instead of 0.5).
  // Guard against single-token false positives by requiring at least 1 longer-than-3 token.
  const score = inter / Math.min(ta.size, tb.size);
  if (score < 0.99) return score;
  // Perfect score: require at least one substantive token (>3 chars) to avoid
  // 1-letter or 2-letter matches like "AB" vs "AB Inc".
  const allTokens = [...ta, ...tb];
  if (allTokens.some((t) => t.length > 3)) return score;
  return score * 0.5;
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    // Strip combining marks via Unicode property (ASCII-safe in source)
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]/g, "");
}

// -------- Main -------------------------------------------------

async function main() {
  console.log("=== ABX matching (Valala) ===");

  const companyWindows = readJson<CompanyAnalyticsFile[]>("company-analytics.json", []);
  const outbound = readJson<OutboundFile>("outbound.json", { campaigns: [], dailyActivity: [] });

  // Use 90d window for ABX matching (broadest signal coverage)
  const paid =
    companyWindows.find((w) => w.window === "90d")?.entries ?? [];
  console.log(`Paid companies (90d): ${paid.length}`);
  console.log(`Outbound campaigns: ${outbound.campaigns.length}`);

  if (!process.env.HUBSPOT_ACCESS_TOKEN) {
    writeEmpty("HUBSPOT_ACCESS_TOKEN missing");
    return;
  }

  // -----------------------------------------------------------
  // Step 1 — Fetch HubSpot companies (created in last 180j, or having recent activity)
  // -----------------------------------------------------------
  console.log("[1/3] HubSpot companies");
  const hub = new HubSpotClient();
  const cutoff = addDays(new Date(), -180).getTime();
  type HSCompany = {
    id: string;
    properties: {
      name?: string;
      domain?: string;
      createdate?: string;
      hs_lastmodifieddate?: string;
      linkedin_company_page?: string;
    };
  };
  let companies: HSCompany[] = [];
  try {
    companies = await hub.paginate<HSCompany>(async (after) => {
      const res = (await hub.searchCompanies({
        filterGroups: [
          {
            filters: [
              { propertyName: "createdate", operator: "GT", value: String(cutoff) },
            ],
          },
        ],
        properties: ["name", "domain", "createdate", "hs_lastmodifieddate", "linkedin_company_page"],
        limit: 100,
        after,
      })) as { results?: HSCompany[]; paging?: { next?: { after?: string } } };
      return res;
    });
    console.log(`  ${companies.length} companies`);
  } catch (err) {
    if (err instanceof HubSpotApiError) {
      console.warn(`  search failed: ${err.status}: ${err.body.slice(0, 200)}`);
    } else {
      console.warn(`  search failed:`, (err as Error).message);
    }
  }

  // -----------------------------------------------------------
  // Step 2 — Fetch deals (open + closed-won, last 180j)
  // -----------------------------------------------------------
  console.log("[2/3] HubSpot deals");
  type HSDeal = {
    id: string;
    properties: {
      dealname?: string;
      amount?: string;
      dealstage?: string;
      pipeline?: string;
      createdate?: string;
      closedate?: string;
      hs_is_closed?: string;
      hs_is_closed_won?: string;
    };
    associations?: { companies?: { results?: Array<{ id: string }> } };
  };
  let deals: HSDeal[] = [];
  try {
    deals = await hub.paginate<HSDeal>(async (after) => {
      const res = (await hub.searchDeals({
        filterGroups: [
          {
            filters: [
              { propertyName: "createdate", operator: "GT", value: String(cutoff) },
            ],
          },
        ],
        properties: [
          "dealname",
          "amount",
          "dealstage",
          "pipeline",
          "createdate",
          "closedate",
          "hs_is_closed",
          "hs_is_closed_won",
        ],
        // (associations populated separately via batchReadDealCompanyAssociations)
        limit: 100,
        after,
      })) as { results?: HSDeal[]; paging?: { next?: { after?: string } } };
      return res;
    });
    console.log(`  ${deals.length} deals`);
  } catch (err) {
    console.warn(`  deals fetch failed:`, (err as Error).message);
  }

  // -----------------------------------------------------------
  // Step 3 — match paid companies ↔ HubSpot companies
  // -----------------------------------------------------------
  console.log("[3/3] matching");
  // Build lookups: by domain, by LinkedIn slug, by normalized name
  const hsByDomain = new Map<string, HSCompany>();
  const hsBySlug = new Map<string, HSCompany>();
  const hsByNormName = new Map<string, HSCompany>();
  for (const c of companies) {
    const dom = normalizeDomain(c.properties.domain);
    if (dom) hsByDomain.set(dom, c);
    const li = c.properties.linkedin_company_page;
    if (li) {
      const m = li.match(/company\/([^/?]+)/);
      if (m) hsBySlug.set(m[1].toLowerCase(), c);
    }
    const norm = normalizeName(c.properties.name ?? "");
    if (norm.length >= 3) hsByNormName.set(norm, c);
  }

  // Deals by company — the search response doesn't reliably populate associations,
  // so we explicitly batch-read the deal↔company associations via the v4 API.
  const dealsByCompany = new Map<string, HSDeal[]>();
  const dealById = new Map(deals.map((d) => [d.id, d]));
  for (const batchIds of (function* chunkIds(arr: string[], size: number) {
    for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
  })(deals.map((d) => d.id), 100)) {
    try {
      const res = (await hub.batchReadDealCompanyAssociations(batchIds)) as {
        results?: Array<{ from: { id: string }; to: Array<{ toObjectId: string }> }>;
      };
      for (const r of res.results ?? []) {
        const d = dealById.get(r.from.id);
        if (!d) continue;
        for (const t of r.to) {
          const companyId = String(t.toObjectId);
          const arr = dealsByCompany.get(companyId) ?? [];
          arr.push(d);
          dealsByCompany.set(companyId, arr);
        }
      }
    } catch (err) {
      console.warn(`  batchReadDealCompanyAssociations failed:`, (err as Error).message);
    }
  }
  console.log(`  ${dealsByCompany.size} companies with deals`);

  const matches: ABXCompanyMatch[] = [];
  let spendInfluenced = 0;
  // Skip companies whose "name" is just a numeric ID (orgLookup failed for them).
  const isNumericName = (s: string) => /^\d+$/.test(s.trim());
  for (const p of paid) {
    let hs: HSCompany | undefined;
    let kind: "domain" | "slug" | "fuzzy" = "fuzzy";
    let confidence = 0;
    let slug: string | undefined;

    // Pass 1: slug from LinkedIn vanityName
    if (p.vanityName) {
      slug = p.vanityName.toLowerCase();
      hs = hsBySlug.get(slug);
      if (hs) {
        kind = "slug";
        confidence = 0.9;
      }
    }
    // Pass 2: normalized name exact match
    if (!hs && !isNumericName(p.name)) {
      const norm = normalizeName(p.name);
      if (norm.length >= 3) {
        const direct = hsByNormName.get(norm);
        if (direct) {
          hs = direct;
          kind = "fuzzy"; // logged as fuzzy but with 1.0 confidence (exact normalized)
          confidence = 1.0;
        }
      }
    }
    // Pass 3: fuzzy on name (only if we have a real name, not a number)
    if (!hs && !isNumericName(p.name)) {
      let bestScore = 0;
      let best: HSCompany | undefined;
      for (const c of companies) {
        const s = fuzzyScore(p.name, c.properties.name ?? "");
        if (s > bestScore) {
          bestScore = s;
          best = c;
        }
      }
      if (best && bestScore >= 0.6) {
        hs = best;
        kind = "fuzzy";
        confidence = bestScore;
      }
    }

    const m: ABXCompanyMatch = {
      id: hs?.id ?? `linkedin:${p.orgId}`,
      name: hs?.properties.name ?? p.name,
      domain: normalizeDomain(hs?.properties.domain),
      linkedinSlug: slug,
      sources: ["paid"],
      confidence,
      matchKind: kind,
      reached: true,
      inCRM: !!hs,
      quoted: false,
      won: false,
      firstCRMDate: hs?.properties.createdate
        ? new Date(parseInt(hs.properties.createdate, 10) || 0).toISOString().slice(0, 10)
        : undefined,
    };

    if (hs) {
      const ds = dealsByCompany.get(hs.id) ?? [];
      const pipelineEUR = ds.reduce((sum, d) => sum + (parseFloat(d.properties.amount ?? "0") || 0), 0);
      const wonDeals = ds.filter((d) => d.properties.hs_is_closed_won === "true");
      const revenueEUR = wonDeals.reduce((sum, d) => sum + (parseFloat(d.properties.amount ?? "0") || 0), 0);
      m.quoted = ds.length > 0;
      m.won = wonDeals.length > 0;
      m.pipelineEUR = pipelineEUR;
      m.revenueEUR = revenueEUR;
    }
    matches.push(m);
    spendInfluenced += p.spend;
  }

  const funnel: ABXFunnel = {
    reached: matches.filter((m) => m.reached).length,
    inCRM: matches.filter((m) => m.inCRM).length,
    quoted: matches.filter((m) => m.quoted).length,
    won: matches.filter((m) => m.won).length,
    pipelineEUR: matches.reduce((s, m) => s + (m.pipelineEUR ?? 0), 0),
    revenueEUR: matches.reduce((s, m) => s + (m.revenueEUR ?? 0), 0),
    spendEUR: spendInfluenced,
  };

  writeJson("abx.json", {
    matches,
    funnel,
    lastUpdated: new Date().toISOString(),
  } satisfies ABXData);
  console.log(
    `  ${matches.length} matches | reached=${funnel.reached} crm=${funnel.inCRM} quoted=${funnel.quoted} won=${funnel.won}`,
  );
  console.log("=== done ===");
}

main().catch((err) => {
  console.error("ABX pipeline failed:", err);
  writeEmpty(`pipeline error: ${(err as Error).message}`);
  process.exit(0);
});
