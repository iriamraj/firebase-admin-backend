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

// --- ✅ CORRECTED: Cloudinary Configuration ---
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
    console.error("FATAL ERROR: Could not configure Cloudinary.", error.message);
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
app.post("/delete-cloudinary-assets", async (req, res) => {
    const { public_ids } = req.body;
    if (!public_ids || !Array.isArray(public_ids) || public_ids.length === 0) {
        return res.status(400).send({ error: "Missing 'public_ids' array." });
    }

    console.log(`[BACKEND] Received request to delete public_ids:`, public_ids);

    try {
        console.log(`[BACKEND] Deleting specific resources by type...`);
        await cloudinary.api.delete_resources(public_ids, { resource_type: 'image', invalidate: true });
        await cloudinary.api.delete_resources(public_ids, { resource_type: 'video', invalidate: true });
        await cloudinary.api.delete_resources(public_ids, { resource_type: 'raw', invalidate: true });
        console.log(`[BACKEND] Specific resources deletion commands sent.`);

        const firstId = public_ids[0];
        const folderToDelete = firstId.substring(0, firstId.lastIndexOf('/'));
        
        if (folderToDelete) {
            console.log(`[BACKEND] Attempting to delete parent folder: ${folderToDelete}`);
            try {
                await cloudinary.api.delete_folder(folderToDelete);
                console.log(`[BACKEND] Parent folder deletion command sent.`);
            } catch (folderError) {
                console.warn(`[BACKEND] Could not delete folder (it might not be empty): ${folderError.message}`);
            }
        }

        res.status(200).send({ message: "Assets and folder cleanup process initiated." });

    } catch (error) {
        console.error("[BACKEND] FATAL Error during Cloudinary cleanup:", JSON.stringify(error, null, 2));
        const errorMessage = error.error?.message || error.message || "An unknown server error occurred.";
        res.status(500).send({ error: errorMessage });
    }
});

app.post("/delete-cloudinary-folder", async (req, res) => {
    const { folder } = req.body;
    if (!folder) {
        return res.status(400).send({ error: "Missing 'folder' path." });
    }
    try {
        await cloudinary.api.delete_resources_by_prefix(folder);
        console.log(`Deleted all resources in folder: ${folder}`);

        await cloudinary.api.delete_folder(folder);
        console.log(`Deleted empty Cloudinary folder: ${folder}`);
        
        res.status(200).send({ message: "Folder and all assets deleted successfully." });
    } catch (error) {
        if (error.http_code !== 404) {
            console.error("Error deleting Cloudinary folder:", error);
        }
        res.status(200).send({ message: "Cleanup process finished." });
    }
});

app.delete("/users/:uid", async (req, res) => {
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
