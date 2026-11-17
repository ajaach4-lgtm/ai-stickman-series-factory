
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.static("public"));

const uploadDir = "uploads";

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 50 * 1024 * 1024 }
});

const API_KEY = process.env.GEMINI_API_KEY;

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    app: "AI Stickman Series Factory",
    geminiConfigured: Boolean(API_KEY)
  });
});

app.post("/api/story", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({
        error: "GEMINI_API_KEY belum diatur"
      });
    }

    const {
      title,
      genre = "Petualangan",
      episodes = 5,
      episode = 1,
      previousSummary = ""
    } = req.body;

    const prompt = `
Bertindaklah sebagai penulis serial animasi Stickman.

Judul serial: ${title || "Petualangan Stickman"}
Genre: ${genre}
Jumlah episode: ${episodes}
Episode yang dibuat: ${episode}

Ringkasan episode sebelumnya:
${previousSummary || "Belum ada. Ini episode pertama."}

Buat cerita animasi YouTube Shorts berdurasi
sekitar 45-60 detik.

Pastikan karakter, sifat, penampilan dan
alur cerita konsisten.

Keluarkan hasil dalam format JSON:
{
  "title": "",
  "episode": 1,
  "characters": [
    {
      "name": "",
      "description": ""
    }
  ],
  "summary": "",
  "scenes": [
    {
      "scene": 1,
      "duration": 8,
      "visual": "",
      "action": "",
      "dialogue": "",
      "camera": ""
    }
  ],
  "ending": "",
  "nextEpisodeHook": ""
}

Buat 6 sampai 8 adegan.
Jangan menggunakan Markdown.
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
      encodeURIComponent(API_KEY),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            responseMimeType: "application/json"
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini error:", data);
      return res.status(502).json({
        error: "Gemini gagal membuat cerita",
        details: data.error?.message || "Unknown error"
      });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return res.status(502).json({
        error: "Gemini tidak memberikan hasil cerita"
      });
    }

    const story = JSON.parse(text);

    res.json({
      success: true,
      story
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Terjadi kesalahan saat membuat cerita",
      details: error.message
    });
  }
});

app.post("/api/upload", upload.single("video"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: "File tidak ditemukan"
    });
  }

  res.json({
    success: true,
    filename: req.file.filename,
    message: "Upload berhasil"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    "AI Stickman Series Factory berjalan di port " + PORT
  );
});
