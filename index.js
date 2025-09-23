// index.js - Firebase Admin Backend with detailed logs
const express = require("express");
const admin = require("firebase-admin");
const cors = require("cors");
const cloudinary = require("cloudinary").v2;

const app = express();

// Configure CORS early; restrict to your web origin
app.use(cors({
  origin: ['YOUR_FRONTEND_ORIGIN'], // e.g., 'https://mdtstudio.com' or 'http://localhost:5500'
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Firebase-AppCheck'],
  credentials: true
})); // Apply before routes for proper headers [web:54][web:48][web:51]

app.use(express.json());

// --- Firebase Admin SDK Initialization ---
try {
  const serviceAccount = require("./serviceAccountKey.json");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://mdtstudio-8a729-default-rtdb.asia-southeast1.firebasedatabase.app/"
  });
  console.log("✅ Firebase Admin SDK initialized successfully.");
} catch (error) {
  console.error("❌ FATAL ERROR: Could not initialize Firebase Admin SDK.", error);
  process.exit(1); 
}

// --- Cloudinary Configuration ---
try {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  if (!cloudinary.config().cloud_name || !cloudinary.config().api_key || !cloudinary.config().api_secret) {
    throw new Error("One or more Cloudinary environment variables are not set.");
  }

  console.log("✅ Cloudinary configured successfully.");
} catch (error) {
  console.error("❌ FATAL ERROR: Could not configure Cloudinary.", error.message);
  process.exit(1);
}

const auth = admin.auth();
const db = admin.database();

// ------------------------------------------------------------------
// ---------------------- AUTH/APP CHECK MIDDLEWARE ------------------
// ------------------------------------------------------------------

// Verify Firebase ID token from Authorization: Bearer <ID_TOKEN>
async function verifyFirebaseToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing Bearer token' });
    }
    const idToken = authHeader.slice(7);
    const decoded = await auth.verifyIdToken(idToken); // trusted verification [web:21]
    req.user = decoded;
    next();
  } catch (err) {
    console.error('❌ verifyFirebaseToken failed:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Optional: Verify App Check token sent as X-Firebase-AppCheck header
async function verifyAppCheck(req, res, next) {
  try {
    const appCheckToken = req.headers['x-firebase-appcheck'];
    if (!appCheckToken) return next(); // not enforced unless you want to require it
    const appCheckClaims = await admin.appCheck().verifyToken(appCheckToken); // server verifies App Check [web:40]
    req.appCheck = appCheckClaims;
    return next();
  } catch (err) {
    console.warn('⚠️ App Check verification failed:', err.message);
    // If you want to enforce App Check, uncomment next line:
    // return res.status(401).json({ error: 'Invalid App Check token' });
    return next();
  }
}

// Helper to validate plan key/value
function validatePlanUpdate(plan, value) {
  const allowedPlans = ['plan1', 'plan2', 'plan3', 'custom'];
  if (!allowedPlans.includes(plan)) return 'Invalid plan';
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Value must be a number';
  if (value < 0) return 'Value must be >= 0';
  return null;
}

// ------------------------------------------------------------------
// ------------------------- API ENDPOINTS --------------------------
// ------------------------------------------------------------------

// --- Client-facing: initialize user profile (server-owned fields)
app.post('/api/user/init', verifyAppCheck, verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const userRef = db.ref(`users/${uid}`);
    const snap = await userRef.get();

    if (!snap.exists()) {
      await userRef.set({
        accountStatus: 'active',
        subscription: { plan1: 0, plan2: 0, plan3: 0, custom: 0 },
        createdAt: admin.database.ServerValue.TIMESTAMP
      }); // use server timestamp sentinel [web:50]
      console.log(`✅ Initialized server profile for ${uid}`);
    } else {
      // Ensure required keys exist without overwriting user data
      const current = snap.val() || {};
      const updates = {};
      if (current.accountStatus === undefined) updates.accountStatus = 'active';
      if (current.subscription === undefined) {
        updates.subscription = { plan1: 0, plan2: 0, plan3: 0, custom: 0 };
      }
      if (Object.keys(updates).length) {
        await userRef.update(updates);
        console.log(`✅ Updated missing server fields for ${uid}`);
      }
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('❌ /api/user/init error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// --- Client-facing: example plan upgrade
app.post('/api/subscription/upgrade', verifyAppCheck, verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { plan, value } = req.body || {};
    const errMsg = validatePlanUpdate(plan, value);
    if (errMsg) return res.status(400).json({ error: errMsg });

    await db.ref(`users/${uid}/subscription/${plan}`).set(value);
    console.log(`✅ Updated ${uid} subscription.${plan} -> ${value}`);
    return res.json({ ok: true });
  } catch (err) {
    console.error('❌ /api/subscription/upgrade error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ------------------------------------------------------------------
// --------------------- ADMIN/MAINTENANCE ENDPOINTS ----------------
// ------------------------------------------------------------------

// Your existing endpoints remain unchanged below

app.get("/users", async (req, res) => {
  console.log("➡️ [GET] /users requested");
  try {
    const users = [];
    const listUsersResult = await auth.listUsers(1000);
    listUsersResult.users.forEach(userRecord => {
      let providerId = userRecord.providerData.some(p => p.providerId === "google.com") ? "google.com" : "password";
      users.push({
        uid: userRecord.uid, email: userRecord.email, displayName: userRecord.displayName,
        photoURL: userRecord.photoURL, disabled: userRecord.disabled,
        creationTime: userRecord.metadata.creationTime, lastSignInTime: userRecord.metadata.lastSignInTime,
        providerId: providerId,
      });
    });
    console.log(`✅ Retrieved ${users.length} users.`);
    res.json(users);
  } catch (err) {
    console.error("❌ Error listing users:", err);
    res.status(500).json({ error: "Failed to list users", details: err.message });
  }
});

app.post("/users", async (req, res) => {
  console.log("➡️ [POST] /users with body:", req.body);
  try {
    const { email, password, displayName } = req.body;
    if (!email || !password) {
      console.warn("⚠️ Missing email or password in request body.");
      return res.status(400).json({ error: "Email and password are required fields." });
    }
    const user = await auth.createUser({
      email, password, emailVerified: true, displayName: displayName || "",
    });
    console.log(`✅ Created user ${user.uid}`);
    res.status(201).json(user);
  } catch (err) {
    console.error("❌ Error creating user:", err);
    res.status(400).json({ error: "Failed to create user", details: err.message });
  }
});

app.delete("/users/:uid", async (req, res) => {
  const uid = req.params.uid;
  console.log(`➡️ [DELETE] /users/${uid}`);
  try {
    const folderPath = `user/${uid}`;
    console.log(`➡️ Attempting to delete Cloudinary assets from folder: ${folderPath}`);

    try {
      await cloudinary.api.delete_resources_by_prefix(folderPath, { resource_type: 'image' });
      console.log(`✅ Cloudinary images in folder ${folderPath} deleted successfully.`);
      await cloudinary.api.delete_resources_by_prefix(folderPath, { resource_type: 'video' });
      console.log(`✅ Cloudinary audio/video in folder ${folderPath} deleted successfully.`);
      await cloudinary.api.delete_folder(folderPath);
      console.log(`✅ Cloudinary folder ${folderPath} deleted successfully.`);
    } catch (cloudinaryErr) {
      console.error(`❌ Cloudinary deletion failed for UID ${uid}:`, cloudinaryErr.message);
    }

    await db.ref(`users/${uid}`).remove();
    console.log(`✅ Deleted user database entry for UID: ${uid}`);

    await auth.deleteUser(uid);
    console.log(`✅ Deleted user account from Firebase Auth for UID: ${uid}`);

    res.json({ success: true, message: `User ${uid} and all associated data have been deleted.` });
  } catch (err) {
    console.error(`❌ Error during full user deletion for UID ${uid}:`, err);
    res.status(500).json({ error: "Failed to delete user completely", details: err.message });
  }
});

app.post("/users/:uid/disable", async (req, res) => {
  console.log(`➡️ [POST] /users/${req.params.uid}/disable`);
  try {
    await auth.updateUser(req.params.uid, { disabled: true });
    console.log(`✅ User ${req.params.uid} disabled`);
    res.json({ success: true, message: `User ${req.params.uid} has been disabled.` });
  } catch (err) {
    console.error(`❌ Error disabling user ${req.params.uid}:`, err);
    res.status(500).json({ error: "Failed to disable user", details: err.message });
  }
});

app.post("/users/:uid/enable", async (req, res) => {
  console.log(`➡️ [POST] /users/${req.params.uid}/enable`);
  try {
    await auth.updateUser(req.params.uid, { disabled: false });
    console.log(`✅ User ${req.params.uid} enabled`);
    res.json({ success: true, message: `User ${req.params.uid} has been enabled.` });
  } catch (err) {
    console.error(`❌ Error enabling user ${req.params.uid}:`, err);
    res.status(500).json({ error: "Failed to enable user", details: err.message });
  }
});

app.post("/delete-cloudinary-assets", async (req, res) => {
  console.log("➡️ [POST] /delete-cloudinary-assets with body:", req.body);
  const { artworkUrl, audioUrl } = req.body;
  const extractPublicIdFromUrl = (url) => {
    if (!url) return null;
    const regex = /upload/(?:vd+/)?(.+?).[^.]+$/;
    const match = url.match(regex);
    return match ? match[1] : null;
  };
  const artworkId = extractPublicIdFromUrl(artworkUrl);
  const audioId = extractPublicIdFromUrl(audioUrl);
  let results = {};
  try {
    if (artworkId) {
      console.log(`➡️ Attempting to delete image with ID: ${artworkId}`);
      results.artwork = await cloudinary.api.delete_resources([artworkId], { resource_type: 'image' });
      console.log(`✅ Artwork deletion result:`, JSON.stringify(results.artwork, null, 2));
    }
    if (audioId) {
      console.log(`➡️ Attempting to delete audio with ID: ${audioId}`);
      results.audio = await cloudinary.api.delete_resources([audioId], { resource_type: 'video' });
      console.log(`✅ Audio deletion result:`, JSON.stringify(results.audio, null, 2));
    }
    res.status(200).send({ message: "Assets deleted successfully.", details: results });
  } catch (err) {
    console.error("❌ Error deleting Cloudinary assets:", err);
    res.status(500).send({ error: "Failed to delete Cloudinary assets.", details: err.message, http_code: err.http_code });
  }
});

// --- GLOBAL ERROR HANDLER ---
app.use((err, req, res, next) => {
  console.error("❌ An unhandled error occurred:", err);
  res.status(500).json({ error: "Internal Server Error", details: err.message });
});

// --- SERVER START ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Backend server running on port ${PORT}`);
});
