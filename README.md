# Dashboard Valala

Reporting client **Valala** — LinkedIn Ads en V1, lemlist outbound en V2, HubSpot ABX matching en V3.

Dashboard Next.js 16 / React 19 / Tailwind v4 / Recharts. Données fetchées au build time depuis l'API LinkedIn Marketing, déployé sur Vercel.

## Stack

- Next.js 16 (App Router, SSG)
- TypeScript strict
- Tailwind CSS 4 + Lucide React
- Recharts (graphes)
- Build-time fetch → JSON dans `data/` → SSG

## Périmètre V1

- 7 KPIs LinkedIn Ads (Dépenses, Impressions, CPM, CTR, Clics, Actions sociales, Leads) avec delta période précédente
- Tableau campagnes triable (filtre par groupe de campagnes)
- Graphique impressions/clics (Recharts)
- Sélecteur de période (custom dates)

**Pas dans la V1** : galerie créatives, page Entreprises, page Liens Ads, outbound, ABX matching.

## Commandes

```bash
npm install
npm run fetch-data      # fetch LinkedIn → data/*.json
npm run dev             # dev server
npm run build           # build local
npm run vercel-build    # fetch + build (utilisé par Vercel)
npm run refresh-token   # renouvelle l'access token via refresh_token
```

## Variables d'environnement

À copier dans **Vercel → Settings → Environment Variables** (Production + Preview) :

| Variable | Description |
|---|---|
| `LINKEDIN_CLIENT_ID` | App LinkedIn Developer |
| `LINKEDIN_CLIENT_SECRET` | App LinkedIn Developer |
| `LINKEDIN_ACCESS_TOKEN` | OAuth bearer (~60 j) |
| `LINKEDIN_REFRESH_TOKEN` | OAuth refresh (~1 an) |
| `LINKEDIN_TOKEN_EXPIRES_AT` | ISO date d'expiration |
| `LINKEDIN_AD_ACCOUNT_ID` | ID compte publicitaire |
| `LINKEDIN_ORG_ID` | ID organisation LinkedIn |
| `LINKEDIN_API_VERSION` | `202509` |

Voir `.env.example` pour le template.

## Maintenance du token

Tous les ~60 jours :

```bash
npm run refresh-token
# Puis mettre à jour LINKEDIN_ACCESS_TOKEN dans Vercel et redeploy
```

## Roadmap

- **V1** ✅ — Socle LinkedIn Ads (cf. réf CyberVadis)
- **V2** ⬜ — Onglet Outbound (lemlist MCP/API)
- **V3** ⬜ — Onglet ABX (matching LinkedIn ↔ lemlist ↔ HubSpot)

Référence : `abx-system/rag-abx/dashboards/DASHBOARD-CYBERVADIS-GUIDE.md` (socle) + `DASHBOARD-AUUM-GUIDE.md` (multi-source).
