# Project Memory: WhatsApp Bulk Messaging CRM 🚀

This document serves as the "Source of Truth" for the WhatsApp Bulk Messaging tool. It documents the architecture, key features, and critical implementation details for the production-grade cloud setup.

## 🏗️ Architecture Overview (Cloud Edition)

- **Frontend**: React (Vite) + Tailwind CSS + Framer Motion. 
- **Backend**: Node.js/Express (Unified Hub).
- **Database**: **MongoDB Atlas** (Cloud Persistence).
- **Deployment**: **Render.com** (Free Tier Web Service).
- **Webhooks**: Hookdeck (Static Bridge) + LocalTunnel (Local Dev Only).

---

## 💾 Persistent Data Layer (MongoDB)
*Migrated from local JSON to Cloud in April 2026*

1.  **Chat Collection**: Permanent history for all conversations (replies and incoming).
2.  **Campaign Collection**: Detailed logs of every bulk send, statuses, and performance.
3.  **GlobalState Collection**: Internal system states (Media Cache, Sent History, WAMID maps).

---

## 🌟 Key Features & Production Updates

### 1. 🔗 Unified "One-Link" Deployment
The Frontend and Backend are now bundled together. 
- **Production URL**: `https://[your-app].onrender.com` opens the full dashboard directly.
- **Smart Static Serving**: Node.js serves the built Vite `dist` folder automatically in production.

### 2. 🌩️ Cloud-Smart Webhook Bridge
- **Auto-Handshake**: The backend automatically communicates with **Hookdeck** to update its destination URL.
- **Environment Detection**: The system intelligently skips LocalTunnel when running in the cloud to prevent deployment crashes.
- **Permanent Meta Link**: Meta Developer Portal points to a static Hookdeck URL, meaning webhooks NEVER break even when the server restarts.

### 3. 🛡️ Advanced Security & Persistence
- **Zero-Config Persistence**: Removing local JSON dependencies ensures that all data (chats/campaigns) survives Render’s daily restarts and sleeps.
- **Environment Security**: Sensitive tokens are managed via Render Environment Variables, with a strict `.gitignore` preventing accidental leaks to GitHub.

### 4. ⚙️ Universal Template & Automation
- **Rate Limit Management**: Fixed delays (250-500ms) and automatic retry logic for Meta Graph API.
- **Status Sync**: Webhooks update MongoDB in real-time to show Sent/Delivered/Read statuses in the dashboard.

---

## 📜 History of Major Changes
- **2026-04-07**: Initial production hardening; state persistence implemented.
- **2026-04-15**: **Self-Healing Bridge** added; Hookdeck automation finalized.
- **2026-04-16**: **Cloud Migration Complete**; MongoDB Atlas integrated, Unified Deployment live on Render.

## ⚠️ Critical Deployment Rules
1.  **Build Workflow**: On Render, always set **Build Command** to `npm run build` and **Start Command** to `npm start`.
2.  **MongoDB URI**: Ensure the connection string in `.env` has special characters (like `@`) URL-encoded (e.g., `%40`).
3.  **Relative API Pathing**: Frontend `App.jsx` must use a dynamic `API_BASE` that detects the origin to prevent CORS/404 errors.
