# Project Memory: WhatsApp Bulk Messaging CRM 🚀

This document serves as the "Source of Truth" for the WhatsApp Bulk Messaging tool. It documents the architecture, key features, and critical implementation details to ensure consistency during future updates.

## 🏗️ Architecture Overview

- **Frontend**: React (Vite) with Tailwind CSS.
- **Backend**: Node.js/Express.
- **API**: Meta WhatsApp Cloud API (v21.0).
- **Persistence**: File-based storage (JSON) for local-first reliability.

### 💾 Persistent Files
- `.env`: Meta credentials and server port.
- `campaign_history.json`: Log of all past campaigns.
- `active_jobs.json`: Current state of running/paused jobs (used for recovery).
- `sent_history.json`: Duplicate check history.
- `media_cache.json`: Cached Meta media IDs (1-hour TTL).

---

## 🌟 Key Features & Updates

### 1. ⚙️ Universal Template Engine
The app handles complex Meta templates dynamically:
- **Headers**: Support for `IMAGE`, `VIDEO`, `DOCUMENT`, and `TEXT` types.
- **Media Mapping**: Automatically pulls media URLs from CSV columns if mapped.
- **Flow Buttons**: Automatic `flow_token` generation for Meta Flow components.
- **Dynamic URL Buttons**: Map URL suffixes (like discount codes) directly from CSV.

### 2. 🛡️ Production Hardening
- **State Recovery**: If the server restarts, any "Running" campaign is recovered as "Paused (Server Restart)," allowing it to be resumed without losing progress.
- **Ethical Throttling**: 250ms–500ms delay between messages to stay compliant with Meta's rate limits and maintain account health.
- **Error Mapping**: Deciphers cryptic Meta error codes into user-friendly messages (e.g., "Payment Method Required 💳").
- **Automatic Phone Cleanup**: Ensures 10-digit numbers are prefixed with the correct country code (defaulting to `91` for India, but intelligently handling regional formats).

### 3. 🖥️ Direct Configuration UI
Users can update their `WABA ID`, `Phone ID`, and `Access Token` directly from the **Configuration** tab. 
- **Sync Logic**: Updates `process.env` immediately and persists to the `.env` file.
- **Cache Clearing**: Syncing new credentials automatically flushes the template cache to ensure the next fetch is fresh.

---

## ⚠️ Critical Implementation Rules
*For future AI assistants or developers:*

1.  **Frontend API Pathing**: Always use the `API_BASE` constant (`http://localhost:3001`) in `App.jsx` to avoid Vite proxy 404s.
2.  **Object Clearing**: When clearing the `jobs` object, always use `Object.keys(jobs).forEach(key => delete jobs[key])` because it is declared as a `const`.
3.  **Multer Configuration**: Never delete the `const upload = multer({ dest: 'uploads/' });` line; it's required for CSV uploads.
4.  **Static Templates**: Ensure the `components` array is always included in the payload, even for static templates, to prevent Meta delivery failures.

## 📜 History of Major Changes
- **2026-04-07**: Initial production hardening; state persistence implemented.
- **2026-04-08**: Universal Template Engine finalized; support for Media and Flows added.
- **2026-04-09**: Direct Configuration UI added; Settings sync completed.
