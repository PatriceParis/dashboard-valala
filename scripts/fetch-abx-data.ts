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
interface CampaignAnalyticsFile {
  campaignId: string;
  costInLocalCurrency: number;
  impressions: number;
  clicks: number;
}
interface OutboundFile {
  campaigns: Array<{ id: string; name: string }>;
  dailyActivity: unknown[];
  companies?: Array<{
    domain: string;
    companyName?: string;
    leadCount: number;
    lastActivityDate: string;
  }>;
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
  dealsOpen?: number;
  dealsWon?: number;
  dealsLost?: number;
  firstCRMDate?: string;
  influenced?: boolean;
  pipelineInfluencedEUR?: number;
  revenueInfluencedEUR?: number;
}
interface ABXFunnel {
  reached: number;
  inCRM: number;
  quoted: number;
  won: number;
  pipelineEUR: number;
  revenueEUR: number;
  spendEUR: number;
  inCRMInfluenced: number;
  quotedInfluenced: number;
  wonInfluenced: number;
  pipelineInfluencedEUR: number;
  revenueInfluencedEUR: number;
  abxLaunchDate: string;
}

// Date de lancement des campagnes du groupe ABX (= borne d'attribution
// d'influence). Une entreprise/deal antérieur à cette date est considéré
// préexistant (déjà client/connu), donc EXCLU du ROAS influence.
// ⚠️ À ajuster si la date de démarrage ABX du client change.
const ABX_LAUNCH_DATE = "2026-04-01";
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
    funnel: {
      reached: 0, inCRM: 0, quoted: 0, won: 0, pipelineEUR: 0, revenueEUR: 0, spendEUR: 0,
      inCRMInfluenced: 0, quotedInfluenced: 0, wonInfluenced: 0,
      pipelineInfluencedEUR: 0, revenueInfluencedEUR: 0, abxLaunchDate: ABX_LAUNCH_DATE,
    },
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

  // V3.1 — Impact CRM scopé sur le groupe ABX (weekly Valala 04/06/2026).
  // Si `company-analytics-abx.json` existe, on l'utilise comme source paid
  // pour le matching ; sinon, fallback sur le fichier global (rétro-compat).
  const abxCompanyWindows = readJson<CompanyAnalyticsFile[]>("company-analytics-abx.json", []);
  const fallbackCompanyWindows = readJson<CompanyAnalyticsFile[]>("company-analytics.json", []);
  const companyWindows = abxCompanyWindows.length > 0 ? abxCompanyWindows : fallbackCompanyWindows;
  const usingABXScope = abxCompanyWindows.length > 0;
  console.log(`Paid scope: ${usingABXScope ? "ABX group only" : "all groups (fallback)"}`);
  const outbound = readJson<OutboundFile>("outbound.json", { campaigns: [], dailyActivity: [] });

  // Use 90d window for ABX matching (broadest signal coverage)
  const paid =
    companyWindows.find((w) => w.window === "90d")?.entries ?? [];
  console.log(`Paid companies (90d, ${usingABXScope ? "ABX-scoped" : "all"}): ${paid.length}`);
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

  // Dépenses ABX (90j, niveau CAMPAIGN) — scopées aux campagnes du groupe ABX
  // uniquement (cohérent avec le périmètre Impact CRM). On lit campaigns.json
  // pour la correspondance campaignId → campaignGroupId, puis on somme
  // analytics.json (CAMPAIGN ALL) sur les seules campagnes ABX.
  // Le MEMBER_COMPANY pivot n'attribue que ~30% du spend → on n'utilise PAS ce
  // pivot pour le dénominateur du ROAS.
  const ABX_GROUP_ID = "1003302024";
  const campaignAnalytics = readJson<CampaignAnalyticsFile[]>("analytics.json", []);
  const campaignsMeta = readJson<Array<{ id: string; campaignGroupId: string }>>(
    "campaigns.json",
    [],
  );
  const abxCampaignIds = new Set(
    campaignsMeta.filter((c) => c.campaignGroupId === ABX_GROUP_ID).map((c) => c.id),
  );
  const totalSpendAll = campaignAnalytics.reduce((s, c) => s + (c.costInLocalCurrency || 0), 0);
  const abxSpend90j =
    abxCampaignIds.size > 0
      ? campaignAnalytics
          .filter((c) => abxCampaignIds.has(c.campaignId))
          .reduce((s, c) => s + (c.costInLocalCurrency || 0), 0)
      : totalSpendAll; // fallback si le mapping groupe est indisponible
  console.log(
    `ABX spend (90j, CAMPAIGN-level, ${abxCampaignIds.size} campagnes ABX): ${abxSpend90j.toFixed(2)}€ (total compte: ${totalSpendAll.toFixed(2)}€)`,
  );

  // -----------------------------------------------------------
  // Outbound (lemlist) — build domain set captured from activities
  // -----------------------------------------------------------
  const outboundCompanies = outbound.companies ?? [];
  console.log(`Outbound companies (domains): ${outboundCompanies.length}`);
  const outboundByDomain = new Map(outboundCompanies.map((c) => [c.domain, c]));
  // Track which outbound domains end up matched into the union below.
  const matchedOutboundDomains = new Set<string>();

  const matches: ABXCompanyMatch[] = [];
  // Skip companies whose "name" is just a numeric ID (orgLookup failed for them).
  const isNumericName = (s: string) => /^\d+$/.test(s.trim());

  // Helper unique de calcul des métriques deal (évite la duplication entre les
  // boucles paid et outbound). Distingue open / won / lost ET la sous-partie
  // « influence » = deals CRÉÉS après le lancement ABX (date createdate).
  const dealDateISO = (d: HSDeal): string => {
    const c = d.properties.createdate;
    if (!c) return "";
    const t = parseInt(c, 10);
    if (!Number.isFinite(t)) return "";
    return new Date(t).toISOString().slice(0, 10);
  };
  const computeDealMetrics = (ds: HSDeal[]) => {
    const amount = (d: HSDeal) => parseFloat(d.properties.amount ?? "0") || 0;
    const isClosed = (d: HSDeal) => d.properties.hs_is_closed === "true";
    const isWon = (d: HSDeal) => d.properties.hs_is_closed_won === "true";
    const isInfluenced = (d: HSDeal) => {
      const dt = dealDateISO(d);
      return dt !== "" && dt >= ABX_LAUNCH_DATE;
    };
    const openDeals = ds.filter((d) => !isClosed(d));
    const wonDeals = ds.filter(isWon);
    const lostDeals = ds.filter((d) => isClosed(d) && !isWon(d));
    return {
      quoted: openDeals.length > 0,
      won: wonDeals.length > 0,
      pipelineEUR: openDeals.reduce((s, d) => s + amount(d), 0),
      revenueEUR: wonDeals.reduce((s, d) => s + amount(d), 0),
      dealsOpen: openDeals.length,
      dealsWon: wonDeals.length,
      dealsLost: lostDeals.length,
      pipelineInfluencedEUR: openDeals.filter(isInfluenced).reduce((s, d) => s + amount(d), 0),
      revenueInfluencedEUR: wonDeals.filter(isInfluenced).reduce((s, d) => s + amount(d), 0),
    };
  };
  // Flag d'influence niveau entreprise : entrée en CRM après le lancement ABX,
  // OU au moins un deal influencé (créé post-lancement).
  const computeInfluenced = (m: ABXCompanyMatch): boolean => {
    const fc = m.firstCRMDate;
    if (fc && fc >= ABX_LAUNCH_DATE) return true;
    return (m.pipelineInfluencedEUR ?? 0) > 0 || (m.revenueInfluencedEUR ?? 0) > 0;
  };

  // ---- Iterate paid first (LinkedIn MEMBER_COMPANY pivot) ----
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

    // Determine if this paid company is also touched by outbound (via domain).
    const hsDomain = normalizeDomain(hs?.properties.domain);
    const sources: Array<"paid" | "outbound"> = ["paid"];
    if (hsDomain && outboundByDomain.has(hsDomain)) {
      sources.push("outbound");
      matchedOutboundDomains.add(hsDomain);
    }

    const m: ABXCompanyMatch = {
      id: hs?.id ?? `linkedin:${p.orgId}`,
      name: hs?.properties.name ?? p.name,
      domain: hsDomain,
      linkedinSlug: slug,
      sources,
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
      const dm = computeDealMetrics(dealsByCompany.get(hs.id) ?? []);
      m.quoted = dm.quoted;
      m.won = dm.won;
      m.pipelineEUR = dm.pipelineEUR;
      m.revenueEUR = dm.revenueEUR;
      m.dealsOpen = dm.dealsOpen;
      m.dealsWon = dm.dealsWon;
      m.dealsLost = dm.dealsLost;
      m.pipelineInfluencedEUR = dm.pipelineInfluencedEUR;
      m.revenueInfluencedEUR = dm.revenueInfluencedEUR;
    }
    m.influenced = computeInfluenced(m);
    matches.push(m);
  }

  // ---- Iterate outbound-only (lemlist domains not touched by paid) ----
  // For each remaining outbound domain, try to match to HubSpot by domain or
  // company name. Create a match entry with sources=["outbound"].
  for (const oc of outboundCompanies) {
    if (matchedOutboundDomains.has(oc.domain)) continue;
    let hs: HSCompany | undefined = hsByDomain.get(oc.domain);
    let kind: "domain" | "slug" | "fuzzy" = "domain";
    let confidence = hs ? 1.0 : 0;

    if (!hs && oc.companyName) {
      // Try normalized name match
      const norm = normalizeName(oc.companyName);
      if (norm.length >= 3) {
        const direct = hsByNormName.get(norm);
        if (direct) {
          hs = direct;
          kind = "fuzzy";
          confidence = 1.0;
        }
      }
      // Fuzzy fallback
      if (!hs) {
        let bestScore = 0;
        let best: HSCompany | undefined;
        for (const c of companies) {
          const s = fuzzyScore(oc.companyName, c.properties.name ?? "");
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
    }

    const m: ABXCompanyMatch = {
      id: hs?.id ?? `outbound:${oc.domain}`,
      name: hs?.properties.name ?? oc.companyName ?? oc.domain,
      domain: oc.domain,
      sources: ["outbound"],
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
      const dm = computeDealMetrics(dealsByCompany.get(hs.id) ?? []);
      m.quoted = dm.quoted;
      m.won = dm.won;
      m.pipelineEUR = dm.pipelineEUR;
      m.revenueEUR = dm.revenueEUR;
      m.dealsOpen = dm.dealsOpen;
      m.dealsWon = dm.dealsWon;
      m.dealsLost = dm.dealsLost;
      m.pipelineInfluencedEUR = dm.pipelineInfluencedEUR;
      m.revenueInfluencedEUR = dm.revenueInfluencedEUR;
    }
    m.influenced = computeInfluenced(m);
    matches.push(m);
  }

  // -----------------------------------------------------------
  // Step 4 — Dédup par HubSpot ID (Quick Win #1, 2026-06-XX)
  // -----------------------------------------------------------
  // Sans ce dédup, une même HubSpot company peut apparaître 2 fois :
  // - 1 entrée venant du paid (matchée via slug LinkedIn)
  // - 1 entrée venant de l'outbound (matchée via domain lemlist)
  // Conséquence : funnel et pipeline EUR sont DOUBLE-COMPTÉS sur ces entreprises.
  // Le merge consolide les `sources` (≤ "paid" + "outbound" = "both") et garde
  // la meilleure confidence + le matchKind le plus fiable.
  //
  // ⚠️ On ne dédup QUE les entrées qui ont un vrai HubSpot ID (`hs_xxx`).
  // Les IDs synthétiques `linkedin:{orgId}` et `outbound:{domain}` représentent
  // des entreprises pas dans le CRM — chacune reste unique côté display.
  const beforeDedup = matches.length;
  const dedupedById = new Map<string, ABXCompanyMatch>();
  const standalone: ABXCompanyMatch[] = [];
  for (const m of matches) {
    const isHubspotId = m.inCRM && !m.id.startsWith("linkedin:") && !m.id.startsWith("outbound:");
    if (!isHubspotId) {
      standalone.push(m);
      continue;
    }
    const existing = dedupedById.get(m.id);
    if (!existing) {
      dedupedById.set(m.id, m);
      continue;
    }
    // Merge : union des sources, max de la confidence, conservation des champs financiers.
    const mergedSources = Array.from(new Set([...existing.sources, ...m.sources])) as Array<
      "paid" | "outbound"
    >;
    existing.sources = mergedSources;
    if (m.confidence > existing.confidence) {
      existing.confidence = m.confidence;
      existing.matchKind = m.matchKind;
    }
    // domain / linkedinSlug : on garde la valeur non-vide la plus complète
    if (!existing.domain && m.domain) existing.domain = m.domain;
    if (!existing.linkedinSlug && m.linkedinSlug) existing.linkedinSlug = m.linkedinSlug;
    // Le pipeline / revenue / quoted / won / dealsOpen / dealsWon / dealsLost
    // viennent du même deal HubSpot (identifié par HubSpot ID), donc identiques
    // entre les 2 entrées : on conserve la valeur existante.
  }
  const merged = [...dedupedById.values(), ...standalone];
  const dedupedCount = beforeDedup - merged.length;
  console.log(`  Dédup HubSpot ID : ${beforeDedup} → ${merged.length} (${dedupedCount} doublons mergés)`);

  // Counts for logs (after dedup)
  const paidOnlyCount = merged.filter((m) => m.sources.length === 1 && m.sources[0] === "paid").length;
  const outboundOnlyCount = merged.filter((m) => m.sources.length === 1 && m.sources[0] === "outbound").length;
  const bothCount = merged.filter((m) => m.sources.length === 2).length;
  console.log(
    `  Sources: paid-only=${paidOnlyCount}, outbound-only=${outboundOnlyCount}, both=${bothCount}`,
  );

  const funnel: ABXFunnel = {
    reached: merged.filter((m) => m.reached).length,
    inCRM: merged.filter((m) => m.inCRM).length,
    quoted: merged.filter((m) => m.quoted).length,
    won: merged.filter((m) => m.won).length,
    pipelineEUR: merged.reduce((s, m) => s + (m.pipelineEUR ?? 0), 0),
    revenueEUR: merged.reduce((s, m) => s + (m.revenueEUR ?? 0), 0),
    // Dépenses ABX 90j (CAMPAIGN-level, groupe ABX uniquement). FIGÉ — le ROAS
    // se calcule sur cette base, jamais sur la période sélectionnée (sinon
    // revenue 90j / spend court = ROAS aberrant, cf. weekly 04/06 + skill #29).
    spendEUR: abxSpend90j,
    // Sous-funnel influence : entrées CRM / deals créés APRÈS le lancement ABX.
    inCRMInfluenced: merged.filter((m) => m.inCRM && m.influenced).length,
    quotedInfluenced: merged.filter((m) => (m.pipelineInfluencedEUR ?? 0) > 0).length,
    wonInfluenced: merged.filter((m) => (m.revenueInfluencedEUR ?? 0) > 0).length,
    pipelineInfluencedEUR: merged.reduce((s, m) => s + (m.pipelineInfluencedEUR ?? 0), 0),
    revenueInfluencedEUR: merged.reduce((s, m) => s + (m.revenueInfluencedEUR ?? 0), 0),
    abxLaunchDate: ABX_LAUNCH_DATE,
  };

  writeJson("abx.json", {
    matches: merged,
    funnel,
    lastUpdated: new Date().toISOString(),
  } satisfies ABXData);
  console.log(
    `  ${merged.length} matches | reached=${funnel.reached} crm=${funnel.inCRM} (influencées=${funnel.inCRMInfluenced}) quoted=${funnel.quoted} won=${funnel.won}`,
  );
  console.log(
    `  Influence : pipeline=${funnel.pipelineInfluencedEUR.toFixed(0)}€ revenue=${funnel.revenueInfluencedEUR.toFixed(0)}€ | spend ABX 90j=${funnel.spendEUR.toFixed(0)}€ | ROAS=${funnel.spendEUR > 0 ? (funnel.revenueInfluencedEUR / funnel.spendEUR).toFixed(2) : "—"}×`,
  );
  console.log("=== done ===");
}

main().catch((err) => {
  console.error("ABX pipeline failed:", err);
  writeEmpty(`pipeline error: ${(err as Error).message}`);
  process.exit(0);
});
