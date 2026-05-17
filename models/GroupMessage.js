const mongoose = require("mongoose");

const groupMessageSchema = new mongoose.Schema({
  groupSlug: {
    type: String,
    required: true,
    index: true
  },
  from: {
    type: String,
    required: true
  },
  message: {
    type: String,
    default: "",
    trim: true,
    maxlength: 2000
  },
  type: {
    type: String,
    enum: ["text", "image", "video"],
    default: "text"
  },
  mediaUrl: {
    type: String,
    default: ""
  },
  replyTo: {
    type: String,
    default: null
  },
  reactions: [
    {
      emoji: String,
      usernames: [String]
    }
  ],
  edited: {
    type: Boolean,
    default: false
  },
  editedAt: {
    type: Date,
    default: null
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("GroupMessage", groupMessageSchema);

