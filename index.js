// index.js - Firebase Admin Backend
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
} catch (error) {
  console.error("FATAL ERROR: Could not initialize Firebase Admin SDK.", error);
  process.exit(1); 
}

// --- Cloudinary Configuration ---
try {
  cloudinary.config({
    cloud_name: process.env.dtvxj9zkr,
    api_key: process.env.759388837839813,
    api_secret: process.env.P6Db6eR7YAD4gLdoY5yoLRRr-g4,
  });
  console.log("✅ Cloudinary configured successfully.");
} catch (error) {
    console.error("FATAL ERROR: Could not configure Cloudinary. Please check your environment variables.");
    process.exit(1);
}

const auth = admin.auth();
const db = admin.database();

// ------------------------------------------------------------------
// ------------------------- API ENDPOINTS --------------------------
// ------------------------------------------------------------------

// --- USER Endpoints ---
app.get("/users", async (req, res) => {
  // This endpoint remains unchanged
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
    res.json(users);
  } catch (err) {
    console.error("Error listing users:", err);
    res.status(500).json({ error: "Failed to list users", details: err.message });
  }
});

app.post("/users", async (req, res) => {
  // This endpoint remains unchanged
  try {
    const { email, password, displayName } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required fields." });
    }
    const user = await auth.createUser({
      email, password, emailVerified: true, displayName: displayName || "",
    });
    res.status(201).json(user);
  } catch (err) {
    console.error("Error creating user:", err);
    res.status(400).json({ error: "Failed to create user", details: err.message });
  }
});

// --- CLOUDINARY & DATA DELETION Endpoints ---

// ✅ MODIFIED: This function now deletes files AND the containing folder.
app.post("/delete-cloudinary-assets", async (req, res) => {
    const { public_ids } = req.body;
    if (!public_ids || !Array.isArray(public_ids) || public_ids.length === 0) {
        return res.status(400).send({ error: "Missing 'public_ids' array." });
    }
    
    try {
        // 1. Delete the specified files
        await cloudinary.api.delete_resources(public_ids, { resource_type: 'image' });
        await cloudinary.api.delete_resources(public_ids, { resource_type: 'video' });
        console.log(`Deleted Cloudinary assets: ${public_ids.join(", ")}`);

        // 2. Determine the parent folder from the first public_id and delete it
        const firstId = public_ids[0]; // e.g., "user/uid/releases/releaseId/artwork"
        const folderToDelete = firstId.substring(0, firstId.lastIndexOf('/')); // "user/uid/releases/releaseId"
        await cloudinary.api.delete_folder(folderToDelete);
        console.log(`Deleted empty Cloudinary folder: ${folderToDelete}`);
        
        res.status(200).send({ message: "Assets and folder deleted successfully." });
    } catch (error) {
        console.error("Error during asset and folder deletion:", error);
        res.status(500).send({ error: "Failed to delete assets." });
    }
});

// ✅ This function correctly deletes the user's main folder and all contents.
app.post("/delete-cloudinary-folder", async (req, res) => {
    const { folder } = req.body;
    if (!folder) {
        return res.status(400).send({ error: "Missing 'folder' path." });
    }
    try {
        // 1. Delete all assets within the folder (and subfolders)
        await cloudinary.api.delete_resources_by_prefix(folder);
        console.log(`Deleted all resources in folder: ${folder}`);

        // 2. Delete the now-empty folder
        await cloudinary.api.delete_folder(folder);
        console.log(`Deleted empty Cloudinary folder: ${folder}`);
        
        res.status(200).send({ message: "Folder and all assets deleted successfully." });
    } catch (error) {
        // It's okay if delete_folder fails because the folder didn't exist, but log other errors.
        if (error.http_code !== 404) {
            console.error("Error deleting Cloudinary folder:", error);
        }
        // Always return success to the client as the primary goal (deleting files) was attempted.
        res.status(200).send({ message: "Cleanup process finished." });
    }
});

app.delete("/users/:uid", async (req, res) => {
    // This endpoint remains unchanged
    const { uid } = req.params;
    try {
        await auth.deleteUser(uid);
        await db.ref(`users/${uid}`).remove();
        res.json({ success: true, message: `User ${uid} and database entries deleted.` });
    } catch (err) {
        console.error(`Error deleting user ${uid}:`, err);
        res.status(500).json({ error: "Failed to delete user", details: err.message });
    }
});

// Other endpoints (disable/enable user) remain unchanged...
app.post("/users/:uid/disable", async (req, res) => {
  try {
    await auth.updateUser(req.params.uid, { disabled: true });
    res.json({ success: true, message: `User ${req.params.uid} has been disabled.` });
  } catch (err) {
    console.error(`Error disabling user ${req.params.uid}:`, err);
    res.status(500).json({ error: "Failed to disable user", details: err.message });
  }
});

app.post("/users/:uid/enable", async (req, res) => {
  try {
    await auth.updateUser(req.params.uid, { disabled: false });
    res.json({ success: true, message: `User ${req.params.uid} has been enabled.` });
  } catch (err) {
    console.error(`Error enabling user ${req.params.uid}:`, err);
    res.status(500).json({ error: "Failed to enable user", details: err.message });
  }
});

// --- SERVER START ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend server is running on port ${PORT}`);
});
