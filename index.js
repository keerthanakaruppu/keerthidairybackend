import express from "express";
import cors from "cors";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";
import admin from "firebase-admin";
import { getDatabase } from "firebase-admin/database";

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DB_URL,
});

const db = getDatabase();
const galleryRef = db.ref("galleryImages");

// Load environment variables from .env file
dotenv.config();

// Initialize Express
const app = express();
app.use(cors({
  origin: "https://keerthidairy.netlify.app", // Your frontend URL
}));
app.use(express.json());

// Configure Multer (for handling image uploads)
const upload = multer({ storage: multer.memoryStorage() });

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Firebase Configuration (client SDK)
const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);

// Upload Image Route
app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: "gallery" },
      async (error, result) => {
        if (error) {
          console.error("Cloudinary Error:", error);
          return res.status(500).json({ error: "Cloudinary upload failed" });
        }

        const newImageRef = ref(database, `galleryImages/${result.public_id}`);
        await set(newImageRef, {
          url: result.secure_url,
          public_id: result.public_id,
        });

        res.json({ url: result.secure_url, public_id: result.public_id, key: result.public_id });
      }
    );

    uploadStream.end(file.buffer);
  } catch (err) {
    console.error("Upload Error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// Get All Images Route
app.get("/images", async (req, res) => {
  try {
    const dbRef = ref(database);
    const snapshot = await get(child(dbRef, "galleryImages"));

    if (snapshot.exists()) {
      const data = snapshot.val();
      const images = Object.keys(data).map((key) => ({
        key,
        url: data[key].url,
        public_id: data[key].public_id,
      }));
      res.json(images);
    } else {
      res.json([]);
    }
  } catch (err) {
    console.error("Fetch Error:", err);
    res.status(500).json({ error: "Failed to fetch images" });
  }
});

// Delete Image Route

app.post("/delete", async (req, res) => {
  const { key, public_id } = req.body;

  if (!key || !public_id) {
    return res.status(400).json({ error: "Missing key or public_id" });
  }

  try {
    // Step 1: Delete from Cloudinary
    const result = await cloudinary.uploader.destroy(public_id);

    if (result.result !== "ok") {
      console.error("Cloudinary delete failed:", result);
      return res.status(500).json({ error: "Cloudinary deletion failed" });
    }

    // Step 2: Remove from Firebase
    await galleryRef.child(key).remove();

    return res.json({ success: true });
  } catch (err) {
    console.error("Deletion error:", err);
    return res.status(500).json({ error: "Delete failed" });
  }
});

// app.post("/delete", async (req, res) => {
//   const { key, public_id } = req.body;

//   if (!key || !public_id) {
//     return res.status(400).json({ error: "Missing key or public_id" });
//   }

//   try {
//     await cloudinary.uploader.destroy(public_id);
//     const imageRef = ref(database, `galleryImages/${key}`);
//     await remove(imageRef);

//     res.json({ success: true });
//   } catch (err) {
//     console.error("Delete Error:", err);
//     res.status(500).json({ error: "Delete failed" });
//   }
// });

// Start Server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
