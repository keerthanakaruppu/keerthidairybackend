import express from "express";
import cors from "cors";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import admin from "firebase-admin";
import dotenv from "dotenv";
import nodemailer from "nodemailer";


// Load environment variables
dotenv.config();


let currentOTP = null;
let otpExpiresAt = null;

// Send OTP to email
app.post("/send-otp", async (req, res) => {
  try {
    // Generate 6-digit OTP
    currentOTP = Math.floor(100000 + Math.random() * 900000).toString();
    otpExpiresAt = Date.now() + 5 * 60 * 1000; // OTP valid for 5 mins

    // Setup transporter (use your Gmail credentials or custom SMTP)
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER, // e.g., your Gmail
        pass: process.env.EMAIL_PASS, // app password or real password
      },
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: "keerthanakaruppu111@gmail.com",
      subject: "Keerthi Dairy Gallery OTP",
      text: `Your OTP is: ${currentOTP}`,
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to send OTP:", err);
    res.status(500).json({ error: "Failed to send OTP" });
  }
});

app.post("/verify-otp", (req, res) => {
  const { otp } = req.body;
  if (Date.now() > otpExpiresAt) {
    return res.status(400).json({ error: "OTP expired" });
  }
  if (otp === currentOTP) {
    return res.json({ success: true });
  }
  res.status(400).json({ error: "Invalid OTP" });
});



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
app.post("/upload", upload.array("images"), async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const uploadedImages = [];

    const uploadPromises = files.map((file) => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "gallery" },
          async (error, result) => {
            if (error) return reject(error);

            const newRef = galleryRef.push();
            await newRef.set({
              url: result.secure_url,
              public_id: result.public_id,
            });

            resolve({
              key: newRef.key,
              url: result.secure_url,
              public_id: result.public_id,
            });
          }
        );
        stream.end(file.buffer);
      });
    });

    const results = await Promise.all(uploadPromises);
    res.json({ success: true, images: results });
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
