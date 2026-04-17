# TIM Cloud - WhatsApp Bulk Messaging & Smart Inbox

![Version](https://img.shields.io/badge/version-2.0.0-emerald)
![License](https://img.shields.io/badge/license-ISC-blue)
![Platform](https://img.shields.io/badge/platform-Render-black)

TIM Cloud is a premium, high-performance WhatsApp bulk messaging tool and real-time CRM. Built with a modern tech stack and focusing on a sleek "Glassmorphism" aesthetic, it allows businesses to execute large-scale messaging campaigns and manage customer conversations through a unified Smart Inbox.

## ✨ Key Features

### 🚀 Bulk Messaging Engine
- **CSV Contact Management:** Upload thousands of contacts instantly with automatic field mapping.
- **Meta Template Integration:** Fully synchronized with your Meta Business Manager templates.
- **Dynamic Variables:** Inject custom names, dates, or custom fields directly into your WhatsApp templates.
- **Real-time Status Tracking:** Monitor broad campaigns with live progress bars and individual delivery statuses.

### 📥 Smart Inbox (CRM)
- **Real-time Conversations:** Instant two-way messaging with customers.
- **Categorized Media:** Send or receive Images, Videos, and Documents with original metadata preserved.
- **Unlimited History:** Full conversation logs stored permanently in MongoDB Atlas.
- **Smart Notifications:** Sidebar badges and browser tab alerts for unread messages.
- **Auto-Read Sync:** Intelligently clears notifications for the conversation you are actively viewing.

### 📱 Responsive Design
- **Mobile Optimized:** A master-detail layout that mimics the native WhatsApp mobile experience.
- **Modern UI:** Built with Tailwind CSS v4, Framer Motion animations, and a premium dark-mode aesthetic.

## 🛠️ Tech Stack

- **Frontend:** React 19, Vite, Tailwind CSS v4, Framer Motion, Phosphor Icons.
- **Backend:** Node.js, Express 5, JWT Authentication (bcrypt), Multer (Media handling).
- **Database:** MongoDB Atlas (Mongoose).
- **API:** Meta WhatsApp Cloud API (Graph API v21.0).
- **Tunneling:** LocalTunnel / Hookdeck for webhook reliability.

## 🚀 Getting Started

### 1. Prerequisites
- Node.js (v20 or higher)
- MongoDB Atlas account (for cloud storage)
- Meta Developer App (WhatsApp Cloud API)

### 2. Environment Configuration
Create a `.env` file in the root directory:
```env
PORT=3001
MONGODB_URI=your_mongodb_atlas_connection_string
JWT_SECRET=your_super_secret_key
ACCESS_TOKEN=temporary_or_permanent_meta_access_token
PHONE_NUMBER_ID=your_meta_phone_number_id
WABA_ID=your_meta_whatsapp_business_account_id
HOOKDECK_API_KEY=optional_for_webhook_sync
```

### 3. Installation
```bash
# Install backend dependencies
npm install

# Install frontend dependencies
cd frontend && npm install
```

### 4. Running the Application
```bash
# Run backend (from root)
npm start

# Run frontend (from /frontend)
npm run dev
```

## ☁️ Deployment (Render)

This project is optimized for deployment on **Render.com**. 
1. Use the **Node** runtime.
2. Set the `Build Command` to: `npm run build`
3. Set the `Start Command` to: `node server.js`
4. Ensure all environment variables are added to the Render "Environment" dashboard.

## 🛡️ License
Distributed under the ISC License.

---
*Built with ❤️ for High-Performance Communication.*
