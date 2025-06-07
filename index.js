import express from "express";
import cors from "cors";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import admin from "firebase-admin";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";

dotenv.config();
const app = express();

// ✅ Middleware
app.use(cors({
  origin: "https://keerthidairy.netlify.app",
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// ✅ Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DB_URL,
});
const db = admin.database();
const usersRef = db.ref("login");
const galleryRef = db.ref("galleryImages");

// ✅ Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ✅ Multer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("Only images allowed"));
    cb(null, true);
  },
});

// ✅ JWT Middleware
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-jwt";

function verifyToken(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ success: false, error: "No token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(403).json({ success: false, error: "Invalid token" });
  }
}

// ✅ Login Route
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  usersRef.once("value", (snapshot) => {
    const data = snapshot.val();
    if (data && data.email === email && String(data.password) === String(password)) {
      const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: "1h" });

      res.cookie("token", token, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        maxAge: 60 * 60 * 1000,
      });

      res.json({ success: true });
    } else {
      res.status(401).json({ success: false, error: "Invalid credentials" });
    }
  });
});

// ✅ Auth check route
app.get("/check-auth", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ success: false });

  try {
    jwt.verify(token, JWT_SECRET);
    res.status(200).json({ success: true });
  } catch {
    res.status(403).json({ success: false });
  }
});

// ✅ Upload
app.post("/upload", verifyToken, upload.array("images"), async (req, res) => {
  try {
    const files = req.files;
    if (!files.length) return res.status(400).json({ error: "No files uploaded" });

    const uploads = files.map(file =>
      new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({ folder: "gallery" }, async (error, result) => {
          if (error) return reject(error);
          const ref = galleryRef.push();
          await ref.set({ url: result.secure_url, public_id: result.public_id });
          resolve({ key: ref.key, url: result.secure_url });
        });
        stream.end(file.buffer);
      })
    );

    const results = await Promise.all(uploads);
    res.json({ success: true, images: results });
  } catch {
    res.status(500).json({ error: "Upload failed" });
  }
});

// ✅ Get images
app.get("/images", verifyToken, (req, res) => {
  galleryRef.once("value", (snapshot) => {
    const data = snapshot.val() || {};
    const images = Object.entries(data).map(([key, val]) => ({
      key, url: val.url, public_id: val.public_id,
    })).reverse();
    res.json(images);
  });
});

// ✅ Delete image
app.post("/delete", verifyToken, async (req, res) => {
  const { key, public_id } = req.body;
  try {
    await cloudinary.uploader.destroy(public_id);
    await galleryRef.child(key).remove();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Delete failed" });
  }
});

// ✅ Server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
