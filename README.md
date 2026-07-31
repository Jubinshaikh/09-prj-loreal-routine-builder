# Project 9: L'Oréal Routine Builder
 
A product-aware beauty advisor built with vanilla HTML, CSS, and JavaScript.
Users browse real L'Oréal brand products, select the ones they own or want,
generate a personalized routine with AI, and ask follow-up questions that stay
grounded in their selections.
 
**Live demo:** https://jubinshaikh.github.io/09-prj-loreal-routine-builder/
 
## Features
 
- Product grid loaded from a local `products.json` catalog
- Category dropdown and live keyword search across name, brand, category, and
  description
- Click or keyboard select any product card, with a visible selected state and
  `aria-pressed` for screen readers
- Expandable per-product description without triggering selection
- Selected Products panel with individual remove buttons and Clear All
- Selections persist across page reloads via `localStorage`
- Generate Routine sends the full selected-product JSON to the model and
  returns a structured Morning / Evening / Tips routine
- Follow-up chat retains conversation history and the generated routine as
  context on every turn
- Optional web search for time-sensitive questions, with clickable source
  citations
- RTL layout toggle with a persisted preference
- OpenAI API key never reaches the browser — all requests proxy through a
  Cloudflare Worker
## Architecture
 
```
Browser (GitHub Pages)
  → POST { requestType, selectedProducts, generatedRoutine, conversationHistory }
      → Cloudflare Worker (loreal-routine-worker)
          → builds system prompt + product grounding, injects API key
          → POST → OpenAI /v1/chat/completions
          →   or → OpenAI /v1/responses with web_search, when enabled
      ← { message, sources, model }
```
 
The system prompt and product grounding are built in the Worker, not in
`script.js`. Anything in the frontend is readable and editable by anyone
visiting the site.
 
## Files
 
| File | Purpose |
| --- | --- |
| `index.html` | Page structure, filters, product grid, chat markup |
| `style.css` | Design system, layout, RTL rules |
| `script.js` | Product rendering, selection state, chat logic |
| `products.json` | 35-product catalog with brand, category, image, description |
| `worker/index.js` | Cloudflare Worker source — the deployed backend |
| `wrangler.toml` | Worker name, entry point, and non-secret variables |
 
## Run locally
 
1. Open this repo in GitHub Codespaces.
2. Open `index.html` with Live Preview.
The frontend calls the deployed Worker directly, so no local backend is needed.
 
## Cloudflare Worker setup
 
Configure these under **Settings → Variables and Secrets**:
 
| Name | Type | Value |
| --- | --- | --- |
| `OPENAI_API_KEY` | Secret | Your OpenAI API key |
| `MODEL` | Variable | `gpt-4.1-mini` |
| `ALLOWED_ORIGIN` | Variable | `https://jubinshaikh.github.io` |
| `ENABLE_WEB_SEARCH` | Variable | `true` or `false` |
 
`ALLOWED_ORIGIN` must have no trailing slash and no repository path. Requests
from a different browser origin are rejected with 403. Requests with no
`Origin` header, such as curl, are allowed so the endpoint stays testable.
 
Deploy either by pasting `worker/index.js` into the Cloudflare dashboard editor
and clicking **Deploy**, or with Wrangler:
 
```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler deploy
```
 
Then set `WORKER_URL` at the top of `script.js` to the deployed endpoint.
Whenever the Worker changes, update both the dashboard and `worker/index.js` so
the repo stays accurate.
 
### Cost controls
 
The Worker runs under a dedicated OpenAI project with a spend limit and a model
allowlist, so a leaked Worker URL cannot run up an unbounded bill.
`ENABLE_WEB_SEARCH` defaults to `false` because search-backed calls are billed
per invocation on top of normal token cost.
 
## Request and response shape
 
Frontend sends:
 
```json
{
  "requestType": "routine",
  "selectedProducts": [
    {
      "name": "Foaming Facial Cleanser",
      "brand": "CeraVe",
      "category": "cleanser",
      "description": "Gentle gel cleanser with ceramides..."
    }
  ],
  "generatedRoutine": "",
  "conversationHistory": [
    { "role": "user", "content": "Generate a personalized beauty routine." }
  ]
}
```
 
`requestType` is `routine` for the Generate Routine button and `followup` for
chat turns. Only `user` and `assistant` roles are accepted in
`conversationHistory`; the Worker discards anything else and keeps the 20 most
recent messages.
 
Worker returns:
 
```json
{
  "message": "Morning: ...",
  "sources": [{ "title": "...", "url": "https://..." }],
  "selectedCount": 1,
  "usedWebSearch": false,
  "model": "gpt-4.1-mini"
}
```
 
On failure it returns a non-2xx status with `{ error, details }`, which the
frontend surfaces in the chat window.
 
## Testing the Worker
 
```bash
# Should return a routine
curl -s -X POST https://quiet-unit-fe62.shaikhjn.workers.dev/api/chat \
  -H "Content-Type: application/json" \
  -d '{"requestType":"routine","selectedProducts":[{"name":"Foaming Facial Cleanser","brand":"CeraVe","category":"cleanser","description":"Gentle gel cleanser."}],"generatedRoutine":"","conversationHistory":[{"role":"user","content":"Build my routine."}]}'
 
# Should return 403 Origin not allowed
curl -s -X POST https://quiet-unit-fe62.shaikhjn.workers.dev/api/chat \
  -H "Content-Type: application/json" \
  -H "Origin: https://example.com" \
  -d '{"requestType":"routine","selectedProducts":[{"name":"x"}],"conversationHistory":[{"role":"user","content":"hi"}]}'
```
 
## Troubleshooting
 
| Symptom | Cause |
| --- | --- |
| `invalid_api_key` | Wrong or rotated key in the Worker secret |
| `insufficient_quota` | No credits on the OpenAI account |
| `model_not_found` | `MODEL` not available to your account |
| `403 Origin not allowed` | `ALLOWED_ORIGIN` does not match the site origin |
| `400 At least one selected product is required` | Nothing selected in the grid |
| Empty reply, `finish_reason: length` | Raise `max_completion_tokens` |
| No citations on search questions | `ENABLE_WEB_SEARCH` is not `true` |
| Site shows old code | GitHub Pages cache — hard refresh with Ctrl+Shift+R |
 
## Notes
 
Follow-up questions require a routine to be generated first, so the assistant
always has product context before answering. Product images are served from a
CDN and are not stored in this repo.
