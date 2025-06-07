import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import admin from "firebase-admin";

dotenv.config();
const app = express();

app.use(cors({
  origin: "https://keerthidairy.netlify.app",
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DB_URL,
});
const db = admin.database();
const usersRef = db.ref("login");

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

// ✅ LOGIN
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  usersRef.once("value", (snapshot) => {
    const data = snapshot.val();
    if (data && data.email === email && data.password === password) {
      const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: "1h" });

      res.cookie("token", token, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        maxAge: 3600000,
      });

      return res.json({ success: true });
    }
    res.status(401).json({ success: false, error: "Invalid credentials" });
  });
});

// ✅ CHECK AUTH
app.get("/check-auth", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ success: false });

  try {
    jwt.verify(token, JWT_SECRET);
    res.json({ success: true });
  } catch {
    res.status(403).json({ success: false });
  }
});

app.listen(4000, () => console.log("Server running on port 4000"));
