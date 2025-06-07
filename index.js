import express from "express";
import session from "express-session";
import cors from "cors";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import admin from "firebase-admin";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";


dotenv.config();

const app = express();
app.use(express.json());

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
    maxAge: 1000 * 60 * 60, // 1 hour
  }
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

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-jwt";

// JWT middleware
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Missing token" });

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: "Invalid token" });
  }
}

// verify token route
app.get("/verify-token", (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token missing" });
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: "Invalid token" });
    }

    // Optional: attach decoded user info
    req.user = decoded;
    res.json({ valid: true });
  });
});


// 🔐 LOGIN ROUTE
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  usersRef.once("value", (snapshot) => {
    const data = snapshot.val();
    if (data && data.email === email && String(data.password) === String(password)) {
      const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: "1h" });
      res.json({ success: true, token });
    } else {
      res.status(401).json({ error: "Invalid email or password" });
    }
  });
});




// 📤 UPLOAD IMAGES (protected)
app.post("/upload", verifyToken, upload.array("images"), async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const uploadPromises = files.map(file => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({ folder: "gallery" }, async (error, result) => {
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

// 📥 GET IMAGES (protected)
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

// 🗑️ DELETE IMAGE (protected)
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
