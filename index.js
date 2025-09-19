// index.js - Firebase Admin Backend
const express = require("express");
const admin = require("firebase-admin");
const cors = require("cors");

// Initialize the Express app
const app = express();

// --- Middleware Setup ---
// 1. Enable Cross-Origin Resource Sharing (CORS) to allow your frontend
//    to make requests to this backend.
app.use(cors());

// 2. Enable the Express app to parse JSON formatted request bodies.
//    This lets you use `req.body` in your POST endpoints.
app.use(express.json());


// --- Firebase Admin SDK Initialization ---
// This block initializes the connection to your Firebase project.
// It relies on a secret file you will set up in the Render environment.
try {
  // Download this file from: Firebase Console > Project Settings > Service accounts > Generate new private key
  const serviceAccount = require("./serviceAccountKey.json");
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

} catch (error) {
  console.error("FATAL ERROR: Could not initialize Firebase Admin SDK.");
  console.error("Please make sure the 'serviceAccountKey.json' file is present and valid in the root directory of your project.");
  
  // Exit the application if Firebase can't be initialized, as nothing will work.
  process.exit(1); 
}

// Get a reference to the Firebase Authentication service to interact with users.
const auth = admin.auth();


// ------------------------------------------------------------------
// ------------------------- API ENDPOINTS --------------------------
// ------------------------------------------------------------------

/**
 * @route   GET /users
 * @desc    Retrieves a list of all users from Firebase Authentication.
 */
app.get("/users", async (req, res) => {
  try {
    const users = [];
    const listUsersResult = await auth.listUsers(1000);

    listUsersResult.users.forEach(userRecord => {
      let providerId = 'password';
      if (userRecord.providerData && userRecord.providerData.length > 0) {
        const isGoogle = userRecord.providerData.some(
          (provider) => provider.providerId === "google.com"
        );
        if (isGoogle) {
          providerId = "google.com";
        }
      }

      users.push({
        uid: userRecord.uid,
        email: userRecord.email,
        displayName: userRecord.displayName,
        photoURL: userRecord.photoURL,
        disabled: userRecord.disabled,
        creationTime: userRecord.metadata.creationTime,
        lastSignInTime: userRecord.metadata.lastSignInTime,
        providerId: providerId,
      });
    });

    res.json(users);

  } catch (err) {
    console.error("Error listing users:", err);
    res.status(500).json({ error: "Failed to list users", details: err.message });
  }
});

/**
 * @route   POST /users
 * @desc    Creates a new user in Firebase Authentication.
 */
app.post("/users", async (req, res) => {
  try {
    const { email, password, displayName } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required fields." });
    }
    
    const user = await auth.createUser({
      email: email,
      password: password,
      emailVerified: true,
      displayName: displayName || "",
    });

    res.status(201).json(user);

  } catch (err) {
    console.error("Error creating user:", err);
    res.status(400).json({ error: "Failed to create user", details: err.message });
  }
});

/**
 * @route   DELETE /users/:uid
 * @desc    Deletes a user from Firebase Authentication using their UID.
 */
app.delete("/users/:uid", async (req, res) => {
  try {
    await auth.deleteUser(req.params.uid);
    res.json({ success: true, message: `User ${req.params.uid} deleted successfully.` });
  } catch (err) {
    console.error(`Error deleting user ${req.params.uid}:`, err);
    res.status(500).json({ error: "Failed to delete user", details: err.message });
  }
});

/**
 * @route   POST /users/:uid/disable
 * @desc    Disables a user's account.
 */
app.post("/users/:uid/disable", async (req, res) => {
  try {
    await auth.updateUser(req.params.uid, { disabled: true });
    res.json({ success: true, message: `User ${req.params.uid} has been disabled.` });
  } catch (err) {
    console.error(`Error disabling user ${req.params.uid}:`, err);
    res.status(500).json({ error: "Failed to disable user", details: err.message });
  }
});

/**
 * @route   POST /users/:uid/enable
 * @desc    Re-enables a disabled user's account.
 */
app.post("/users/:uid/enable", async (req, res) => {
  try {
    await auth.updateUser(req.params.uid, { disabled: false });
    res.json({ success: true, message: `User ${req.params.uid} has been enabled.` });
  } catch (err) {
    console.error(`Error enabling user ${req.params.uid}:`, err);
    res.status(500).json({ error: "Failed to enable user", details: err.message });
  }
});


// ------------------------------------------------------------------
// ------------------------- SERVER START ---------------------------
// ------------------------------------------------------------------
// Use the port provided by the environment (Render), or default to 3000 for local development.
const PORT = process.env.PORT || 3000;

// Listen on '0.0.0.0' to ensure the app is accessible from outside the container.
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend server is running on port ${PORT}`);
});
