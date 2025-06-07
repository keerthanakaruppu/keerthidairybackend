import express from "express";
import session from "express-session";
import cors from "cors";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import admin from "firebase-admin";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());

app.use(cors({
  origin: "https://keerthidairy.netlify.app",
  credentials: true,
}));

app.use(session({
  secret: process.env.SESSION_SECRET || "super-secret-key",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    sameSite: "none",
    maxAge: 1000 * 60 * 60,
  },
}));

// Firebase setup
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DB_URL,
});
const db = admin.database();
const usersRef = db.ref("login");
const galleryRef = db.ref("galleryImages");

// Cloudinary setup
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer setup
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"), false);
    }
    cb(null, true);
  },
});

const JWT_SECRET = process.env.JWT_SECRET || "super-secret-jwt";

// ✅ Middleware to check JWT from cookies
function verifyToken(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: "Invalid token" });
  }
}

// 🔐 Login route (sets cookie)
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  usersRef.once("value", (snapshot) => {
    const data = snapshot.val();
    if (data && data.email === email && String(data.password) === String(password)) {
      const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: "1h" });
      res.cookie("token", token, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        maxAge: 60 * 60 * 1000, // 1 hour
      });
      res.json({ success: true });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });
});

// ✅ Auth check route
const router = express.Router();
router.get('/verify-token', (req, res) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ success: false, message: 'No token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
});

export default router;




// 📤 Upload Images
app.post("/upload", verifyToken, upload.array("images"), async (req, res) => {
  try {
    const files = req.files;
    if (!files.length) return res.status(400).json({ error: "No files uploaded" });

    const uploadPromises = files.map(file => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({ folder: "gallery" }, async (error, result) => {
          if (error) return reject(error);
          const newRef = galleryRef.push();
          await newRef.set({
            url: result.secure_url,
            public_id: result.public_id,
          });
          resolve({ key: newRef.key, url: result.secure_url, public_id: result.public_id });
        });
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

// 📥 Get Images
app.get("/images", verifyToken, async (req, res) => {
  galleryRef.once("value", (snapshot) => {
    const data = snapshot.val();
    const images = data
      ? Object.entries(data).map(([key, value]) => ({
          key,
          url: value.url,
          public_id: value.public_id,
        }))
      : [];
    images.reverse();
    res.json(images);
  });
});

// 🗑️ Delete Image
app.post("/delete", verifyToken, async (req, res) => {
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

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
