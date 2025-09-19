// index.js - Firebase Admin Backend
const express = require("express");
const admin = require("firebase-admin");
const cors = require("cors");

// Initialize Express app
const app = express();

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- Firebase Admin SDK ---
try {
  const serviceAccount = require("./serviceAccountKey.json");
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} catch (error) {
  console.error("FATAL ERROR: Could not initialize Firebase Admin SDK.");
  process.exit(1); 
}

const auth = admin.auth();

// ---------------- API ENDPOINTS ----------------
app.get("/users", async (req, res) => {
  try {
    const users = [];
    const listUsersResult = await auth.listUsers(1000);
    listUsersResult.users.forEach(userRecord => {
      let providerId = 'password';
      if (userRecord.providerData && userRecord.providerData.length > 0) {
        const isGoogle = userRecord.providerData.some(p => p.providerId === "google.com");
        if (isGoogle) providerId = "google.com";
      }
      users.push({
        uid: userRecord.uid,
        email: userRecord.email,
        displayName: userRecord.displayName,
        photoURL: userRecord.photoURL,
        disabled: userRecord.disabled,
        creationTime: userRecord.metadata.creationTime,
        lastSignInTime: userRecord.metadata.lastSignInTime,
        providerId
      });
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Failed to list users", details: err.message });
  }
});

app.post("/users", async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required." });

    const user = await auth.createUser({
      email,
      password,
      emailVerified: true,
      displayName: displayName || "",
    });

    res.status(201).json(user);
  } catch (err) {
    res.status(400).json({ error: "Failed to create user", details: err.message });
  }
});

app.delete("/users/:uid", async (req, res) => {
  try {
    await auth.deleteUser(req.params.uid);
    res.json({ success: true, message: `User ${req.params.uid} deleted.` });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete user", details: err.message });
  }
});

app.post("/users/:uid/disable", async (req, res) => {
  try {
    await auth.updateUser(req.params.uid, { disabled: true });
    res.json({ success: true, message: `User ${req.params.uid} disabled.` });
  } catch (err) {
    res.status(500).json({ error: "Failed to disable user", details: err.message });
  }
});

app.post("/users/:uid/enable", async (req, res) => {
  try {
    await auth.updateUser(req.params.uid, { disabled: false });
    res.json({ success: true, message: `User ${req.params.uid} enabled.` });
  } catch (err) {
    res.status(500).json({ error: "Failed to enable user", details: err.message });
  }
});

// ---------------- SERVER START ----------------
// Use dynamic port from environment (Render or Heroku)
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend running on port ${PORT}`);
});