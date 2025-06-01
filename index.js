import express from "express";
import cors from "cors";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import admin from "firebase-admin";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const app = express();
app.use(cors({ origin: "https://keerthidairy.netlify.app" }));
app.use(express.json());

// Protect routes with simple API key (optional)
app.use((req, res, next) => {
  const clientKey = req.headers["x-api-key"];
  if (process.env.API_KEY && clientKey !== process.env.API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

// Multer setup - only allow image uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"), false);
    }
    cb(null, true);
  },
});

// Firebase setup
if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  console.error("Missing FIREBASE_SERVICE_ACCOUNT_KEY!");
  process.exit(1);
}
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DB_URL,
});
const db = admin.database();
const galleryRef = db.ref("galleryImages");

// Cloudinary setup
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Upload image
app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    const stream = cloudinary.uploader.upload_stream(
      { folder: "gallery" }, //keerthidairy
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

// Get all images
app.get("/images", async (req, res) => {
  try {
    galleryRef.once("value", (snapshot) => {
      const data = snapshot.val();
      if (!data) return res.json([]);

      const images = Object.entries(data).map(([key, value]) => ({
        key,
        url: value.url,
        public_id: value.public_id,
      }));

      // Optional: reverse to show newest first
      images.reverse();
      res.json(images);
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching images" });
  }
});

// Delete image
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

// Global error handling for multer or others
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message.includes("image")) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: "Unexpected error occurred" });
});

// Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
