import express from "express";
import cors from "cors";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import admin from "firebase-admin";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Initialize Express
const app = express();

// Middleware
app.use(cors({ origin: "https://keerthidairy.netlify.app" }));
app.use(express.json());

// Multer setup for handling multipart/form-data (file uploads)
const upload = multer({ storage: multer.memoryStorage() });

// Firebase Admin Initialization
if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  console.error("FIREBASE_SERVICE_ACCOUNT_KEY is missing!");
  process.exit(1);
}
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DB_URL,
});

const db = admin.database();
const galleryRef = db.ref("galleryImages");

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Upload Image
app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    const stream = cloudinary.uploader.upload_stream(
      { folder: "gallery" },
      async (error, result) => {
        if (error) return res.status(500).json({ error: error.message });

        const newRef = galleryRef.push();
        await newRef.set({
          url: result.secure_url,
          public_id: result.public_id,
        });

        res.json({
          url: result.secure_url,
          public_id: result.public_id,
          key: newRef.key,
        });
      }
    );

    stream.end(file.buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Upload failed" });
  }
});


// Get All Images
app.get("/images", async (req, res) => {
  galleryRef.once("value", (snapshot) => {
    const data = snapshot.val();
    const images = [];

    for (let key in data) {
      images.push({
        key,
        url: data[key].url,
        public_id: data[key].public_id,
      });
    }

    res.json(images);
  });
});

// Delete Image
app.post("/delete", async (req, res) => {
  const { key, public_id } = req.body;

  try {
    await cloudinary.uploader.destroy(public_id);
    await galleryRef.child(key).remove();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Delete failed" });
  }
});

// Start Server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
