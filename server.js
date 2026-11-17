
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 8080;

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
const MODEL = "gemini-3.8-flash";

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    app: "AI Stickman Series Factory",
    model: MODEL,
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
Bertindaklah sebagai penulis profesional
serial animasi Stickman untuk YouTube Shorts.

Judul serial: ${title || "Petualangan Stickman"}
Genre: ${genre}
Jumlah episode: ${episodes}
Episode sekarang: ${episode}

Ringkasan episode sebelumnya:
${previousSummary || "Belum ada. Ini episode pertama."}

BUAT CERITA:
- Durasi video sekitar 45-60 detik.
- Buat 6 sampai 8 adegan.
- Karakter harus konsisten.
- Cerita harus menarik dan memiliki konflik.
- Dialog singkat dan mudah dipahami.
- Akhiri dengan kejutan atau cliffhanger.
- Siapkan petunjuk untuk episode selanjutnya.

FORMAT JSON:
{
  "title": "Judul episode",
  "episode": ${episode},
  "characters": [
    {
      "name": "Nama karakter",
      "description": "Deskripsi penampilan dan sifat"
    }
  ],
  "summary": "Ringkasan cerita",
  "scenes": [
    {
      "scene": 1,
      "duration": 8,
      "visual": "Deskripsi visual",
      "action": "Gerakan karakter",
      "dialogue": "Dialog karakter",
      "camera": "Sudut kamera"
    }
  ],
  "ending": "Akhir cerita",
  "nextEpisodeHook": "Kelanjutan cerita"
}

Keluarkan JSON valid saja.
Jangan gunakan Markdown.
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": API_KEY
        },
        body: JSON.stringify({
          model: MODEL,
          input: prompt,
          store: false,
          response_format: [
            {
              type: "text",
              mime_type: "application/json"
            }
          ],
          generation_config: {
            thinking_level: "low"
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini error:", data);

      return res.status(502).json({
        error: "Gemini gagal membuat cerita",
        details:
          data.error?.message ||
          data.message ||
          JSON.stringify(data)
      });
    }

    const text = (data.steps || [])
      .filter(step => step.type === "model_output")
      .flatMap(step => step.content || [])
      .filter(item => item.type === "text")
      .map(item => item.text)
      .join("\n");

    if (!text) {
      return res.status(502).json({
        error: "Gemini tidak memberikan hasil cerita"
      });
    }

    const cleanText = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const story = JSON.parse(cleanText);

    return res.json({
      success: true,
      model: MODEL,
      story
    });

  } catch (error) {
    console.error("Story error:", error);

    return res.status(500).json({
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
  console.log("Gemini model:", MODEL);
  console.log("Gemini API tersedia:", Boolean(API_KEY));
});
