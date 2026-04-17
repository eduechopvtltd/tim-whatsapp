const mongoose = require('mongoose');

// User Schema: For multi-user authentication and per-user credentials
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    config: {
        phoneId: { type: String, default: '' },
        wabaId: { type: String, default: '' },
        token: { type: String, default: '' },
        appId: { type: String, default: '' },
        verifyToken: { type: String, default: 'my_secret_token' }
    },
    hookdeck: {
        destinationId: { type: String, default: '' },
        sourceUrl: { type: String, default: '' }
    }
}, { timestamps: true });

// Chat Schema: Stores the message history for each user's customers
const ChatSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    phone: { type: String, required: true },
    name: { type: String },
    messages: [{
        from: String,
        text: String,
        timestamp: String,
        type: { type: String, default: 'text' },
        status: { type: String }
    }],
    unreadCount: { type: Number, default: 0 }
}, { timestamps: true });

// Ensure a phone number is unique ONLY within a specific user's scope
ChatSchema.index({ userId: 1, phone: 1 }, { unique: true });

// Campaign Schema: Stores history of bulk messaging campaigns per user
const CampaignSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    id: { type: Number, required: true },
    name: { type: String, required: true },
    status: { type: String, default: 'Running' },
    totalContacts: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    results: [{
        phone: String,
        name: String,
        status: String,
        error: String,
        wamid: String,
        timestamp: { type: Date, default: Date.now }
    }],
    timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

// Campaign IDs only need to be unique for a single user
CampaignSchema.index({ userId: 1, id: 1 }, { unique: true });

// Global State Schema: For single-object caches per user (mediaCache, wamid maps, etc.)
const GlobalStateSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    key: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} }
});

GlobalStateSchema.index({ userId: 1, key: 1 }, { unique: true });

// WamidMapping: Maps Meta Message IDs to campaigns for persistent status tracking
const WamidMappingSchema = new mongoose.Schema({
    wamid: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    jobId: { type: String, required: true },
    phone: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: '48h' } // Auto-delete after 48 hours
});

WamidMappingSchema.index({ wamid: 1 });

module.exports = {
    User: mongoose.model('User', UserSchema),
    Chat: mongoose.model('Chat', ChatSchema),
    Campaign: mongoose.model('Campaign', CampaignSchema),
    GlobalState: mongoose.model('GlobalState', GlobalStateSchema),
    WamidMapping: mongoose.model('WamidMapping', WamidMappingSchema)
};
