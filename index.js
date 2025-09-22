// index.js - Firebase Admin Backend with detailed logs
const express = require("express");
const admin = require("firebase-admin");
const cors = require("cors");
const cloudinary = require("cloudinary").v2;

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
        // Step 1: Delete all resources in the user's Cloudinary folder
        const folderPath = `user/${uid}`;
        console.log(`➡️ Attempting to delete Cloudinary folder: ${folderPath}`);

        try {
            // This will delete all assets within the folder
            await cloudinary.api.delete_resources_by_prefix(folderPath);
            console.log(`✅ Cloudinary assets in folder ${folderPath} deleted successfully.`);
            
            // Delete the now-empty folder
            await cloudinary.api.delete_folder(folderPath);
            console.log(`✅ Cloudinary folder ${folderPath} deleted successfully.`);
            
        } catch (cloudinaryErr) {
            // This block handles specific Cloudinary errors, allowing the process to continue.
            console.error(`❌ Cloudinary deletion failed for UID ${uid}:`, cloudinaryErr.message);
            // The process will continue to delete from Firebase regardless of this error.
        }

        // Step 2: Delete user data from Firebase Realtime Database
        await db.ref(`users/${uid}`).remove();
        console.log(`✅ Deleted user database entry for UID: ${uid}`);

        // Step 3: Delete the user account from Firebase Authentication
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

// --- SERVER START ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Backend server running on port ${PORT}`);
});
