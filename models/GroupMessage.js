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
    required: true,
    trim: true,
    maxlength: 2000
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("GroupMessage", groupMessageSchema);
