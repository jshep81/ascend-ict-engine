# Ascend ICT Script Engine — Netlify Deploy

Live scripting and note-taking engine for the Ascend Group inside conversion team. Static single-page web app + a Netlify Function for the AI module.

## FUB Embedded App setup (recommended workflow)

Wire the engine into FUB so it loads inside the lead detail view with the lead pre-loaded. No queue clicks, no URL pasting.

1. In FUB → **Admin → Apps & Integrations → Embedded Apps → Add Embedded App**.
2. Name: `Ascend ICT Engine`.
3. URL: `https://conversionengine.netlify.app/?personId={person_id}&firstName={person_first_name}&lastName={person_last_name}&phone={person_phone}&email={person_email}`
   (FUB substitutes the merge tags with the loaded lead's data automatically.)
4. Display location: Lead detail page (sidebar or full panel — your choice).
5. Save.

When a rep opens any lead in FUB, the engine loads in an iframe with the lead's `personId` in the URL. The engine auto-fetches full FUB context (notes, activities, assigned agent), populates the Now Calling banner, fires the Pre-Call Brief, and is ready to dial.

A **↗ Pop Out** button appears in the header when running inside FUB — click to open the engine full-screen in a new tab with the lead still loaded.

## OpenAI key for Dictate Notes

The Dictate feature uses OpenAI Whisper for transcription. Add to Netlify env vars:

| Variable | Value |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key from `platform.openai.com/api-keys` |
| `WHISPER_MODEL` (optional) | Defaults to `whisper-1` |

Cost: ~$0.006/minute. 50 dictations × 60s × 22 days ≈ $7/month.

## AI module setup (one-time)

The engine includes a floating "Ask AI" assistant powered by Claude Haiku via the Anthropic API. To enable it on your Netlify deployment:

1. Go to your Netlify site dashboard → **Site settings → Environment variables**.
2. Add these environment variables:

   | Variable | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | Your Anthropic API key (starts with `sk-ant-...`) |
   | `ASCEND_AI_SECRET` | A long random string. Default in code is `ascend-ict-default-secret-please-rotate` — rotate this. |
   | `AI_MODEL` (optional) | Defaults to `claude-haiku-4-5-20251001`. Use `claude-sonnet-4-6` for higher quality on tour briefs. |
   | `AI_MAX_TOKENS` (optional) | Defaults to `1024`. |

3. Trigger a redeploy (Site settings → Deploys → Trigger deploy → Clear cache and deploy site) so the function picks up the env vars.

4. The shared secret in `index.html` (`ASCEND_AI_SECRET` constant near the bottom of the script block) must match the env var. If you rotate the env var, update the constant and redeploy.

5. Set Anthropic billing alerts at $25 / $50 / $100 thresholds in the Anthropic console.

Test: open the engine, click the "Ask AI" floating button bottom-right, send a message. If the env vars aren't set, you'll see a clear error message in the chat.

### What the AI module does

- **Objection help** — describe what the prospect just said, get a recovery script in Ascend voice
- **Polish notes** — rewrite raw call notes into structured FUB format
- **Tour brief** — generate a 4-5 line pre-tour brief for the assigned agent
- **Confirm text** — draft the confirmation text to send the prospect after booking
- **Free chat** — ask anything; the AI sees the current call context (motivation, neighborhood, DNS, etc.)

Cost: Haiku is roughly $0.001 per typical exchange. Heavy team use of 200 questions/day costs around $0.20/day or $6/month.

## FUB task auto-create

The DNS panel can create the task directly in FUB via the FUB API.

1. In FUB → My Settings → API → **Create API Key**. Name it `Ascend ICT Engine`. Copy.
2. In Netlify → Environment variables → add `FUB_API_KEY` with the value, all scopes.
3. Trigger a redeploy.
4. In the engine, paste the FUB lead URL into the new "FUB Lead URL or ID" field at the top.
5. Fill in the DNS action / date / time / owner.
6. Click "✦ Create Task in FUB" — confirms with task ID on success.

The function is at `/api/fub-task` (proxied to `/.netlify/functions/fub-task`). Auth uses the same `ASCEND_AI_SECRET` shared secret.

## FUB Smart List queue + Open in FUB

The engine can pull a smart list from FUB and let the rep work through it sequentially.

1. Click the **Lead Queue** button in the header.
2. Click **Refresh** to load your smart lists from FUB.
3. Pick a smart list from the dropdown — leads load in seconds.
4. Click any lead — engine populates the FUB Lead URL automatically.
5. Click the **Open in FUB →** button next to the FUB Lead URL field — opens that lead in FUB in a new tab.
6. Click the phone number in FUB to dial via your integrated dialer.
7. Take notes / fill DNS / book the tour in the engine.
8. When done, click **Next →** in the queue panel to advance to the next lead.

The smart list endpoint is `/api/fub-smartlist`. Same FUB API key, same shared secret.

## FUB note + stage auto-write

Two more endpoints close the FUB loop. No new env vars — both reuse `FUB_API_KEY` and `ASCEND_AI_SECRET`.

**Send to FUB button** (top right, next to Copy FUB note): pushes the formatted call note directly to that lead's notes section in FUB. The note appears with the date as the subject. Function: `/api/fub-note`.

**Auto-stage update**: any time the rep changes the Lead Stage selector (in the lead-info bar OR via the wrap-stage button row), the stage update PUTs to FUB on that person's record. A toast confirms "FUB stage → [stage]" on success. Function: `/api/fub-stage`.

After this push, the rep doesn't need to open FUB at all post-call — task, note, and stage all auto-write.

## What's new in v3

- 14-objection branching tree triggered when prospect resists at booking
- 200+ Central TX neighborhood index (Austin, San Antonio, Williamson, Hays, Comal, Bastrop, Burnet, Bell)
- FUB appointment form embedded at booking stage (real FUB types and outcomes)
- FUB lead stage selector at wrap (Met with customer, Showing homes, Nurture, Trash, etc.)
- FUB tag suggestion system with branch logic (Appointment Set, Pre-Approved, Needs Lender, Investor, Relocator, Spouse Decision, NOTEXT, market/city/county tags from neighborhood, source tags from Zillow/Realtor/etc.)
- Action-driving FUB note template — TL;DR up top, decider, next steps, watch-outs, confidence rating
- Money-quote and decider-dynamics capture during call

## What's in this folder

```
index.html        The script engine. Self-contained, no external dependencies.
netlify.toml      Netlify config: security headers, iframe permissions, caching.
_headers          Fallback header config (mirror of netlify.toml).
README.md         This file.
```

## Deploy in 60 seconds (drag and drop)

1. Open `app.netlify.com/drop` in a browser.
2. Drag this entire `netlify-deploy` folder onto the page.
3. Netlify gives you a random URL like `https://random-name-12345.netlify.app`. Site is live.
4. (Optional) Rename the site under Site settings → Change site name to something like `ascend-ict.netlify.app`.

That's it. Headers, redirects, and caching are configured automatically from `netlify.toml`.

## Deploy via Git (recommended for ongoing changes)

1. Create a new repo on GitHub (private). Push the contents of this folder to it.
2. In Netlify: **Add new site → Import from Git**. Pick the repo. Build command: leave blank. Publish directory: `.`
3. Netlify auto-deploys on every push to `main`.
4. (Optional) Set a custom domain like `ict.theagencytexas.com` in Site settings → Domain management.

## What works today

- Open the URL in any browser. The full 9-stage qualification flow runs end to end.
- Lead state persists in browser localStorage. A refresh does not lose the call.
- "Copy lead summary" button writes a clean call recap to clipboard. Paste into FUB notes.
- Type or pick a neighborhood — Spanish Oaks, Westlake, Mueller, Circle C, Steiner, Lakeway, Barton Creek, Tarrytown, East Austin (78702), Cedar Park, Round Rock, Dripping Springs, Buda/Kyle, Pflugerville. Any neighborhood not in the database can be entered as free text.

## Phase 2: embedding inside Follow Up Boss

The CSP header in `netlify.toml` already permits embedding from `app.followupboss.com` and any FUB subdomain. To finish the FUB integration we still need to:

1. Confirm your FUB tier supports custom embedded apps.
2. Register this URL as a FUB iframe app.
3. Add JS in `index.html` to read lead context from FUB on load (name, phone, source, area of interest, tags) so the rep doesn't type anything.
4. Add a write-back hook so the call summary posts to FUB notes via the FUB API on call wrap.

That's a real but contained piece of work. Tell me your FUB tier and which dialer the team uses and I'll scope it.

## Updating the script flow or neighborhood data

Both live inside `index.html`:

- **Script stages** are in the `STAGES` array. Each stage has the verbatim script, branch buttons, and objection responses. Edit text directly.
- **Neighborhoods** are in the `NEIGHBORHOODS` object. Add a new neighborhood by copying an existing block and changing the values. The MOI and DOM fields are placeholders — refresh from MLS monthly.
- **Agent assignment guide** is in the `ASSIGNMENT_GUIDE` array. Edit to match your actual team coverage.

Save the file, push to Git (or drag-drop again), Netlify republishes. Cached HTML is set to `no-cache` so updates are immediate for your reps.

## Costs

Netlify free tier covers this comfortably: 100GB bandwidth, 300 build minutes, custom domain, automatic SSL. No reason to upgrade unless traffic explodes.

## What this engine does NOT do (yet)

- Auto-launch on dialer call connect (depends on dialer integration)
- Auto-pull lead context from FUB (Phase 2)
- Auto-write summary back to FUB notes (Phase 2)
- Multi-user shared call state (each rep's browser holds its own state — this is the right behavior anyway)

## Support / changes

Edits to script copy, new neighborhoods, new branches: edit `index.html` directly.
Bigger changes (FUB integration, dialer hooks, multi-user state): need a real conversation about scope and tradeoffs.
