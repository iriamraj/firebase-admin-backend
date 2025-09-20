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
// --- In index.js, replace the existing /delete-cloudinary-assets endpoint with this ---

app.post("/delete-cloudinary-assets", async (req, res) => {
    const { public_ids } = req.body;
    if (!public_ids || !Array.isArray(public_ids) || public_ids.length === 0) {
        return res.status(400).send({ error: "Missing 'public_ids' array." });
    }

    console.log(`[BACKEND] Received delete request for public_ids:`, public_ids);
    const deletionResults = {};

    // Helper function to safely attempt deletion for a specific resource type
    const deleteResourceByType = async (type) => {
        try {
            console.log(`[BACKEND] Attempting to delete as resource_type: '${type}'...`);
            const result = await cloudinary.api.delete_resources(public_ids, { resource_type: type, invalidate: true });
            
            // Log the detailed result from Cloudinary
            console.log(`[BACKEND] SUCCESS for type '${type}'. Result:`, JSON.stringify(result, null, 2));
            deletionResults[type] = result;
        } catch (err) {
            // Log the specific error for this type
            console.error(`[BACKEND] ERROR deleting as type '${type}':`, JSON.stringify(err, null, 2));
            deletionResults[type] = { error: err.message };
        }
    };

    try {
        // Run all deletion attempts
        await deleteResourceByType('image');
        await deleteResourceByType('video');
        await deleteResourceByType('raw'); // For audio and other files
        
        console.log(`[BACKEND] All resource deletion attempts have completed.`);

        // Attempt to delete the parent folder after trying to clear its contents
        const firstId = public_ids[0];
        const folderToDelete = firstId.substring(0, firstId.lastIndexOf('/'));
        
        if (folderToDelete) {
            console.log(`[BACKEND] Attempting to delete parent folder: ${folderToDelete}`);
            try {
                await cloudinary.api.delete_folder(folderToDelete);
                console.log(`[BACKEND] Parent folder deletion command sent.`);
            } catch (folderError) {
                console.warn(`[BACKEND] WARN: Could not delete folder. Error:`, folderError.message);
            }
        }

        // Return a success response to the client with the detailed results
        res.status(200).send({ message: "Asset cleanup process finished.", details: deletionResults });

    } catch (serverError) {
        // This outer catch block is for truly unexpected server crashes
        console.error("[BACKEND] UNEXPECTED FATAL SERVER ERROR during cleanup:", JSON.stringify(serverError, null, 2));
        res.status(500).send({ error: "An unexpected server error occurred." });
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
