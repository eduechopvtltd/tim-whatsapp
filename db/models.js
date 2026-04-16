const mongoose = require('mongoose');

// Chat Schema: Stores the message history for each customer
const ChatSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    name: { type: String },
    messages: [{
        from: String,
        text: String,
        timestamp: String,
        type: { type: String, default: 'text' },
        status: { type: String }
    }]
}, { timestamps: true });

// Campaign Schema: Stores history of bulk messaging campaigns
const CampaignSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    status: { type: String, default: 'Running' },
    totalContacts: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

// Global State Schema: For single-object caches like mediaCache, sentHistory, etc.
const GlobalStateSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} }
});

module.exports = {
    Chat: mongoose.model('Chat', ChatSchema),
    Campaign: mongoose.model('Campaign', CampaignSchema),
    GlobalState: mongoose.model('GlobalState', GlobalStateSchema)
};
