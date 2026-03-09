const path = require("path");
require("dotenv").config();
const express = require("express");
const http = require("http");
const net = require("net");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const webpush = require("web-push");
const Message = require("./models/Message");
const User = require("./models/User");
const Group = require("./models/Group");
const GroupMessage = require("./models/GroupMessage");

const app = express();
const server = http.createServer(app);
const MAX_MEDIA_FILE_BYTES = 300 * 1024 * 1024;
const MAX_MEDIA_TRANSPORT_BYTES = 450 * 1024 * 1024;
const GRIDFS_UPLOAD_CHUNK_BYTES = 1024 * 1024;
const CHAT_HISTORY_LIMIT = 10;
const GROUP_HISTORY_LIMIT = 10;
const GRIDFS_BUCKET_NAME = "uploads";
const io = new Server(server, {
  maxHttpBufferSize: MAX_MEDIA_TRANSPORT_BYTES
});

const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret";
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGODB_URL;
const PUSH_SUBJECT = process.env.PUSH_SUBJECT || "mailto:admin@example.com";
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const pushEnabled = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
const RTC_STUN_URLS = (process.env.RTC_STUN_URLS || "stun:stun.l.google.com:19302")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const RTC_TURN_URLS = (process.env.RTC_TURN_URLS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const RTC_TURN_USERNAME = process.env.RTC_TURN_USERNAME || "";
const RTC_TURN_CREDENTIAL = process.env.RTC_TURN_CREDENTIAL || "";
const RTC_FORCE_TURN = process.env.RTC_FORCE_TURN === "1";

if (pushEnabled) {
  webpush.setVapidDetails(PUSH_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn("Web push is disabled. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to enable offline notifications.");
}

function validateRuntimeConfig() {
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && (!process.env.JWT_SECRET || process.env.JWT_SECRET === "change_this_secret")) {
    throw new Error("JWT_SECRET is required in production. Set a strong JWT_SECRET in your environment variables.");
  }
}

async function connectToMongo() {
  if (!MONGODB_URI) {
    throw new Error("MongoDB connection string is missing. Set MONGODB_URI (or MONGODB_URL) in environment variables.");
  }

  await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 10000
  });

  console.log("MongoDB Connected");
}

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));
app.use(express.static("public", { index: false }));

function createToken(user) {
  return jwt.sign(
    {
      username: user.username,
      name: user.name
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function toSafeUser(user) {
  return {
    username: user.username,
    name: user.name,
    bio: user.bio || "",
    avatarUrl: user.avatarUrl || "",
    privateChat: !!user.privateChat,
    allowedChatUsers: Array.isArray(user.allowedChatUsers) ? user.allowedChatUsers : [],
    membershipTier: user.membershipTier || "free",
    membershipValidUntil: user.membershipValidUntil || null
  };
}

function normalizeUsername(value) {
  return (value || "").trim().toLowerCase();
}

function normalizeSlug(value) {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isValidPushSubscription(subscription) {
  return !!(
    subscription &&
    typeof subscription.endpoint === "string" &&
    subscription.endpoint &&
    subscription.keys &&
    typeof subscription.keys.p256dh === "string" &&
    typeof subscription.keys.auth === "string"
  );
}

function normalizePushSubscription(subscription) {
  if (!isValidPushSubscription(subscription)) return null;
  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime ? new Date(subscription.expirationTime) : null,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth
    },
    createdAt: new Date()
  };
}

function getApproxBase64Bytes(dataUrl = "") {
  const value = String(dataUrl || "");
  const commaIndex = value.indexOf(",");
  const base64 = commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
  if (!base64) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function getUploadsBucket() {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: GRIDFS_BUCKET_NAME
  });
}

function uploadBufferToGridFS({ buffer, filename, contentType, metadata = {} }) {
  return new Promise((resolve, reject) => {
    const bucket = getUploadsBucket();
    const uploadStream = bucket.openUploadStream(filename, {
      contentType,
      metadata,
      chunkSizeBytes: GRIDFS_UPLOAD_CHUNK_BYTES
    });

    uploadStream.on("error", reject);
    uploadStream.on("finish", () =>
      resolve({
        _id: uploadStream.id,
        filename,
        contentType,
        length: buffer.length
      })
    );
    uploadStream.end(buffer);
  });
}

function streamUploadToGridFS({ req, filename, contentType, metadata = {}, maxBytes }) {
  return new Promise((resolve, reject) => {
    const bucket = getUploadsBucket();
    const uploadStream = bucket.openUploadStream(filename, {
      contentType,
      metadata,
      chunkSizeBytes: GRIDFS_UPLOAD_CHUNK_BYTES
    });
    let totalBytes = 0;
    let settled = false;

    function finalizeError(error) {
      if (settled) return;
      settled = true;
      req.unpipe(uploadStream);
      req.resume();
      uploadStream.destroy(error);
      reject(error);
    }

    req.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (maxBytes && totalBytes > maxBytes) {
        const error = new Error("File must be 300 MB or smaller.");
        error.statusCode = 413;
        finalizeError(error);
      }
    });

    req.on("error", finalizeError);
    uploadStream.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    uploadStream.on("finish", () => {
      if (settled) return;
      settled = true;
      resolve({
        _id: uploadStream.id,
        filename,
        contentType,
        length: totalBytes
      });
    });

    req.pipe(uploadStream);
  });
}

function samePushSubscription(a, b) {
  if (!a || !b) return false;
  return a.endpoint === b.endpoint;
}

function buildRtcConfig() {
  const iceServers = [];

  if (RTC_STUN_URLS.length) {
    iceServers.push({ urls: RTC_STUN_URLS });
  }

  if (RTC_TURN_URLS.length && RTC_TURN_USERNAME && RTC_TURN_CREDENTIAL) {
    iceServers.push({
      urls: RTC_TURN_URLS,
      username: RTC_TURN_USERNAME,
      credential: RTC_TURN_CREDENTIAL
    });
  }

  return {
    iceServers,
    iceTransportPolicy: RTC_FORCE_TURN ? "relay" : "all"
  };
}

async function canSendDirectMessage(fromUsername, toUsername) {
  const recipient = await User.findOne({ username: toUsername }).select("username privateChat allowedChatUsers");
  if (!recipient) {
    return { ok: false, error: "User not found" };
  }

  if (!recipient.privateChat) {
    return { ok: true, recipient };
  }

  const allowList = new Set((recipient.allowedChatUsers || []).map((u) => normalizeUsername(u)));
  if (allowList.has(normalizeUsername(fromUsername))) {
    return { ok: true, recipient };
  }

  const hasHistory = await Message.exists({
    $or: [
      { from: fromUsername, to: toUsername },
      { from: toUsername, to: fromUsername }
    ]
  });

  if (hasHistory) {
    return { ok: true, recipient };
  }

  return { ok: false, error: "This account accepts messages only from approved or existing chats." };
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function socketAuth(socket, next) {
  const token = socket.handshake.auth?.token;

  if (!token) {
    return next(new Error("Unauthorized"));
  }

  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (error) {
    return next(new Error("Invalid token"));
  }
}

function logPrivateGroupAccessDenied({ username = "", slug = "", action = "", req = null } = {}) {
  const timestamp = new Date().toISOString();
  const ip = req?.ip || req?.socket?.remoteAddress || "";
  const userAgent = req?.headers?.["user-agent"] || "";
  const details = {
    event: "private_group_access_denied",
    timestamp,
    username,
    slug,
    action,
    ip,
    userAgent
  };
  console.warn("[SECURITY]", JSON.stringify(details));
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/register", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "register.html"));
});

app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/settings", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "settings.html"));
});

app.get("/video", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "video.html"));
});

app.get("/profile", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "profile.html"));
});

app.get("/groups", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "groups.html"));
});

app.get("/groups/join", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "join-group.html"));
});

app.get("/g/:slug", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "group.html"));
});

app.post(
  "/api/uploads",
  authMiddleware,
  async (req, res) => {
    try {
      const fileKind = String(req.headers["x-file-kind"] || "").trim().toLowerCase();
      const rawFilename = String(req.headers["x-file-name"] || "").trim();
      const filename = decodeURIComponent(rawFilename || "upload");
      const contentType = String(req.headers["content-type"] || "application/octet-stream").trim();
      const contentLength = Number(req.headers["content-length"] || 0);

      if (contentLength > MAX_MEDIA_FILE_BYTES) {
        return res.status(413).json({ error: "File must be 300 MB or smaller." });
      }

      if (!["image", "video"].includes(fileKind)) {
        return res.status(400).json({ error: "Only image and video uploads are supported." });
      }

      if (fileKind === "image" && !contentType.startsWith("image/")) {
        return res.status(400).json({ error: "Invalid image file." });
      }

      if (fileKind === "video" && !contentType.startsWith("video/")) {
        return res.status(400).json({ error: "Invalid video file." });
      }

      const storedFile = await streamUploadToGridFS({
        req,
        filename,
        contentType,
        metadata: {
          kind: fileKind,
          uploadedBy: req.user.username,
          uploadedAt: new Date()
        },
        maxBytes: MAX_MEDIA_FILE_BYTES
      });

      if (!storedFile.length) {
        return res.status(400).json({ error: "File is empty." });
      }

      return res.status(201).json({
        url: `/media/${storedFile._id}`,
        filename: storedFile.filename,
        contentType: storedFile.contentType,
        size: storedFile.length
      });
    } catch (error) {
      if (error?.statusCode === 413) {
        return res.status(413).json({ error: "File must be 300 MB or smaller." });
      }
      console.error("Upload failed:", error);
      return res.status(500).json({ error: "Failed to upload file." });
    }
  }
);

app.get("/media/:id", async (req, res) => {
  try {
    const fileId = new mongoose.Types.ObjectId(req.params.id);
    const file = await mongoose.connection.db.collection(`${GRIDFS_BUCKET_NAME}.files`).findOne({ _id: fileId });

    if (!file) {
      return res.status(404).send("File not found");
    }

    res.setHeader("Content-Type", file.contentType || "application/octet-stream");
    res.setHeader("Content-Length", file.length);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    getUploadsBucket()
      .openDownloadStream(fileId)
      .on("error", () => {
        if (!res.headersSent) {
          res.status(404).send("File not found");
        } else {
          res.end();
        }
      })
      .pipe(res);
  } catch (error) {
    return res.status(404).send("File not found");
  }
});

app.use((error, req, res, next) => {
  if (req.path === "/api/uploads") {
    if (error?.type === "entity.too.large") {
      return res.status(413).json({ error: "File must be 300 MB or smaller." });
    }

    console.error("Upload request error:", error);
    return res.status(error?.status || 400).json({
      error: error?.message || "Upload request failed."
    });
  }

  return next(error);
});

app.get("/health", (req, res) => {
  const mongoState = mongoose.connection.readyState === 1 ? "connected" : "disconnected";
  res.json({ ok: true, mongo: mongoState });
});

app.get("/api/rtc-config", authMiddleware, (req, res) => {
  res.json(buildRtcConfig());
});

app.post("/api/register", async (req, res) => {
  try {
    const username = normalizeUsername(req.body.username);
    const password = req.body.password || "";
    const name = (req.body.name || "").trim();

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(409).json({ error: "Username already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ username, name: name || username, password: hashed });

    const token = createToken(user);
    return res.status(201).json({ token, user: toSafeUser(user) });
  } catch (error) {
    return res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const username = normalizeUsername(req.body.username);
    const password = req.body.password || "";

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = createToken(user);
    return res.json({ token, user: toSafeUser(user) });
  } catch (error) {
    return res.status(500).json({ error: "Login failed" });
  }
});

app.get("/api/me", authMiddleware, async (req, res) => {
  const user = await User.findOne({ username: req.user.username })
    .select("username name bio avatarUrl privateChat allowedChatUsers membershipTier membershipValidUntil");
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  return res.json(toSafeUser(user));
});

app.get("/api/users", authMiddleware, async (req, res) => {
  const users = await User.find({ username: { $ne: req.user.username } })
    .select("username name avatarUrl privateChat")
    .sort({ username: 1 })
    .lean();
  return res.json(users);
});

app.put("/api/settings", authMiddleware, async (req, res) => {
  try {
    const name = (req.body.name || "").trim();
    const password = req.body.password || "";

    const user = await User.findOne({ username: req.user.username });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (name) {
      user.name = name;
    }

    if (password) {
      user.password = await bcrypt.hash(password, 10);
    }

    await user.save();

    const token = createToken(user);
    return res.json({ token, user: toSafeUser(user) });
  } catch (error) {
    return res.status(500).json({ error: "Unable to update settings" });
  }
});

app.get("/api/profile/:username", authMiddleware, async (req, res) => {
  const username = normalizeUsername(req.params.username);
  if (!username) {
    return res.status(400).json({ error: "Username is required" });
  }

  const user = await User.findOne({ username }).select("username name bio avatarUrl membershipTier");
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  return res.json({
    username: user.username,
    name: user.name,
    bio: user.bio || "",
    avatarUrl: user.avatarUrl || "",
    membershipTier: user.membershipTier || "free"
  });
});

app.put("/api/profile", authMiddleware, async (req, res) => {
  try {
    const name = (req.body.name || "").trim();
    const bio = (req.body.bio || "").trim();
    const avatarUrl = (req.body.avatarUrl || "").trim();
    const privateChat = !!req.body.privateChat;
    const rawAllowed = Array.isArray(req.body.allowedChatUsers) ? req.body.allowedChatUsers : [];
    const allowedChatUsers = rawAllowed
      .map((u) => normalizeUsername(u))
      .filter((u) => !!u && u !== req.user.username);

    const user = await User.findOne({ username: req.user.username });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (name) user.name = name;
    user.bio = bio.slice(0, 280);
    user.avatarUrl = avatarUrl.slice(0, 2_000_000);
    user.privateChat = privateChat;
    user.allowedChatUsers = [...new Set(allowedChatUsers)];
    await user.save();

    if (onlineUsers[user.username]) {
      onlineUsers[user.username].name = user.name || user.username;
      onlineUsers[user.username].avatarUrl = user.avatarUrl || "";
    }
    io.emit("presence", buildPresencePayload());

    const token = createToken(user);
    return res.json({ token, user: toSafeUser(user) });
  } catch (error) {
    return res.status(500).json({ error: "Unable to update profile" });
  }
});

app.get("/api/membership", authMiddleware, async (req, res) => {
  const user = await User.findOne({ username: req.user.username }).select("membershipTier membershipValidUntil");
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json({
    membershipTier: user.membershipTier || "free",
    membershipValidUntil: user.membershipValidUntil || null
  });
});

app.get("/api/push/public-key", authMiddleware, (req, res) => {
  if (!pushEnabled) {
    return res.status(503).json({ error: "Push notifications are not configured" });
  }
  return res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post("/api/push/subscribe", authMiddleware, async (req, res) => {
  if (!pushEnabled) {
    return res.status(503).json({ error: "Push notifications are not configured" });
  }

  const subscription = normalizePushSubscription(req.body?.subscription);
  if (!subscription) {
    return res.status(400).json({ error: "Invalid push subscription" });
  }

  const user = await User.findOne({ username: req.user.username }).select("pushSubscriptions");
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  user.pushSubscriptions = (user.pushSubscriptions || []).filter((item) => !samePushSubscription(item, subscription));
  user.pushSubscriptions.push(subscription);
  await user.save();

  return res.json({ ok: true });
});

app.post("/api/push/unsubscribe", authMiddleware, async (req, res) => {
  const endpoint = (req.body?.endpoint || "").trim();
  if (!endpoint) {
    return res.status(400).json({ error: "Subscription endpoint is required" });
  }

  const user = await User.findOne({ username: req.user.username }).select("pushSubscriptions");
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  user.pushSubscriptions = (user.pushSubscriptions || []).filter((item) => item.endpoint !== endpoint);
  await user.save();

  return res.json({ ok: true });
});

app.post("/api/membership/upgrade", authMiddleware, async (req, res) => {
  const plan = (req.body.plan || "pro").trim().toLowerCase();
  if (plan !== "pro") {
    return res.status(400).json({ error: "Unsupported plan" });
  }

  // Demo monetization flow: mark account as paid.
  const user = await User.findOne({ username: req.user.username });
  if (!user) return res.status(404).json({ error: "User not found" });

  user.membershipTier = "pro";
  const validUntil = new Date();
  validUntil.setMonth(validUntil.getMonth() + 1);
  user.membershipValidUntil = validUntil;
  await user.save();

  const token = createToken(user);
  return res.json({
    ok: true,
    message: "Pro membership activated for 30 days.",
    token,
    user: toSafeUser(user)
  });
});

app.get("/api/groups", authMiddleware, async (req, res) => {
  const username = req.user.username;
  const groups = await Group.find({ members: username }).sort({ updatedAt: -1 });
  return res.json(groups);
});

app.get("/api/groups/discover", authMiddleware, async (req, res) => {
  const username = req.user.username;
  const groups = await Group.find({ isPrivate: false })
    .select("name slug owner members isPrivate updatedAt")
    .sort({ updatedAt: -1 });

  return res.json(groups.map((group) => ({
    _id: group._id,
    name: group.name,
    slug: group.slug,
    owner: group.owner,
    isPrivate: false,
    memberCount: Array.isArray(group.members) ? group.members.length : 0,
    joined: Array.isArray(group.members) ? group.members.includes(username) : false,
    updatedAt: group.updatedAt || null
  })));
});

app.post("/api/groups", authMiddleware, async (req, res) => {
  const name = (req.body.name || "").trim();
  const slug = normalizeSlug(req.body.slug || "");
  const isPrivate = !!req.body.isPrivate;
  const owner = req.user.username;

  if (!name || !slug) {
    return res.status(400).json({ error: "Group name and custom domain slug are required" });
  }
  if (slug.length < 3 || slug.length > 32) {
    return res.status(400).json({ error: "Custom domain slug must be 3 to 32 characters" });
  }

  const ownerUser = await User.findOne({ username: owner }).select("membershipTier");
  if (!ownerUser) {
    return res.status(404).json({ error: "User not found" });
  }
  if ((ownerUser.membershipTier || "free") !== "pro") {
    return res.status(403).json({ error: "Creating custom-domain groups requires Pro membership" });
  }

  const existing = await Group.findOne({ slug });
  if (existing) {
    return res.status(409).json({ error: "This custom domain slug is already in use" });
  }

  const group = await Group.create({
    name: name.slice(0, 80),
    slug,
    owner,
    isPrivate,
    members: [owner]
  });
  return res.status(201).json(group);
});

app.get("/api/groups/:slug", authMiddleware, async (req, res) => {
  const slug = normalizeSlug(req.params.slug);
  const group = await Group.findOne({ slug });
  if (!group) {
    return res.status(404).json({ error: "Group not found" });
  }

  const isMember = group.members.includes(req.user.username);
  if (group.isPrivate && !isMember) {
    logPrivateGroupAccessDenied({
      username: req.user.username,
      slug,
      action: "read_group",
      req
    });
    // Return 404 to avoid leaking private group existence to non-members.
    return res.status(404).json({ error: "Group not found" });
  }

  return res.json(group);
});

app.post("/api/groups/:slug/join", authMiddleware, async (req, res) => {
  const slug = normalizeSlug(req.params.slug);
  const group = await Group.findOne({ slug });
  if (!group) {
    return res.status(404).json({ error: "Group not found" });
  }
  if (group.isPrivate) {
    logPrivateGroupAccessDenied({
      username: req.user.username,
      slug,
      action: "join_group",
      req
    });
    return res.status(403).json({ error: "Private groups can only be joined via owner invite." });
  }

  if (!group.members.includes(req.user.username)) {
    group.members.push(req.user.username);
    await group.save();
  }
  return res.json({ ok: true, group });
});

app.post("/api/groups/:slug/members", authMiddleware, async (req, res) => {
  const slug = normalizeSlug(req.params.slug);
  const username = normalizeUsername(req.body.username);
  if (!username) {
    return res.status(400).json({ error: "Username is required" });
  }

  const group = await Group.findOne({ slug });
  if (!group) {
    return res.status(404).json({ error: "Group not found" });
  }
  if (group.owner !== req.user.username) {
    return res.status(403).json({ error: "Only group owner can add members" });
  }

  const user = await User.findOne({ username }).select("username");
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  if (!group.members.includes(username)) {
    group.members.push(username);
    await group.save();
  }

  return res.json({ ok: true, group });
});

app.get("/api/groups/:slug/messages", authMiddleware, async (req, res) => {
  const slug = normalizeSlug(req.params.slug);
  const group = await Group.findOne({ slug }).select("slug members isPrivate");
  if (!group) {
    return res.status(404).json({ error: "Group not found" });
  }
  if (!group.members.includes(req.user.username)) {
    if (group.isPrivate) {
      logPrivateGroupAccessDenied({
        username: req.user.username,
        slug,
        action: "read_group_messages",
        req
      });
    }
    return res.status(403).json({ error: "Join this group to view messages" });
  }

  const messages = await GroupMessage.find({ groupSlug: slug }).sort({ timestamp: 1 }).limit(500);
  return res.json(messages);
});

app.delete("/api/conversations/:username", authMiddleware, async (req, res) => {
  const other = normalizeUsername(req.params.username);
  if (!other) {
    return res.status(400).json({ error: "Target user is required" });
  }

  await Message.deleteMany({
    $or: [
      { from: req.user.username, to: other },
      { from: other, to: req.user.username }
    ]
  });

  return res.json({ ok: true });
});

const onlineUsers = {};

function ensureUserRecord(username, name = "", avatarUrl = "") {
  if (!onlineUsers[username]) {
    onlineUsers[username] = {
      sockets: {},
      username,
      name: name || username,
      avatarUrl: avatarUrl || ""
    };
  }
  if (name && !onlineUsers[username].name) {
    onlineUsers[username].name = name;
  }
  if (avatarUrl && !onlineUsers[username].avatarUrl) {
    onlineUsers[username].avatarUrl = avatarUrl;
  }
  return onlineUsers[username];
}

function getSocketIdsForUser(username) {
  if (!onlineUsers[username]) return [];
  return Object.keys(onlineUsers[username].sockets || {});
}

function emitToUser(username, event, payload, exceptSocketId = "") {
  const socketIds = getSocketIdsForUser(username);
  socketIds.forEach((sid) => {
    if (exceptSocketId && sid === exceptSocketId) return;
    io.to(sid).emit(event, payload);
  });
}

async function sendPushToUser(username, payload) {
  if (!pushEnabled) return;

  const user = await User.findOne({ username }).select("pushSubscriptions");
  if (!user || !Array.isArray(user.pushSubscriptions) || !user.pushSubscriptions.length) {
    return;
  }

  const staleEndpoints = new Set();
  await Promise.all(
    user.pushSubscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(subscription, JSON.stringify(payload));
      } catch (error) {
        const statusCode = Number(error?.statusCode || 0);
        if (statusCode === 404 || statusCode === 410) {
          staleEndpoints.add(subscription.endpoint);
        } else {
          console.warn(`Push delivery failed for ${username}:`, error.message || error);
        }
      }
    })
  );

  if (!staleEndpoints.size) return;
  user.pushSubscriptions = user.pushSubscriptions.filter((subscription) => !staleEndpoints.has(subscription.endpoint));
  await user.save();
}

function buildPresencePayload() {
  const presence = {};
  Object.values(onlineUsers).forEach((user) => {
    const socketCount = Object.keys(user.sockets || {}).length;
    if (!socketCount) return;
    presence[user.username] = {
      username: user.username,
      name: user.name || user.username,
      avatarUrl: user.avatarUrl || "",
      online: true
    };
  });
  return presence;
}

io.use(socketAuth);

io.on("connection", async (socket) => {
  const username = socket.user.username;
  const name = socket.user.name;
  const dbUser = await User.findOne({ username }).select("avatarUrl name");

  const userRecord = ensureUserRecord(
    username,
    (dbUser?.name || name || username),
    dbUser?.avatarUrl || ""
  );
  userRecord.sockets[socket.id] = true;

  io.emit("presence", buildPresencePayload());

  socket.on("loadMessages", async ({ withUser, before }) => {
    if (!withUser) return;
    const targetUser = normalizeUsername(withUser);
    if (!targetUser) return;

    const beforeDate = before ? new Date(before) : null;
    const hasBefore = beforeDate && !Number.isNaN(beforeDate.getTime());
    const baseFilter = {
      $or: [
        { from: username, to: targetUser },
        { from: targetUser, to: username }
      ]
    };
    const queryFilter = hasBefore
      ? { ...baseFilter, timestamp: { $lt: beforeDate } }
      : baseFilter;

    const messages = await Message.find(queryFilter)
      .select("_id from to message type mediaUrl seen edited timestamp")
      .sort({ timestamp: -1 })
      .limit(CHAT_HISTORY_LIMIT)
      .lean();

    socket.emit("chatHistory", {
      withUser: targetUser,
      before: hasBefore ? beforeDate.toISOString() : "",
      messages: messages.reverse(),
      hasMore: messages.length === CHAT_HISTORY_LIMIT
    });

    if (!hasBefore) {
      await Message.updateMany(
        { from: targetUser, to: username, seen: false },
        { $set: { seen: true } }
      );
      emitToUser(targetUser, "messagesSeen", { by: username, withUser: targetUser });
    }
  });

  socket.on("privateMessage", async (data) => {
    const to = normalizeUsername(data.to);
    const type = data.type || "text";
    const text = (data.message || "").trim();
    const mediaUrl = data.mediaUrl || "";
    const clientId = (data.clientId || "").trim();

    try {
      if (!to || to === username) return;
      if (type === "text" && !text) return;
      if ((type === "image" || type === "video") && !mediaUrl) return;
      if ((type === "image" || type === "video") && getApproxBase64Bytes(mediaUrl) > MAX_MEDIA_FILE_BYTES) {
        socket.emit("messageError", {
          to,
          clientId,
          error: "File must be 300 MB or smaller."
        });
        return;
      }
      const permission = await canSendDirectMessage(username, to);
      if (!permission.ok) {
        socket.emit("messageError", {
          to,
          clientId,
          error: permission.error || "Unable to send message"
        });
        return;
      }

      const payload = {
        from: username,
        to,
        type,
        message: text,
        mediaUrl,
        seen: false
      };

      const saved = await Message.create(payload);

      emitToUser(to, "privateMessage", { ...saved.toObject(), clientId });
      emitToUser(username, "privateMessage", { ...saved.toObject(), seen: true, clientId });

      if (!getSocketIdsForUser(to).length) {
        await sendPushToUser(to, {
          type: "private-message",
          title: `New message from @${username}`,
          body: type === "text" ? (text || "Sent a message") : `Sent a ${type}`,
          url: `/chat?with=${encodeURIComponent(username)}`,
          tag: `dm:${username}`,
          data: {
            from: username,
            to,
            chatWith: username
          }
        });
      }
    } catch (error) {
      socket.emit("messageError", {
        to,
        clientId,
        error: "Failed to send message"
      });
    }
  });

  socket.on("editMessage", async ({ messageId, newText }) => {
    const text = (newText || "").trim();
    if (!messageId || !text) return;

    const message = await Message.findById(messageId);
    if (!message) return;
    if (message.from !== username) return;
    if (message.type !== "text") return;

    message.message = text;
    message.edited = true;
    message.editedAt = new Date();
    await message.save();

    emitToUser(message.to, "messageEdited", message);
    emitToUser(username, "messageEdited", message);
  });

  socket.on("deleteMessage", async ({ messageId }) => {
    if (!messageId) return;

    const message = await Message.findById(messageId);
    if (!message) return;
    if (message.from !== username) return;

    const toUser = message.to;
    await Message.deleteOne({ _id: messageId });

    emitToUser(toUser, "messageDeleted", { messageId });
    emitToUser(username, "messageDeleted", { messageId });
  });

  socket.on("deleteConversation", async ({ withUser }) => {
    if (!withUser) return;

    await Message.deleteMany({
      $or: [
        { from: username, to: withUser },
        { from: withUser, to: username }
      ]
    });

    emitToUser(withUser, "conversationDeleted", { withUser: username });
    emitToUser(username, "conversationDeleted", { withUser });
  });

  socket.on("video-offer", ({ to, offer, callId }) => {
    if (!to || !offer) return;
    emitToUser(to, "video-offer", { from: username, offer, callId: callId || "" });
    if (!getSocketIdsForUser(to).length) {
      sendPushToUser(to, {
        type: "incoming-call",
        title: "Incoming call",
        body: `@${username} is calling you`,
        url: `/video?with=${encodeURIComponent(username)}&incoming=1&callId=${encodeURIComponent(callId || "")}`,
        tag: `call:${username}`,
        requireInteraction: true,
        data: {
          from: username,
          callId: callId || ""
        }
      });
    }
  });

  socket.on("joinGroup", async ({ slug }) => {
    const normalized = normalizeSlug(slug);
    if (!normalized) return;
    const group = await Group.findOne({ slug: normalized }).select("slug members");
    if (!group) return;
    if (!group.members.includes(username)) return;
    socket.join(`group:${normalized}`);
  });

  socket.on("loadGroupMessages", async ({ slug, before }) => {
    const normalized = normalizeSlug(slug);
    if (!normalized) return;
    const group = await Group.findOne({ slug: normalized }).select("slug members");
    if (!group) return;
    if (!group.members.includes(username)) return;
    socket.join(`group:${normalized}`);

    const beforeDate = before ? new Date(before) : null;
    const hasBefore = beforeDate && !Number.isNaN(beforeDate.getTime());
    const baseFilter = { groupSlug: normalized };
    const queryFilter = hasBefore
      ? { ...baseFilter, timestamp: { $lt: beforeDate } }
      : baseFilter;

    const history = await GroupMessage.find(queryFilter)
      .sort({ timestamp: -1 })
      .limit(GROUP_HISTORY_LIMIT)
      .lean();

    socket.emit("groupHistory", {
      slug: normalized,
      before: hasBefore ? beforeDate.toISOString() : "",
      messages: history.reverse(),
      hasMore: history.length === GROUP_HISTORY_LIMIT
    });
  });

  socket.on("groupMessage", async ({ slug, message }) => {
    const normalized = normalizeSlug(slug);
    const text = (message || "").trim();
    if (!normalized || !text) return;

    const group = await Group.findOne({ slug: normalized }).select("slug members");
    if (!group) return;
    if (!group.members.includes(username)) return;

    const saved = await GroupMessage.create({
      groupSlug: normalized,
      from: username,
      message: text
    });

    const payload = { slug: normalized, message: saved };

    // Broadcast to current room members and every online member socket for reliability.
    io.to(`group:${normalized}`).emit("groupMessage", payload);
    group.members.forEach((memberUsername) => {
      emitToUser(memberUsername, "groupMessage", payload);
    });

    await Promise.all(
      group.members
        .filter((memberUsername) => memberUsername !== username && !getSocketIdsForUser(memberUsername).length)
        .map((memberUsername) =>
          sendPushToUser(memberUsername, {
            type: "group-message",
            title: `${group.slug}`,
            body: `@${username}: ${text}`,
            url: `/g/${encodeURIComponent(normalized)}`,
            tag: `group:${normalized}`,
            data: {
              slug: normalized,
              from: username
            }
          })
        )
    );
  });

  socket.on("video-answer", ({ to, answer, callId }) => {
    if (!to || !answer) return;
    emitToUser(to, "video-answer", { from: username, answer, callId: callId || "" });
  });

  socket.on("video-ice", ({ to, candidate, callId }) => {
    if (!to || !candidate) return;
    emitToUser(to, "video-ice", { from: username, candidate, callId: callId || "" });
  });

  socket.on("video-decline", ({ to, callId, reason }) => {
    if (!to) return;
    emitToUser(to, "video-decline", { from: username, callId: callId || "", reason: reason || "" });
  });

  socket.on("video-end", ({ to, callId, reason }) => {
    if (!to) return;
    emitToUser(to, "video-end", { from: username, callId: callId || "", reason: reason || "" });
  });

  socket.on("disconnect", () => {
    if (!onlineUsers[username]) return;
    delete onlineUsers[username].sockets[socket.id];
    if (!Object.keys(onlineUsers[username].sockets).length) {
      delete onlineUsers[username];
    }
    io.emit("presence", buildPresencePayload());
  });
});

const basePort = Number(process.env.PORT) || 3000;

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();

    tester.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        resolve(false);
        return;
      }
      resolve(false);
    });

    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });

    tester.listen(port);
  });
}

async function findAvailablePort(startPort, maxTries = 10) {
  let port = startPort;
  let tries = 0;

  while (tries <= maxTries) {
    // Check ports sequentially to avoid startup crashes when one is busy.
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }

    console.warn(`Port ${port} is in use. Trying ${port + 1}...`);
    port += 1;
    tries += 1;
  }

  return null;
}

async function startServer() {
  try {
    validateRuntimeConfig();
    await connectToMongo();

    const selectedPort = await findAvailablePort(basePort, 50);
    const portToUse = selectedPort || 0;

    if (selectedPort === null) {
      console.warn("No preferred port available. Using an OS-assigned port.");
    }

    server.listen(portToUse, () => {
      const actualPort = server.address()?.port || portToUse;
      console.log(`Server running at http://localhost:${actualPort}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
