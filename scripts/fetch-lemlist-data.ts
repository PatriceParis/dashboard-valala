// =============================================================
// Build-time pipeline — fetches lemlist outbound data
// Writes data/outbound.json (consumed by data-loader at SSG).
// Graceful degradation: if LEMLIST_API_KEY missing, writes empty
// shell so the build continues (the Outbound tab will show a
// placeholder).
// =============================================================

import * as dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

import { LemlistClient, LemlistApiError } from "./lemlist-client";
import { addDays, toISODate } from "../src/lib/utils";

const DATA_DIR = path.join(process.cwd(), "data");

// Outbound types kept local (mirror src/lib/types.ts)
interface OutboundDailyActivity {
  date: string;
  emailsSent: number;
  emailsOpened: number;
  emailsReplied: number;
  linkedinSent: number;
  linkedinAccepted: number;
}

interface LemlistCampaign {
  id: string;
  name: string;
  status: string;
  emailsSent: number;
  emailsOpened: number;
  emailsReplied: number;
  linkedinSent: number;
  linkedinAccepted: number;
  linkedinReplied: number;
  leadsTotal: number;
  mqlCount: number;
  sqlCount: number;
  dealCount: number;
}

interface OutboundData {
  campaigns: LemlistCampaign[];
  dailyActivity: OutboundDailyActivity[];
  lastUpdated: string;
}

function writeJson(filename: string, payload: unknown) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(payload, null, 2));
  console.log(`  wrote data/${filename}`);
}

function writeEmpty(reason: string) {
  console.warn(`[lemlist] skipped: ${reason}`);
  writeJson("outbound.json", {
    campaigns: [],
    dailyActivity: [],
    lastUpdated: new Date().toISOString(),
  } satisfies OutboundData);
}

// lemlist activity types we count:
// emailsSent: type === "emailsSent" OR "emailSent"
// emailsOpened: "emailsOpened" | "emailsOpenedFirst"
// emailsReplied: "emailsReplied" | "emailsRepliedFirst"
// linkedinSent: "linkedinSent" | "linkedinInvited"
// linkedinAccepted: "linkedinInvitedAccepted"
type NumericBucket = "emailsSent" | "emailsOpened" | "emailsReplied" | "linkedinSent" | "linkedinAccepted";

function bucketize(t: string | undefined): NumericBucket | null {
  if (!t) return null;
  const x = t.toLowerCase();
  if (x.includes("emailsent") || x === "emailssent") return "emailsSent";
  if (x.includes("emailopen") || x === "emailsopenedfirst" || x === "emailsopened") return "emailsOpened";
  if (x.includes("emailrepl") || x === "emailsrepliedfirst" || x === "emailsreplied") return "emailsReplied";
  if (x.includes("linkedinsent") || x.includes("linkedininvited")) {
    if (x.includes("accepted")) return "linkedinAccepted";
    if (x.includes("replied")) return null; // handled at campaign level only
    return "linkedinSent";
  }
  if (x === "linkedinacceptedinvited" || x === "linkedinaccepted") return "linkedinAccepted";
  return null;
}

async function main() {
  console.log("=== lemlist data fetch (Valala) ===");
  if (!process.env.LEMLIST_API_KEY) {
    writeEmpty("LEMLIST_API_KEY missing");
    return;
  }

  const client = new LemlistClient();
  const today = new Date();
  const endDate = addDays(today, -1);
  const startDate = addDays(endDate, -90);
  console.log(`Window: ${toISODate(startDate)} -> ${toISODate(endDate)}`);

  // -----------------------------------------------------------
  // Step 1 — list campaigns
  // -----------------------------------------------------------
  console.log("[1/3] campaigns");
  let raw: Array<{ _id: string; name: string; status?: string }> = [];
  try {
    const list = (await client.getCampaigns()) as
      | Array<{ _id: string; name: string; status?: string }>
      | { campaigns?: Array<{ _id: string; name: string; status?: string }> };
    raw = Array.isArray(list) ? list : (list.campaigns ?? []);
    console.log(`  ${raw.length} campaigns`);
  } catch (err) {
    if (err instanceof LemlistApiError) {
      console.warn(`  campaigns fetch failed: ${err.status}`);
    } else {
      console.warn(`  campaigns fetch failed:`, (err as Error).message);
    }
    writeEmpty("campaigns endpoint failed");
    return;
  }

  // -----------------------------------------------------------
  // Step 2 — stats per campaign
  // -----------------------------------------------------------
  console.log("[2/3] campaign stats");
  const campaigns: LemlistCampaign[] = [];
  const startISO = toISODate(startDate);
  const endISO = toISODate(endDate);
  // ⚠️ REST v2 stats response shape (verified via curl, 2026-05-29) :
  // ATTENTION : la réponse REST BRUTE est différente de celle exposée par le
  // MCP lemlist `get_campaigns_stats` (qui re-structure en `messageMetrics`/
  // `leadMetrics`/`channelMetrics`). Le REST direct retourne tout à plat avec
  // un préfixe `nb*` pour les lead-counters :
  //   nbLeads, nbLeadsLaunched, nbLeadsReached, nbLeadsOpened,
  //   nbLeadsInteracted, nbLeadsAnswered, nbLeadsInterested,
  //   nbLeadsNotInterested, nbLeadsUnsubscribed, nbLeadsInterrupted,
  //   messagesSent, messagesNotSent, messagesBounced,
  //   delivered, opened, clicked, replied,
  //   invitationAccepted, meetingBooked,
  //   perChannel: {
  //     email:    { sent, delivered, opened, clicked, replied, bounced, unsubscribed },
  //     linkedin: { sent, delivered, opened, replied, invitationAccepted }
  //   }
  interface PerChannelEmail { sent?: number; opened?: number; replied?: number; bounced?: number }
  interface PerChannelLinkedIn { sent?: number; replied?: number; invitationAccepted?: number }
  interface V2Stats {
    nbLeads?: number;
    nbLeadsReached?: number;
    nbLeadsAnswered?: number;
    nbLeadsInterested?: number;
    messagesSent?: number;
    opened?: number;
    replied?: number;
    invitationAccepted?: number;
    meetingBooked?: number;
    perChannel?: { email?: PerChannelEmail; linkedin?: PerChannelLinkedIn };
  }
  for (const c of raw) {
    try {
      const stats = (await client.getCampaignStats(c._id, startISO, endISO)) as V2Stats;
      const num = (v: unknown) =>
        typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) || 0 : 0;
      const email = stats.perChannel?.email ?? {};
      const linkedin = stats.perChannel?.linkedin ?? {};
      campaigns.push({
        id: c._id,
        name: c.name,
        status: c.status ?? "running",
        emailsSent: num(email.sent),
        emailsOpened: num(email.opened),
        emailsReplied: num(email.replied),
        linkedinSent: num(linkedin.sent),
        linkedinAccepted: num(linkedin.invitationAccepted ?? stats.invitationAccepted),
        linkedinReplied: num(linkedin.replied),
        leadsTotal: num(stats.nbLeads),
        // MQL proxy = leads ayant explicitement répondu "intéressé"
        mqlCount: num(stats.nbLeadsInterested),
        // SQL proxy = leads ayant répondu au moins une fois
        sqlCount: num(stats.nbLeadsAnswered),
        // Deal proxy = rendez-vous pris
        dealCount: num(stats.meetingBooked),
      });
    } catch (err) {
      console.warn(`  stats failed for ${c._id}:`, (err as Error).message);
    }
  }

  // -----------------------------------------------------------
  // Step 3 — daily activity (90j)
  // -----------------------------------------------------------
  console.log("[3/3] daily activity");
  const daily = new Map<string, OutboundDailyActivity>();
  // Single global pull (no per-campaign loop to limit API cost)
  let after: string | undefined;
  let totalActivities = 0;
  try {
    for (let page = 0; page < 50; page++) {
      const res = (await client.getActivities({
        startDate: toISODate(startDate),
        endDate: toISODate(endDate),
        limit: 100,
        after,
      })) as
        | Array<{ type?: string; date?: string; createdAt?: string; _id?: string }>
        | { activities?: Array<{ type?: string; date?: string; createdAt?: string; _id?: string }>; nextCursor?: string };

      const items = Array.isArray(res) ? res : (res.activities ?? []);
      if (items.length === 0) break;
      for (const a of items) {
        const iso = (a.date ?? a.createdAt ?? "").slice(0, 10);
        if (!iso) continue;
        const bucket = bucketize(a.type);
        if (!bucket) continue;
        const cur: OutboundDailyActivity =
          daily.get(iso) ?? {
            date: iso,
            emailsSent: 0,
            emailsOpened: 0,
            emailsReplied: 0,
            linkedinSent: 0,
            linkedinAccepted: 0,
          };
        cur[bucket] += 1;
        daily.set(iso, cur);
        totalActivities++;
      }
      const next = Array.isArray(res) ? items[items.length - 1]?._id : res.nextCursor;
      if (!next || next === after) break;
      after = next;
    }
  } catch (err) {
    console.warn(`  activities fetch failed:`, (err as Error).message);
  }

  const dailyActivity = Array.from(daily.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  writeJson("outbound.json", {
    campaigns,
    dailyActivity,
    lastUpdated: new Date().toISOString(),
  } satisfies OutboundData);
  console.log(`  ${campaigns.length} campaigns, ${dailyActivity.length} days, ${totalActivities} activities`);
  console.log("=== done ===");
}

main().catch((err) => {
  console.error("lemlist pipeline failed:", err);
  // Still write empty to keep the build going
  writeEmpty(`pipeline error: ${(err as Error).message}`);
  process.exit(0);
});
