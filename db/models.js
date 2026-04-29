const mongoose = require('mongoose');

// User Schema: For multi-user authentication and per-user credentials
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
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
    },
    emailConfig: {
        enabled: { type: Boolean, default: false },
        smtpHost: { type: String, default: '' },
        smtpPort: { type: Number, default: 587 },
        smtpUser: { type: String, default: '' },
        smtpPass: { type: String, default: '' },
        notifyEmail: { type: String, default: '' }
    }
}, { timestamps: true });

// Chat Schema: Stores the message history for each user's customers
const ChatSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    phone: { type: String, required: true },
    name: { type: String },
    lastMessageAt: { type: Date, default: Date.now },
    messages: [{
        id: String, // WhatsApp Message ID (WAMID) for deduplication
        from: String,
        text: String,
        timestamp: String,
        type: { type: String, default: 'text' },
        status: { type: String },
        mediaId: { type: String },
        filename: { type: String }
    }],
    unreadCount: { type: Number, default: 0 }
}, { timestamps: true });

// Ensure a phone number is unique ONLY within a specific user's scope
ChatSchema.index({ userId: 1, phone: 1 }, { unique: true });

// Campaign Schema: Stores history and state of bulk messaging campaigns per user
const CampaignSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    id: { type: mongoose.Schema.Types.Mixed, required: true },
    name: { type: String, required: true },
    status: { type: String, default: 'Running' }, // Running, Paused, Completed, Stopped, Error
    
    // Config used for this campaign (Resilience)
    config: {
        phoneId: String,
        token: String,
        wabaId: String
    },
    
    // Inputs for Resume capability
    messageType: String, // template, text
    templateName: String,
    templateParams: mongoose.Schema.Types.Mixed,
    customMessage: String,
    mapping: mongoose.Schema.Types.Mixed,
    contacts: [mongoose.Schema.Types.Mixed], // Raw contacts data
    allowDuplicates: { type: Boolean, default: false },
    
    // Analytics/Progress
    totalContacts: { type: Number, default: 0 },
    processed: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    read: { type: Number, default: 0 },
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

// CampaignResult Schema: Individual message results for a campaign (High Performance)
const CampaignResultSchema = new mongoose.Schema({
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    jobId: { type: String, required: true },
    phone: { type: String, required: true },
    name: { type: String },
    status: { type: String, default: 'Pending' },
    error: { type: String },
    wamid: { type: String },
    timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

CampaignResultSchema.index({ campaignId: 1 });
CampaignResultSchema.index({ userId: 1, jobId: 1, phone: 1 });
CampaignResultSchema.index({ wamid: 1 });

// CampaignContact Schema: Raw contact data for a campaign (Large Dataset Support)
const CampaignContactSchema = new mongoose.Schema({
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    phone: { type: String, required: true },
    index: { type: Number, required: true }
});

CampaignContactSchema.index({ campaignId: 1, index: 1 });

module.exports = {
    User: mongoose.model('User', UserSchema),
    Chat: mongoose.model('Chat', ChatSchema),
    Campaign: mongoose.model('Campaign', CampaignSchema),
    CampaignResult: mongoose.model('CampaignResult', CampaignResultSchema),
    CampaignContact: mongoose.model('CampaignContact', CampaignContactSchema),
    GlobalState: mongoose.model('GlobalState', GlobalStateSchema),
    WamidMapping: mongoose.model('WamidMapping', WamidMappingSchema)
};
