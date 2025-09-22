// index.js - Firebase Admin Backend with detailed logs
const express = require("express");
const admin = require("firebase-admin");
const cors = require("cors");

// Initialize the Express app
const app = express();
app.use(cors());
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

const auth = admin.auth();
const db = admin.database();

// ------------------------------------------------------------------
// ------------------------- API ENDPOINTS --------------------------
// ------------------------------------------------------------------

// --- USER Endpoints ---
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
        // Step 1: Delete user data from Firebase Realtime Database
        await db.ref(`users/${uid}`).remove();
        console.log(`✅ Deleted user database entry for UID: ${uid}`);

        // Step 2: Delete the user account from Firebase Authentication
        await auth.deleteUser(uid);
        console.log(`✅ Deleted user account from Firebase Auth for UID: ${uid}`);

        res.json({ success: true, message: `User ${uid} and all associated data have been deleted.` });
    } catch (err) {
        console.error(`❌ Error during full user deletion for UID ${uid}:`, err);
        res.status(500).json({ error: "Failed to delete user", details: err.message });
    }
});


// Add this code block after your existing user-related endpoints

// --- NEW: CLOUDINARY ASSET DELETION Endpoint ---
app.post("/delete-cloudinary-assets", async (req, res) => {
    console.log("➡️ [POST] /delete-cloudinary-assets with body:", req.body);

    const { artworkUrl, audioUrl } = req.body;
    const public_ids = [];

    // Extract public IDs from URLs and add them to the array
    const extractPublicIdFromUrl = (url) => {
        if (!url) return null;
        const regex = /upload\/(?:v\d+\/)?(.+?)\.[^.]+$/;
        const match = url.match(regex);
        return match ? match[1] : null;
    };

    const artworkId = extractPublicIdFromUrl(artworkUrl);
    const audioId = extractPublicIdFromUrl(audioUrl);

    if (artworkId) public_ids.push(artworkId);
    if (audioId) public_ids.push(audioId);

    if (public_ids.length === 0) {
        return res.status(200).send({ message: "No assets to delete." });
    }

    try {
        console.log(`➡️ Attempting to delete Cloudinary assets with IDs: ${public_ids.join(', ')}`);
        // Delete the specified resources
        const result = await cloudinary.api.delete_resources(public_ids);
        console.log(`✅ Deletion result:`, JSON.stringify(result, null, 2));

        res.status(200).send({ message: "Assets deleted successfully.", details: result });
    } catch (err) {
        console.error("❌ Error deleting Cloudinary assets:", err);
        res.status(500).send({ error: "Failed to delete Cloudinary assets.", details: err.message, http_code: err.http_code });
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

// --- SERVER START ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Backend server running on port ${PORT}`);
});
