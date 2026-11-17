import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { randomUUID } from "crypto";

const app = express();
const PORT = process.env.PORT || 8080;
const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "output");
const UPLOAD_DIR = path.join(ROOT, "uploads");
for (const dir of [OUTPUT_DIR, UPLOAD_DIR]) fs.mkdirSync(dir, { recursive: true });

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.static("public"));
app.use("/output", express.static(OUTPUT_DIR));

const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 50 * 1024 * 1024 } });
const API_KEY = process.env.GEMINI_API_KEY;
const MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"];
const jobs = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", d => stdout += d.toString());
    child.stderr.on("data", d => stderr += d.toString());
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} gagal (${code}): ${stderr.slice(-1800)}`)));
  });
}

function escapeXml(value = "") {
  return String(value).replace(/[<>&\"']/g, ch => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[ch]);
}
function wrapText(value, max = 42, lines = 3) {
  const words = String(value || "").replace(/\s+/g, " ").trim().split(" ");
  const out = []; let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) { out.push(line); line = word; } else line = next;
    if (out.length === lines) break;
  }
  if (line && out.length < lines) out.push(line);
  return out;
}
function makeSvg(story, scene, index, style) {
  const title = escapeXml(story.title || "Petualangan Stickman");
  const visual = scene.visual || scene.action || "Stickman berdiri di sebuah tempat";
  const lines = wrapText(visual, 42, 3);
  const caption = lines.map((line, i) => `<text x="360" y="170" text-anchor="middle" class="caption">${escapeXml(line)}</text>`).join("");
  const palette = ["#dbeafe", "#dcfce7", "#fef3c7", "#fce7f3", "#ede9fe"];
  const bg = palette[index % palette.length];
  const pose = index % 4;
  const arms = pose === 1 ? "M360 530 L270 455 M360 530 L450 455" : pose === 2 ? "M360 530 L260 570 M360 530 L460 570" : "M360 530 L275 590 M360 530 L445 590";
  const legs = pose === 3 ? "M360 690 L285 805 M360 690 L455 780" : "M360 690 L305 825 M360 690 L415 825";
  const charName = escapeXml(story.characters?.[0]?.name || "Stickman");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${bg}"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs>
  <rect width="720" height="1280" fill="url(#g)"/><circle cx="590" cy="270" r="90" fill="#ffffff" opacity=".45"/><path d="M0 930 Q180 850 360 930 T720 920 V1280 H0Z" fill="#94a3b8" opacity=".18"/>
  <text x="360" y="85" text-anchor="middle" font-family="Liberation Sans" font-size="27" font-weight="bold" fill="#1e293b">${title}</text>
  <text x="360" y="125" text-anchor="middle" font-family="Liberation Sans" font-size="22" fill="#475569">EPISODE ${Number(story.episode || 1)} • ADEGAN ${index + 1}</text>
  ${caption}
  <ellipse cx="360" cy="855" rx="125" ry="22" fill="#334155" opacity=".15"/>
  <circle cx="360" cy="405" r="72" fill="#ffffff" stroke="#111827" stroke-width="17"/>
  <path d="M360 477 L360 690 ${arms} ${legs}" fill="none" stroke="#111827" stroke-width="23" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="338" cy="398" r="7" fill="#111827"/><circle cx="382" cy="398" r="7" fill="#111827"/><path d="M340 435 Q360 452 382 435" fill="none" stroke="#111827" stroke-width="6" stroke-linecap="round"/>
  <rect x="55" y="1010" width="610" height="150" rx="24" fill="#0f172a" opacity=".88"/>
  <text x="85" y="1055" font-family="Liberation Sans" font-size="23" fill="#ffffff">${charName}</text>
  <text x="85" y="1100" font-family="Liberation Sans" font-size="19" fill="#e2e8f0">${escapeXml(wrapText(scene.action || "", 52, 2).join(" ").slice(0, 85))}</text>
  <text x="360" y="1220" text-anchor="middle" font-family="Liberation Sans" font-size="18" fill="#475569">AI STICKMAN SERIES FACTORY</text>
  </svg>`;
}

function normalizeStoryboard(input) {
  let data = input;
  if (typeof data === "string") {
    const cleaned = data.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    data = JSON.parse(cleaned);
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.scenes) || data.scenes.length === 0) {
    throw new Error("Storyboard tidak valid. Pastikan berisi array scenes dengan minimal satu adegan.");
  }
  data.scenes = data.scenes.slice(0, 30).map((s, i) => ({
    scene: Number(s.scene || i + 1), duration: Math.min(15, Math.max(3, Number(s.duration || 7))),
    visual: String(s.visual || "Adegan Stickman"), action: String(s.action || ""),
    dialogue: String(s.dialogue || ""), camera: String(s.camera || "")
  }));
  return data;
}

async function renderJob(jobId, storyboard, style) {
  const job = jobs.get(jobId); const work = path.join(os.tmpdir(), `stickman-${jobId}`);
  fs.mkdirSync(work, { recursive: true });
  try {
    job.status = "processing"; job.progress = 5; job.message = "Menyiapkan adegan";
    const sceneFiles = [];
    for (let i = 0; i < storyboard.scenes.length; i++) {
      const scene = storyboard.scenes[i];
      const svg = path.join(work, `scene-${i}.svg`); const png = path.join(work, `scene-${i}.png`);
      fs.writeFileSync(svg, makeSvg(storyboard, scene, i, style));
      await run("rsvg-convert", ["-o", png, svg]);
      const clip = path.join(work, `clip-${i}.mp4`);
      await run("ffmpeg", ["-y", "-loop", "1", "-i", png, "-t", String(scene.duration), "-vf", "scale=720:1280,zoompan=z='min(zoom+0.0007,1.04)':d=1:s=720x1280:fps=24,format=yuv420p", "-r", "24", "-an", "-c:v", "libx264", "-preset", "ultrafast", clip]);
      sceneFiles.push(clip);
      job.progress = 10 + Math.round((i + 1) / storyboard.scenes.length * 45);
      job.message = `Membuat animasi adegan ${i + 1} dari ${storyboard.scenes.length}`;
    }
    const list = path.join(work, "clips.txt");
    fs.writeFileSync(list, sceneFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
    const silentVideo = path.join(work, "silent.mp4");
    await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", silentVideo]);

    job.progress = 62; job.message = "Membuat suara Bahasa Indonesia";
    const speechFiles = [];
    for (let i = 0; i < storyboard.scenes.length; i++) {
      const text = storyboard.scenes[i].dialogue.trim();
      if (!text) continue;
      const wav = path.join(work, `voice-${i}.wav`);
      const pitch = i % 2 === 0 ? "48" : "62";
      await run("espeak-ng", ["-v", "id", "-s", "145", "-p", pitch, "-a", "165", "-w", wav, text]);
      speechFiles.push(wav);
    }
    let audioInput = null;
    if (speechFiles.length) {
      const voiceList = path.join(work, "voices.txt");
      fs.writeFileSync(voiceList, speechFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
      audioInput = path.join(work, "voice.wav");
      await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", voiceList, "-ar", "44100", "-ac", "2", audioInput]);
    }
    job.progress = 78; job.message = "Menambahkan musik dan menyelesaikan video";
    const outputName = `episode-${storyboard.episode || 1}-${jobId}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputName);
    const totalDuration = storyboard.scenes.reduce((sum, s) => sum + s.duration, 0);
    if (audioInput) {
      await run("ffmpeg", ["-y", "-i", silentVideo, "-i", audioInput, "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=44100", "-filter_complex", "[1:a]volume=1.0[voice];[2:a]volume=0.035,lowpass=f=900[music];[voice][music]amix=inputs=2:duration=longest[a]", "-map", "0:v", "-map", "[a]", "-t", String(totalDuration), "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", outputPath]);
    } else {
      await run("ffmpeg", ["-y", "-i", silentVideo, "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=44100", "-filter:a", "volume=0.04", "-t", String(totalDuration), "-c:v", "copy", "-c:a", "aac", "-shortest", "-movflags", "+faststart", outputPath]);
    }
    job.status = "completed"; job.progress = 100; job.message = "Video selesai dibuat";
    job.downloadUrl = `/output/${outputName}`;
  } catch (error) {
    console.error("Render gagal:", error);
    job.status = "failed"; job.message = error.message;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function generateWithAI(prompt) {
  if (!API_KEY) throw new Error("GEMINI_API_KEY belum diatur");
  let lastError = "";
  for (const model of MODELS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
          method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
          body: JSON.stringify({ model, input: prompt, store: false, response_format: { type: "text", mime_type: "application/json" }, generation_config: { thinking_level: "low" } })
        });
        const data = await response.json();
        if (!response.ok) {
          lastError = data.error?.message || data.message || JSON.stringify(data);
          if (attempt < 2 && [429, 500, 503].includes(response.status)) { await sleep(1500); continue; }
          break;
        }
        const output = (data.steps || []).filter(s => s.type === "model_output").flatMap(s => s.content || []).filter(c => c.type === "text").map(c => c.text).join("\n");
        if (!output) { lastError = "Model tidak memberikan hasil teks"; break; }
        const cleaned = output.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "").trim();
        return { model, result: JSON.parse(cleaned) };
      } catch (error) { lastError = error.message; break; }
    }
  }
  throw new Error("Semua model AI gagal. Penyebab terakhir: " + lastError);
}

app.get("/api/health", async (req, res) => {
  let ffmpeg = false, tts = false, svg = false;
  try { await run("ffmpeg", ["-version"]); ffmpeg = true; } catch {}
  try { await run("espeak-ng", ["--version"]); tts = true; } catch {}
  try { await run("rsvg-convert", ["--version"]); svg = true; } catch {}
  res.json({ success: true, app: "AI Stickman Series Factory", geminiConfigured: Boolean(API_KEY), renderer: { ffmpeg, indonesianTts: tts, svgRenderer: svg }, models: MODELS });
});

app.post("/api/story", async (req, res) => {
  try {
    const { title, genre = "Petualangan", episodes = 5, episode = 1, previousSummary = "" } = req.body;
    const prompt = `Buat storyboard serial Stickman YouTube Shorts berbahasa Indonesia. Judul: ${title || "Petualangan Stickman"}. Genre: ${genre}. Total episode: ${episodes}. Episode: ${episode}. Ringkasan sebelumnya: ${previousSummary || "Episode pertama."}. Buat 6-8 adegan berdurasi total 45-60 detik, karakter konsisten, dialog Indonesia, konflik menarik dan cliffhanger. Keluarkan JSON valid: {"title":"","episode":${episode},"characters":[{"name":"","description":"","voice":"male/female"}],"summary":"","scenes":[{"scene":1,"duration":7,"visual":"","action":"","dialogue":"","camera":""}],"ending":"","nextEpisodeHook":""}. Tanpa Markdown.`;
    const ai = await generateWithAI(prompt);
    res.json({ success: true, model: ai.model, story: ai.result });
  } catch (error) { console.error(error); res.status(502).json({ error: "Gagal membuat cerita", details: error.message }); }
});

app.post("/api/render", async (req, res) => {
  try {
    const storyboard = normalizeStoryboard(req.body.storyboard ?? req.body);
    const style = ["2D", "3D", "mix"].includes(req.body.style) ? req.body.style : "2D";
    const jobId = randomUUID();
    jobs.set(jobId, { id: jobId, status: "queued", progress: 0, message: "Menunggu render", downloadUrl: null });
    res.json({ success: true, jobId, message: "Storyboard diterima. Render dimulai." });
    renderJob(jobId, storyboard, style);
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.get("/api/render/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job tidak ditemukan" });
  res.json(job);
});

app.post("/api/upload", upload.single("video"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "File tidak ditemukan" });
  res.json({ success: true, filename: req.file.filename });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("AI Stickman Series Factory berjalan:", PORT);
  console.log("Gemini tersedia:", Boolean(API_KEY));
});
