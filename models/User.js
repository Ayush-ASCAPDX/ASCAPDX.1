const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    unique: true,
    required: true,
    trim: true,
    lowercase: true
  },
  name: {
    type: String,
    default: "",
    trim: true
  },
  bio: {
    type: String,
    default: "",
    trim: true,
    maxlength: 280
  },
  avatarUrl: {
    type: String,
    default: ""
  },
  privateChat: {
    type: Boolean,
    default: false
  },
  allowedChatUsers: {
    type: [String],
    default: []
  },
  membershipTier: {
    type: String,
    enum: ["free", "pro"],
    default: "free"
  },
  membershipValidUntil: {
    type: Date,
    default: null
  },
  pushSubscriptions: {
    type: [{
      endpoint: {
        type: String,
        required: true
      },
      expirationTime: {
        type: Date,
        default: null
      },
      keys: {
        p256dh: {
          type: String,
          required: true
        },
        auth: {
          type: String,
          required: true
        }
      },
      createdAt: {
        type: Date,
        default: Date.now
      }
    }],
    default: []
  },
  password: {
    type: String,
    required: true
  }
});

userSchema.index({ username: 1 });

module.exports = mongoose.model("User", userSchema);
