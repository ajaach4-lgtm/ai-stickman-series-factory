
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.static("public"));

if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads", { recursive: true });
}

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 50 * 1024 * 1024 }
});

const API_KEY = process.env.GEMINI_API_KEY;

const MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite"
];

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

async function generateWithAI(prompt) {
  if (!API_KEY) {
    throw new Error("GEMINI_API_KEY belum diatur");
  }

  let lastError = "";

  for (const model of MODELS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(
          "Mencoba model:", model,
          "Percobaan:", attempt
        );

        const response = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/interactions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": API_KEY
            },
            body: JSON.stringify({
              model,
              input: prompt,
              store: false,
              response_format: {
                type: "text",
                mime_type: "application/json"
              },
              generation_config: {
                thinking_level: "low"
              }
            })
          }
        );

        const data = await response.json();

        if (!response.ok) {
          lastError =
            data.error?.message ||
            data.message ||
            JSON.stringify(data);

          console.error(model, lastError);

          // Coba ulang jika server sedang sibuk.
          if (
            attempt < 2 &&
            (response.status === 429 ||
             response.status === 500 ||
             response.status === 503)
          ) {
            await sleep(1500);
            continue;
          }

          break;
        }

        const output = (data.steps || [])
          .filter(step => step.type === "model_output")
          .flatMap(step => step.content || [])
          .filter(item => item.type === "text")
          .map(item => item.text)
          .join("\n");

        if (!output) {
          lastError = "Model tidak memberikan hasil teks";
          break;
        }

        const cleaned = output
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();

        const result = JSON.parse(cleaned);

        console.log("Berhasil menggunakan:", model);

        return {
          model,
          result
        };

      } catch (error) {
        lastError = error.message;
        console.error("AI error:", error.message);
        break;
      }
    }
  }

  throw new Error(
    "Semua model AI gagal. Penyebab terakhir: " + lastError
  );
}

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    app: "AI Stickman Series Factory",
    geminiConfigured: Boolean(API_KEY),
    models: MODELS
  });
});

app.post("/api/story", async (req, res) => {
  try {
    const {
      title,
      genre = "Petualangan",
      episodes = 5,
      episode = 1,
      previousSummary = ""
    } = req.body;

    const prompt = `
Bertindak sebagai penulis profesional
serial animasi Stickman YouTube Shorts.

Judul serial: ${title || "Petualangan Stickman"}
Genre: ${genre}
Jumlah episode: ${episodes}
Episode sekarang: ${episode}

Ringkasan episode sebelumnya:
${previousSummary || "Ini adalah episode pertama."}

Buat cerita berdurasi 45-60 detik.

Buat 6 sampai 8 adegan.
Pertahankan konsistensi karakter dan cerita.
Buat konflik yang menarik.
Akhiri dengan cliffhanger untuk episode berikutnya.

Keluarkan JSON valid dengan struktur:

{
  "title": "",
  "episode": ${episode},
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

Jangan gunakan Markdown.
`;

    const ai = await generateWithAI(prompt);

    res.json({
      success: true,
      model: ai.model,
      story: ai.result
    });

  } catch (error) {
    console.error(error);

    res.status(502).json({
      error: "Semua model AI gagal membuat cerita",
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
    filename: req.file.filename
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("AI Stickman Series Factory berjalan:", PORT);
  console.log("Gemini tersedia:", Boolean(API_KEY));
  console.log("Model cadangan:", MODELS.join(", "));
});
