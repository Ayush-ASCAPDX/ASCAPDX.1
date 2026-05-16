const mongoose = require("mongoose");

const StorySchema = new mongoose.Schema({
  username: { type: String, required: true },
  author: { type: String },
  avatarUrl: { type: String },
  mediaUrl: { type: String, required: true },
  mediaType: { type: String, enum: ["image", "video"], default: "image" },
  caption: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
    index: { expires: 0 } // Document expires at 'expiresAt' timestamp
  }
});

// Index to quickly fetch active stories grouped by user, sorting by createdAt
StorySchema.index({ username: 1, createdAt: 1 });

module.exports = mongoose.model("Story", StorySchema);
