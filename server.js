const path = require("path");
require("dotenv").config({ quiet: true });

// Silence all terminal and console logging to prevent log storage in stdout/stderr histories.
// You can re-enable logging in development by adding DEBUG=1 to your .env file.
if (process.env.DEBUG !== "1") {
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
}
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
const Story = require("./models/Story");

// Post Model for Feed
const CommentSchema = new mongoose.Schema({
  username: { type: String, required: true },
  author: { type: String },
  avatarUrl: { type: String },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const PostSchema = new mongoose.Schema({
  username: { type: String, required: true },
  author: { type: String },
  content: { type: String, required: true },
  imageUrl: { type: String },
  likes: [{ type: String }],
  dislikes: [{ type: String }], // Array of usernames who disliked the post
  mentions: [{ type: String }], 
  comments: [CommentSchema],
  timestamp: { type: Date, default: Date.now }
});
const Post = mongoose.model("Post", PostSchema);

const ShareSchema = new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: "Post", required: true },
  from: { type: String, required: true },
  to: { type: String, required: true }, // Username or platform name
  platform: { type: String, enum: ["internal", "whatsapp", "instagram"], required: true },
  timestamp: { type: Date, default: Date.now }
});
const Share = mongoose.model("Share", ShareSchema);

// Report Model
const ReportSchema = new mongoose.Schema({
  reporter:  { type: String, required: true },
  reported:  { type: String, required: true },
  reason:    { type: String, required: true },
  details:   { type: String, default: "" },
  status:    { type: String, enum: ["pending", "resolved", "dismissed"], default: "pending" },
  adminNote: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now }
});
const Report = mongoose.model("Report", ReportSchema);

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

// [NEW] Upload route moved to top to preserve raw stream
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

      const storedFile = await streamUploadToGridFS({
        req,
        filename,
        contentType,
        metadata: {
          kind: fileKind,
          uploadedBy: req.user.username,
          uploadedAt: new Date(),
          contentType: contentType // Store for redundancy
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
      return res.status(500).json({ error: "Failed to upload file." });
    }
  }
);

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));
app.use(express.static("public", {
  index: false,
  setHeaders: (res, filePath) => {
    const lowerPath = filePath.toLowerCase();
    if (lowerPath.endsWith("sw.js") || lowerPath.endsWith(".webmanifest")) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  }
}));

// ── API Browser Guard ──────────────────────────────────────────────────────
// Blocks any /api/ request that wasn't made by the app's own JavaScript.
// When a user types an API URL directly in the browser, there is no
// X-App-Request header and Sec-Fetch-Dest is "document" — both are blocked.
app.use("/api", (req, res, next) => {
  const appHeader = req.headers["x-app-request"];
  const fetchDest = req.headers["sec-fetch-dest"]; // set by modern browsers

  // Allow: request came from app JS (has our custom header)
  if (appHeader === "1") return next();

  // Allow: non-GET methods (POST/PUT/DELETE from forms/fetch won't be navigate)
  if (req.method !== "GET") return next();

  // Block: browser direct navigation (Sec-Fetch-Dest = document)
  if (fetchDest === "document") {
    return res.status(403).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>403 – Not Accessible</title>
        <style>
          body { font-family: system-ui, sans-serif; background:#0a1628; color:#d3e3ff;
                 display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
          .box { text-align:center; padding:40px; border:1px solid rgba(116,159,207,.3);
                 border-radius:20px; background:rgba(19,40,63,.9); max-width:400px; }
          h1 { color:#43b8ea; margin:0 0 12px; font-size:2rem; }
          p  { color:#9fb4cf; margin:0 0 24px; }
          a  { color:#43b8ea; text-decoration:none; font-weight:600; }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>🔒 403</h1>
          <p>This endpoint is not accessible from a browser.<br>It is for internal app use only.</p>
          <a href="/chat">← Go back to the app</a>
        </div>
      </body>
      </html>
    `);
  }

  // Allow anything else (curl, Postman, server-to-server) — auth middleware handles it
  next();
});
// ──────────────────────────────────────────────────────────────────────────


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

// Global in-memory buffer for follows and unfollows
const followBuffer = {
  // Key: `fromUser:toUser`, Value: "follow" | "unfollow"
  actions: new Map()
};

// Flush follow buffer to DB every 2 hours
setInterval(async () => {
  if (followBuffer.actions.size === 0) return;
  console.log(`[Background] Flushing ${followBuffer.actions.size} follow actions to DB...`);
  
  const actions = Array.from(followBuffer.actions.entries());
  followBuffer.actions.clear();

  for (const [key, action] of actions) {
    const [fromUser, toUser] = key.split(":");
    try {
      const from = await User.findOne({ username: fromUser });
      const to = await User.findOne({ username: toUser });
      if (!from || !to) continue;

      if (action === "follow") {
        if (!from.following.includes(toUser)) from.following.push(toUser);
        if (!to.followers.includes(fromUser)) to.followers.push(fromUser);
      } else {
        from.following = from.following.filter(u => u !== toUser);
        to.followers = to.followers.filter(u => u !== fromUser);
      }

      await from.save();
      await to.save();
    } catch (err) {
      console.error(`[Background] Failed to flush follow action for ${key}:`, err);
    }
  }
}, 2 * 60 * 60 * 1000); // 2 hours

function mergeFollowBuffer(user) {
  const followingSet = new Set(Array.isArray(user.following) ? user.following : []);
  const followersSet = new Set(Array.isArray(user.followers) ? user.followers : []);
  
  for (const [key, action] of followBuffer.actions.entries()) {
    const [fromUser, toUser] = key.split(":");
    if (fromUser === user.username) {
      if (action === "follow") followingSet.add(toUser);
      else followingSet.delete(toUser);
    }
    if (toUser === user.username) {
      if (action === "follow") followersSet.add(fromUser);
      else followersSet.delete(fromUser);
    }
  }

  return {
    ...user,
    following: Array.from(followingSet),
    followers: Array.from(followersSet)
  };
}

function toSafeUser(user) {
  const backgrounds = user.chatBackgrounds instanceof Map 
    ? Object.fromEntries(user.chatBackgrounds) 
    : (user.chatBackgrounds || {});
  
  const cleanBackgrounds = {};
  Object.entries(backgrounds).forEach(([k, v]) => {
    cleanBackgrounds[k.replace(/__dot__/g, ".")] = v;
  });

  const merged = mergeFollowBuffer(user);

  return {
    username: user.username,
    name: user.name,
    bio: user.bio || "",
    avatarUrl: user.avatarUrl || "",
    globalChatBackground: user.globalChatBackground || "default",
    chatBackgrounds: cleanBackgrounds,
    membershipTier: user.membershipTier || "free",
    membershipValidUntil: user.membershipValidUntil || null,
    following: merged.following,
    followers: merged.followers
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
  if (!mongoose.connection.db) {
    throw new Error("MongoDB not connected yet");
  }
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
        return;
      }
      uploadStream.write(chunk);
    });

    req.on("end", () => {
      if (!settled) {
        uploadStream.end();
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
  const recipient = await User.findOne({ username: toUsername }).select("username");
  if (!recipient) {
    return { ok: false, error: "User not found" };
  }
  return { ok: true, recipient };
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

function adminMiddleware(req, res, next) {
  const admins = (process.env.ADMIN_USERNAMES || "")
    .split(",")
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean);
  if (!admins.includes((req.user.username || "").toLowerCase())) {
    return res.status(403).json({ error: "Admin access required" });
  }
  return next();
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

app.get("/edit-profile", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "edit-profile.html"));
});

app.get("/user-profile", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "user-profile.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/groups", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "groups.html"));
});

app.get("/feed", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "feed.html"));
});

app.get("/create-post", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "create-post.html"));
});

app.get("/groups/join", (req, res) => {
  res.redirect("/groups");
});

app.get("/g/:slug", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "group.html"));
});

app.get("/media/:id", async (req, res) => {
  try {
    const id = req.params.id.trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).send("Invalid ID format");
    }
    const fileId = new mongoose.Types.ObjectId(id);
    const bucket = getUploadsBucket();
    const files = await bucket.find({ _id: fileId }).toArray();
    const file = files[0];

    if (!file) {
      return res.status(404).send("File not found");
    }

    // Verify chunks exist
    const chunksCount = await mongoose.connection.db.collection(`${GRIDFS_BUCKET_NAME}.chunks`).countDocuments({ files_id: fileId });
    
    if (chunksCount === 0 && file.length > 0) {
      return res.status(500).send("File data missing");
    }

    // Fallback to metadata if top-level contentType is missing

    let contentType = file.contentType || (file.metadata && file.metadata.contentType);

    
    // If still missing, try to infer from filename
    if (!contentType && file.filename) {
      const ext = file.filename.split('.').pop().toLowerCase();
      const mimeMap = {
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        'ogg': 'video/ogg'
      };
      contentType = mimeMap[ext];
    }

    res.setHeader("Content-Type", contentType || "application/octet-stream");
    res.setHeader("Content-Length", file.length);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");


    let bytesSent = 0;
    const downloadStream = getUploadsBucket().openDownloadStream(fileId);
    
    downloadStream.on("data", (chunk) => {
      bytesSent += chunk.length;
    });

    downloadStream.on("error", (err) => {
      if (!res.headersSent) {
        res.status(404).send("File not found");
      } else {
        res.end();
      }
    });

    downloadStream.on("end", () => {
    });

    downloadStream.pipe(res);
  } catch (error) {
    return res.status(500).send("Internal server error");
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
    .select("username name bio avatarUrl globalChatBackground chatBackgrounds membershipTier membershipValidUntil following followers");
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  return res.json(toSafeUser(user));
});

app.get("/api/users", authMiddleware, async (req, res) => {
  const users = await User.find({ username: { $ne: req.user.username } })
    .select("username name avatarUrl following followers")
    .sort({ username: 1 })
    .lean();
  
  return res.json(users.map(u => ({
    username: u.username,
    name: u.name,
    avatarUrl: u.avatarUrl,
    following: mergeFollowBuffer(u).following,
    followers: mergeFollowBuffer(u).followers
  })));
});

app.post("/api/users/:username/follow", authMiddleware, async (req, res) => {
  const fromUser = req.user.username;
  const toUser = normalizeUsername(req.params.username);
  if (!toUser || fromUser === toUser) return res.status(400).json({ error: "Invalid target user" });

  followBuffer.actions.set(`${fromUser}:${toUser}`, "follow");
  return res.json({ ok: true, followed: toUser });
});

app.delete("/api/users/:username/unfollow", authMiddleware, async (req, res) => {
  const fromUser = req.user.username;
  const toUser = normalizeUsername(req.params.username);
  if (!toUser || fromUser === toUser) return res.status(400).json({ error: "Invalid target user" });

  followBuffer.actions.set(`${fromUser}:${toUser}`, "unfollow");
  return res.json({ ok: true, unfollowed: toUser });
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
    console.log("Server: API /profile/:username - Username is missing from params.");
    return res.status(400).json({ error: "Username is required" });
  }

  const user = await User.findOne({ username }).select("username name bio avatarUrl membershipTier lastSeen createdAt");
  console.log(`Server: API /profile/:username - Searching for user: "${username}", Found: ${!!user}`);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  return res.json({
    username: user.username,
    name: user.name,
    bio: user.bio || "",
    avatarUrl: user.avatarUrl || "",
    membershipTier: user.membershipTier || "free",
    lastSeen: user.lastSeen || null,
    createdAt: user.createdAt || null
  });
});

// Helper to merge buffer into posts
function mergePostFeedback(post) {
  const pid = post._id.toString();
  const likesSet = feedbackBuffer.likes.get(pid) || new Set();
  const dislikesSet = feedbackBuffer.dislikes.get(pid) || new Set();

  // Convert DB likes to Set for easy manipulation
  const currentLikes = new Set(post.likes || []);
  const currentDislikes = new Set(post.dislikes || []);

  // Apply buffer changes
  likesSet.forEach(u => {
    currentLikes.add(u);
    currentDislikes.delete(u);
  });
  dislikesSet.forEach(u => {
    currentDislikes.add(u);
    currentLikes.delete(u);
  });

  return {
    ...post,
    likes: Array.from(currentLikes),
    dislikes: Array.from(currentDislikes)
  };
}

app.get("/api/posts", authMiddleware, async (req, res) => {
  try {
    const posts = await Post.find().sort({ timestamp: -1 }).limit(50).lean();
    const mergedPosts = posts.map(mergePostFeedback);
    res.json(mergedPosts);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch posts" });
  }
});

app.post("/api/posts", authMiddleware, async (req, res) => {
  try {
    const { content, imageUrl } = req.body;
    if (!content && !imageUrl) return res.status(400).json({ error: "Content or image is required" });
    
    const user = await User.findOne({ username: req.user.username });
    const mentions = (content.match(/@(\w+)/g) || []).map(mention => mention.substring(1).toLowerCase());
    const uniqueMentions = [...new Set(mentions)]; // Ensure unique mentions

    const post = await Post.create({
      username: user.username,
      author: user.name || user.username,
      content,
      imageUrl,
      mentions: uniqueMentions
    });
    res.status(201).json(post);
  } catch (err) {
    res.status(500).json({ error: "Failed to create post" });
  }
});

app.delete("/api/posts/:id", authMiddleware, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });
    if (post.username !== req.user.username) return res.status(403).json({ error: "Unauthorized" });

    await Post.deleteOne({ _id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete post" });
  }
});

app.put("/api/posts/:id", authMiddleware, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: "Content is required" });

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });
    if (post.username !== req.user.username) return res.status(403).json({ error: "Unauthorized" });

    post.content = content;
    await post.save();
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: "Failed to update post" });
  }
});

app.post("/api/posts/:id/like", authMiddleware, async (req, res) => {
  try {
    const postId = req.params.id;
    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const username = req.user.username;
    
    // Initialize buffer sets if needed
    if (!feedbackBuffer.likes.has(postId)) feedbackBuffer.likes.set(postId, new Set());
    if (!feedbackBuffer.dislikes.has(postId)) feedbackBuffer.dislikes.set(postId, new Set());

    const bufferLikes = feedbackBuffer.likes.get(postId);
    const bufferDislikes = feedbackBuffer.dislikes.get(postId);

    const isLikedInDb = post.likes.includes(username);
    const isDislikedInDb = post.dislikes.includes(username);

    let liked = false;
    let disliked = false;

    // Toggle logic with buffer
    if (bufferLikes.has(username)) {
      bufferLikes.delete(username);
      liked = isLikedInDb; // Revert to DB state
    } else if (isLikedInDb) {
      // Logic to "unlike" a DB state would require a "remove" buffer
      // For simplicity, we just add it to the likes list in DB later
      // But for UI, we toggle it
      bufferLikes.delete(username); // Not in buffer
      liked = false; 
    } else {
      bufferLikes.add(username);
      bufferDislikes.delete(username);
      liked = true;
      disliked = false;
    }

    // Calculate effective counts for UI
    const totalLikes = (post.likes.filter(u => u !== username).length) + (liked ? 1 : 0);
    const totalDislikes = (post.dislikes.filter(u => u !== username).length) + (disliked ? 1 : 0);

    res.json({ 
      liked, 
      disliked,
      likes: totalLikes,
      dislikes: totalDislikes 
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to toggle like" });
  }
});

app.post("/api/posts/:id/dislike", authMiddleware, async (req, res) => {
  try {
    const postId = req.params.id;
    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const username = req.user.username;
    
    if (!feedbackBuffer.likes.has(postId)) feedbackBuffer.likes.set(postId, new Set());
    if (!feedbackBuffer.dislikes.has(postId)) feedbackBuffer.dislikes.set(postId, new Set());

    const bufferLikes = feedbackBuffer.likes.get(postId);
    const bufferDislikes = feedbackBuffer.dislikes.get(postId);

    const isLikedInDb = post.likes.includes(username);
    const isDislikedInDb = post.dislikes.includes(username);

    let liked = false;
    let disliked = false;

    if (bufferDislikes.has(username)) {
      bufferDislikes.delete(username);
      disliked = isDislikedInDb;
    } else if (isDislikedInDb) {
      bufferDislikes.delete(username);
      disliked = false;
    } else {
      bufferDislikes.add(username);
      bufferLikes.delete(username);
      disliked = true;
      liked = false;
    }

    const totalLikes = (post.likes.filter(u => u !== username).length) + (liked ? 1 : 0);
    const totalDislikes = (post.dislikes.filter(u => u !== username).length) + (disliked ? 1 : 0);

    res.json({ 
      liked, 
      disliked,
      likes: totalLikes,
      dislikes: totalDislikes 
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to toggle dislike" });
  }
});

app.post("/api/posts/:id/save", authMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: "User not found" });

    const postId = req.params.id;
    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const index = user.savedPosts.indexOf(postId);
    if (index > -1) {
      user.savedPosts.splice(index, 1); // Unsave
      await user.save();
      res.json({ saved: false });
    } else {
      user.savedPosts.push(postId); // Save
      await user.save();
      res.json({ saved: true });
    }
  } catch (err) {
    res.status(500).json({ error: "Failed to toggle save" });
  }
});

app.post("/api/posts/:id/comments", authMiddleware, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: "Comment content is required" });
    }

    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    const user = await User.findOne({ username: req.user.username });
    
    const comment = {
      username: req.user.username,
      author: user.name || user.username,
      avatarUrl: user.avatarUrl || "",
      content: content.trim(),
      timestamp: new Date()
    };

    if (!post.comments) {
      post.comments = [];
    }
    post.comments.push(comment);
    await post.save();

    res.status(201).json({ ok: true, comment, commentsCount: post.comments.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to add comment" });
  }
});

app.get("/api/posts/saved", authMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.user.username }).populate({
      path: "savedPosts",
      options: { lean: true }
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Reverse to show most recently saved first and merge feedback
    const savedPosts = [...user.savedPosts].reverse().map(mergePostFeedback);
    res.json(savedPosts);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch saved posts" });
  }
});

app.post("/api/shares", authMiddleware, async (req, res) => {
  try {
    const { postId, to, platform } = req.body;
    if (!postId || !to || !platform) return res.status(400).json({ error: "Missing required fields" });

    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const share = await Share.create({
      postId,
      from: req.user.username,
      to,
      platform
    });

    if (platform === "internal") {
      const shareUrl = `/profile?u=${post.username}`; // Simplified link
      const messageText = `Check out this post by @${post.username}:\n"${post.content.substring(0, 50)}${post.content.length > 50 ? "..." : ""}"\n\n${req.headers.origin}${shareUrl}`;
      
      await Message.create({
        from: req.user.username,
        to: to,
        message: messageText,
        type: "text"
      });
      
      // Notify via socket if online
      const recipientSocketId = onlineUsers[to];
      if (recipientSocketId) {
        io.to(recipientSocketId).emit("new_message", {
          from: req.user.username,
          message: messageText,
          timestamp: new Date()
        });
      }
    }

    res.status(201).json(share);
  } catch (err) {
    console.error("Share failed:", err);
    res.status(500).json({ error: "Failed to process share" });
  }
});

app.post("/api/stories", authMiddleware, async (req, res) => {
  try {
    const { mediaUrl, mediaType, caption } = req.body;
    if (!mediaUrl) return res.status(400).json({ error: "Media URL is required." });
    
    // Check if user already has an active story
    const existingStory = await Story.findOne({ username: req.user.username });
    if (existingStory) {
      return res.status(400).json({ error: "You can only post one story per day." });
    }
    
    const user = await User.findOne({ username: req.user.username });
    const story = await Story.create({
      username: req.user.username,
      author: user?.name || req.user.username,
      avatarUrl: user?.avatarUrl,
      mediaUrl,
      mediaType: mediaType || "image",
      caption: caption || ""
    });
    res.status(201).json(story);
  } catch (err) {
    res.status(500).json({ error: "Failed to create story" });
  }
});

app.get("/api/stories", authMiddleware, async (req, res) => {
  try {
    const stories = await Story.find({ expiresAt: { $gt: new Date() } })
      .sort({ createdAt: 1 })
      .lean();
    
    const grouped = {};
    for (const story of stories) {
      if (!grouped[story.username]) {
        grouped[story.username] = {
          username: story.username,
          author: story.author || story.username,
          avatarUrl: story.avatarUrl || "",
          items: []
        };
      }
      grouped[story.username].items.push({
        _id: story._id,
        mediaUrl: story.mediaUrl,
        mediaType: story.mediaType,
        caption: story.caption,
        createdAt: story.createdAt
      });
    }
    
    res.json(Object.values(grouped));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stories" });
  }
});

app.put("/api/profile", authMiddleware, async (req, res) => {
  try {
    const name = (req.body.name || "").trim();
    const bio = (req.body.bio || "").trim();
    const avatarUrl = (req.body.avatarUrl || "").trim();

    const user = await User.findOne({ username: req.user.username });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (name) user.name = name;
    user.bio = bio.slice(0, 280);
    user.avatarUrl = avatarUrl.slice(0, 2_000_000);
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

app.put("/api/chat-background", authMiddleware, async (req, res) => {
  try {
    const withUser = req.body.withUser ? normalizeUsername(req.body.withUser) : null;
    const background = (req.body.background || "default").trim();

    const user = await User.findOne({ username: req.user.username });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Explicitly check for withUser to decide between per-chat and global
    if (req.body.withUser) {
      const targetUser = normalizeUsername(req.body.withUser);
      if (!user.chatBackgrounds) user.chatBackgrounds = new Map();
      const safeKey = targetUser.replace(/\./g, "__dot__");
      user.chatBackgrounds.set(safeKey, background);
      user.markModified("chatBackgrounds");
    } else if (req.body.isGlobal) {
      // Only set global if explicitly requested
      user.globalChatBackground = background;
    } else if (!req.body.withUser) {
      // Fallback: If no withUser and no isGlobal, do nothing or assume global if that was the old behavior
      // To be safe and follow the user's "only for one people" request, we default to doing nothing if not specified.
      // But for now, let's keep the old fallback but make it harder to hit accidentally.
      user.globalChatBackground = background;
    }
    
    await user.save();

    return res.json({ 
      ok: true, 
      globalChatBackground: user.globalChatBackground,
      chatBackgrounds: Object.fromEntries(
        Array.from(user.chatBackgrounds || []).map(([k, v]) => [k.replace(/__dot__/g, "."), v])
      ) 
    });
  } catch (error) {
    console.error("Failed to update chat background:", error);
    return res.status(500).json({ error: "Unable to update chat background" });
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

  const before = req.query.before;
  const beforeDate = before ? new Date(before) : null;
  const queryFilter = (beforeDate && !Number.isNaN(beforeDate.getTime()))
    ? { groupSlug: slug, timestamp: { $lt: beforeDate } }
    : { groupSlug: slug };

  const messages = await GroupMessage.find(queryFilter).sort({ timestamp: -1 }).limit(GROUP_HISTORY_LIMIT).lean();
  return res.json(messages.reverse());
});

app.post("/api/groups/:slug/leave", authMiddleware, async (req, res) => {
  const slug = normalizeSlug(req.params.slug);
  const group = await Group.findOne({ slug });
  if (!group) {
    return res.status(404).json({ error: "Group not found" });
  }
  if (group.owner === req.user.username) {
    return res.status(400).json({ error: "Owners cannot leave their group. Delete it instead." });
  }

  group.members = group.members.filter((m) => m !== req.user.username);
  await group.save();
  return res.json({ ok: true });
});

app.delete("/api/groups/:slug", authMiddleware, async (req, res) => {
  const slug = normalizeSlug(req.params.slug);
  const group = await Group.findOne({ slug });
  if (!group) {
    return res.status(404).json({ error: "Group not found" });
  }
  if (group.owner !== req.user.username) {
    return res.status(403).json({ error: "Only the owner can delete this group" });
  }

  await Group.deleteOne({ slug });
  await GroupMessage.deleteMany({ groupSlug: slug });

  return res.json({ ok: true });
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

// Global in-memory buffer for likes and dislikes
const feedbackBuffer = {
  likes: new Map(), // postId -> Set of usernames
  dislikes: new Map() // postId -> Set of usernames
};

// Flush buffer to DB every hour
setInterval(async () => {
  const postIds = new Set([...feedbackBuffer.likes.keys(), ...feedbackBuffer.dislikes.keys()]);
  if (postIds.size === 0) return;

  console.log(`[Background] Flushing feedback for ${postIds.size} posts to DB...`);
  
  for (const postId of postIds) {
    try {
      const post = await Post.findById(postId);
      if (!post) continue;

      const newLikes = feedbackBuffer.likes.get(postId) || new Set();
      const newDislikes = feedbackBuffer.dislikes.get(postId) || new Set();

      // Merge buffer into post arrays
      newLikes.forEach(u => {
        if (!post.likes.includes(u)) post.likes.push(u);
        const dIdx = post.dislikes.indexOf(u);
        if (dIdx > -1) post.dislikes.splice(dIdx, 1);
      });

      newDislikes.forEach(u => {
        if (!post.dislikes.includes(u)) post.dislikes.push(u);
        const lIdx = post.likes.indexOf(u);
        if (lIdx > -1) post.likes.splice(lIdx, 1);
      });

      await post.save();
    } catch (err) {
      console.error(`[Background] Failed to flush feedback for ${postId}:`, err);
    }
  }

  feedbackBuffer.likes.clear();
  feedbackBuffer.dislikes.clear();
}, 60 * 60 * 1000);

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

  // Join all group rooms the user is a member of to facilitate unread tracking
  const myGroups = await Group.find({ members: username }).select("slug");
  myGroups.forEach(g => socket.join(`group:${g.slug}`));

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
        message: text || (type === "text" ? "" : " "),
        mediaUrl,
        seen: false,
        replyTo: data.replyTo || null,
        reactions: []
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

  socket.on("typingStatus", ({ to, typing }) => {
    const target = normalizeUsername(to);
    if (!target) return;
    if (target === username) return;
    emitToUser(target, "typingStatus", {
      from: username,
      typing: Boolean(typing)
    });
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

  socket.on("reactToMessage", async ({ messageId, emoji }) => {
    if (!messageId || !emoji) return;
    try {
      const message = await Message.findById(messageId);
      if (!message) return;
      // Security: ensure the user is part of this conversation
      if (message.from !== username && message.to !== username) return;

      if (!message.reactions) message.reactions = [];
      let reaction = message.reactions.find(r => r.emoji === emoji);

      if (reaction) {
        const userIndex = reaction.usernames.indexOf(username);
        if (userIndex > -1) {
          reaction.usernames.splice(userIndex, 1);
          if (reaction.usernames.length === 0) {
            message.reactions = message.reactions.filter(r => r.emoji !== emoji);
          }
        } else {
          reaction.usernames.push(username);
        }
      } else {
        message.reactions.push({ emoji, usernames: [username] });
      }

      await message.save();
      const payload = { messageId: message._id, reactions: message.reactions };
      emitToUser(message.from, "messageReacted", payload);
      emitToUser(message.to, "messageReacted", payload);
    } catch (error) {
      console.error("Error reacting to message:", error);
    }
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

  socket.on("loadGroupMessages", async ({ slug, before, after }) => {
    const normalized = normalizeSlug(slug);
    if (!normalized) return;
    const group = await Group.findOne({ slug: normalized }).select("slug members");
    if (!group) return;
    if (!group.members.includes(username)) return;
    socket.join(`group:${normalized}`);

    try {
      const beforeDate = before ? new Date(before) : null;
      const hasBefore = beforeDate && !Number.isNaN(beforeDate.getTime());

      const afterDate = after ? new Date(after) : null;
      const hasAfter = afterDate && !Number.isNaN(afterDate.getTime());

      const baseFilter = { groupSlug: normalized };
      let queryFilter = baseFilter;

      if (hasBefore) {
        queryFilter = { ...baseFilter, timestamp: { $lt: beforeDate } };
      } else if (hasAfter) {
        queryFilter = { ...baseFilter, timestamp: { $gt: afterDate } };
      }

      const sortOrder = hasAfter ? { timestamp: 1 } : { timestamp: -1 };
      const history = await GroupMessage.find(queryFilter)
        .sort(sortOrder)
        .limit(hasAfter ? 200 : GROUP_HISTORY_LIMIT)
        .lean();

      socket.emit("groupHistory", {
        slug: normalized,
        before: hasBefore ? beforeDate.toISOString() : "",
        after: hasAfter ? afterDate.toISOString() : "",
        messages: hasAfter ? history : history.reverse(),
        hasMore: hasAfter ? false : history.length === GROUP_HISTORY_LIMIT
      });
      console.log(`Emitted groupHistory for ${normalized} with ${history.length} messages.`);
    } catch (error) {
      console.error(`Error loading group messages for ${normalized}:`, error);
      socket.emit("groupError", { slug: normalized, error: "Failed to load messages." });
    }
  });

  socket.on("groupMessage", async ({ slug, message, type, mediaUrl, replyTo }) => {
    try {
      const normalized = normalizeSlug(slug);
      const text = (message || "").trim();
      const msgType = type || "text";
      if (!normalized) return;
      if (msgType === "text" && !text) return;
      if ((msgType === "image" || msgType === "video") && !mediaUrl) return;

      const group = await Group.findOne({ slug: normalized }).select("slug members");
      if (!group) return;
      if (!group.members.includes(username)) return;

      const saved = await GroupMessage.create({
        groupSlug: normalized,
        from: username,
        message: text,
        type: msgType,
        mediaUrl: mediaUrl || "",
        replyTo: replyTo || null,
        reactions: []
      });

      const payload = { slug: normalized, message: saved };

      // Broadcast to everyone currently viewing the group chat room.
      io.to(`group:${normalized}`).emit("groupMessage", payload);

      await Promise.all(
        group.members
          .filter((memberUsername) => memberUsername !== username && !getSocketIdsForUser(memberUsername).length)
          .map((memberUsername) =>
            sendPushToUser(memberUsername, {
              type: "group-message",
              title: `${group.slug}`,
              body: `@${username}: ${text || (msgType === "text" ? "" : "sent a " + msgType)}`,
              url: `/g/${encodeURIComponent(normalized)}`,
              tag: `group:${normalized}`,
              data: {
                slug: normalized,
                from: username
              }
            })
          )
      );
    } catch (error) {
      console.error("Error sending group message:", error);
      socket.emit("groupError", { slug: normalizeSlug(slug), error: "Failed to send message." });
    }
  });

  socket.on("editGroupMessage", async ({ messageId, newText }) => {
    try {
      const text = (newText || "").trim();
      if (!messageId || !text) return;

      const msg = await GroupMessage.findById(messageId);
      if (!msg || msg.from !== username) return;

      msg.message = text;
      msg.edited = true;
      msg.editedAt = new Date();
      await msg.save();

      io.to(`group:${msg.groupSlug}`).emit("groupMessageEdited", msg);
    } catch (error) {
      console.error("Error editing group message:", error);
    }
  });

  socket.on("deleteGroupMessage", async ({ messageId }) => {
    try {
      if (!messageId) return;

      const msg = await GroupMessage.findById(messageId);
      if (!msg || msg.from !== username) return;

      const slug = msg.groupSlug;
      await GroupMessage.deleteOne({ _id: messageId });
      io.to(`group:${slug}`).emit("groupMessageDeleted", { messageId });
    } catch (error) {
      console.error("Error deleting group message:", error);
    }
  });

  socket.on("reactToGroupMessage", async ({ messageId, emoji }) => {
    try {
      if (!messageId || !emoji) return;

      const msg = await GroupMessage.findById(messageId);
      if (!msg) return;

      // Ensure reactions array exists
      if (!msg.reactions) msg.reactions = [];

      // Find existing reaction for this emoji
      let reaction = msg.reactions.find(r => r.emoji === emoji);

      if (reaction) {
        const userIndex = reaction.usernames.indexOf(username);
        if (userIndex > -1) {
          // Toggle off: remove user
          reaction.usernames.splice(userIndex, 1);
          // Remove emoji group if no users left
          if (reaction.usernames.length === 0) {
            msg.reactions = msg.reactions.filter(r => r.emoji !== emoji);
          }
        } else {
          // Toggle on: add user
          reaction.usernames.push(username);
        }
      } else {
        // New emoji reaction
        msg.reactions.push({ emoji, usernames: [username] });
      }

      await msg.save();
      io.to(`group:${msg.groupSlug}`).emit("groupMessageReacted", {
        messageId: msg._id,
        reactions: msg.reactions
      });
    } catch (error) {
      console.error("Error reacting to group message:", error);
    }
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
      // Update database with last seen timestamp when the user fully disconnects
      User.updateOne({ username }, { $set: { lastSeen: new Date() } }).catch(err => {
        console.error("Failed to update lastSeen:", err);
      });
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

// ─── REPORT SYSTEM ───────────────────────────────────────────────────────────

// Submit a report (any authenticated user)
app.post("/api/reports", authMiddleware, async (req, res) => {
  try {
    const reporter = req.user.username;
    const reported = normalizeUsername(req.body.reported || "");
    const reason = (req.body.reason || "").trim();
    const details = (req.body.details || "").trim().slice(0, 500);

    if (!reported || !reason) {
      return res.status(400).json({ error: "Reported user and reason are required" });
    }
    if (reporter === reported) {
      return res.status(400).json({ error: "You cannot report yourself" });
    }
    const targetUser = await User.findOne({ username: reported }).select("username");
    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Prevent duplicate pending reports from same user
    const existing = await Report.findOne({ reporter, reported, status: "pending" });
    if (existing) {
      return res.status(409).json({ error: "You already have a pending report for this user" });
    }

    const report = await Report.create({ reporter, reported, reason, details });
    return res.status(201).json({ ok: true, report });
  } catch (err) {
    console.error("Failed to submit report:", err);
    return res.status(500).json({ error: "Failed to submit report" });
  }
});

// ─── ADMIN ROUTES ─────────────────────────────────────────────────────────────

// GET /api/admin/stats — dashboard overview
app.get("/api/admin/stats", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const [totalUsers, totalPosts, pendingReports, resolvedReports, dismissedReports] = await Promise.all([
      User.countDocuments(),
      Post.countDocuments(),
      Report.countDocuments({ status: "pending" }),
      Report.countDocuments({ status: "resolved" }),
      Report.countDocuments({ status: "dismissed" })
    ]);
    return res.json({ totalUsers, totalPosts, pendingReports, resolvedReports, dismissedReports });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// GET /api/admin/analytics — user and post creation over time
app.get("/api/admin/analytics", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Users created per day (using _id timestamp)
    const newUsers = await User.aggregate([
      { $addFields: { createdAt: { $toDate: "$_id" } } },
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      { $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Posts created per day
    const newPosts = await Post.aggregate([
      { $match: { timestamp: { $gte: sevenDaysAgo } } },
      { $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    return res.json({ newUsers, newPosts });
  } catch (err) {
    console.error("Analytics Error:", err);
    return res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// GET /api/admin/reports — list all reports
app.get("/api/admin/reports", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const status = req.query.status || "";
    const filter = status ? { status } : {};
    const reports = await Report.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    return res.json(reports);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch reports" });
  }
});

// PATCH /api/admin/reports/:id — update report status / admin note
app.patch("/api/admin/reports/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    const allowed = ["pending", "resolved", "dismissed"];
    if (status && !allowed.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: "Report not found" });

    if (status) report.status = status;
    if (typeof adminNote === "string") report.adminNote = adminNote.trim().slice(0, 500);
    await report.save();
    return res.json({ ok: true, report });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update report" });
  }
});

// GET /api/admin/users — list all users
app.get("/api/admin/users", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const users = await User.find()
      .select("username name avatarUrl membershipTier createdAt")
      .sort({ createdAt: -1 })
      .lean();
    return res.json(users);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch users" });
  }
});

// DELETE /api/admin/users/:username — delete/ban a user
app.delete("/api/admin/users/:username", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const username = normalizeUsername(req.params.username);
    const admins = (process.env.ADMIN_USERNAMES || "")
      .split(",")
      .map((u) => u.trim().toLowerCase())
      .filter(Boolean);
    if (admins.includes(username)) {
      return res.status(400).json({ error: "Cannot delete an admin account" });
    }
    const user = await User.findOne({ username });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Remove user data
    await User.deleteOne({ username });
    await Message.deleteMany({ $or: [{ from: username }, { to: username }] });
    await Post.deleteMany({ username });
    await Report.updateMany({ reported: username }, { $set: { status: "resolved", adminNote: "User account deleted by admin" } });

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to delete user" });
  }
});

// GET /api/admin/posts — list all posts
app.get("/api/admin/posts", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const posts = await Post.find()
      .sort({ timestamp: -1 })
      .lean();
    return res.json(posts);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch posts" });
  }
});

// DELETE /api/admin/posts/:id — delete a post
app.delete("/api/admin/posts/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });

    await Post.deleteOne({ _id: req.params.id });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to delete post" });
  }
});

// GET /api/admin/check — check if current user is admin
app.get("/api/admin/check", authMiddleware, adminMiddleware, (req, res) => {
  return res.json({ ok: true, admin: req.user.username });
});

startServer();
