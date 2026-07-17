// Netlify Function: analyze satu gambar icon -> metadata JSON
// Env vars yang dibutuhin (set di Netlify dashboard -> Site settings -> Environment variables):
//   GEMINI_API_KEYS = "key1,key2,key3"   (pisah koma, boleh 1 aja)
//   GROQ_API_KEYS   = "key1,key2"        (opsional, fallback kalau semua Gemini gagal)

const GEMINI_MODEL = "gemini-2.5-flash";
const GROQ_MODEL = "qwen/qwen3.6-27b";

const ADOBE_CATEGORIES = [
  "Animals", "Buildings and architecture", "Business", "Drinks",
  "The environment", "States of mind", "Food", "Graphic resources",
  "Hobbies and leisure", "Industry", "Landscape", "Lifestyle",
  "People", "Plants and flowers", "Culture and religion", "Science",
  "Social issues", "Sports", "Technology", "Transport", "Travel",
];

const SHUTTERSTOCK_CATEGORIES = [
  "Abstract", "Animals/Wildlife", "Arts", "Backgrounds/Textures",
  "Beauty/Fashion", "Buildings/Landmarks", "Business/Finance", "Celebrities",
  "Education", "Food and Drink", "Healthcare/Medical", "Holidays",
  "Industrial", "Interiors", "Miscellaneous", "Nature", "Objects",
  "Parks/Outdoor", "People", "Religion", "Science", "Signs/Symbols",
  "Sports/Recreation", "Technology", "Transportation", "Vintage",
];

const REQUIRED_FIELDS = ["title", "description", "keywords", "adobe_category", "shutterstock_categories"];

function buildPrompt(nicheKeywords) {
  const adobeStr = ADOBE_CATEGORIES.map((c) => `"${c}"`).join(", ");
  const shutterStr = SHUTTERSTOCK_CATEGORIES.map((c) => `"${c}"`).join(", ");
  const nicheStr = (nicheKeywords || []).join(", ");
  const nicheInstruction = nicheKeywords && nicheKeywords.length
    ? `WAJIB sisipkan keyword tetap berikut ini di SEMUA gambar dalam batch ini, selain keyword spesifik objek yang terlihat di gambar: ${nicheStr}.\n`
    : "";

  return `Kamu adalah asisten metadata untuk Adobe Stock vector icon.
Lihat gambar icon yang diberikan, lalu buatkan metadata dalam format JSON PERSIS seperti ini,
tanpa teks tambahan, tanpa markdown code block:

{
  "title": "judul singkat deskriptif berdasarkan isi gambar (jangan paksa nyebut niche kalau objeknya nggak langsung relevan), maksimal 70 karakter, dalam bahasa Inggris, TANPA tanda koma",
  "description": "1-2 kalimat deskripsi lebih detail tentang isi visual gambar, dalam bahasa Inggris, maksimal 200 karakter",
  "keywords": ["keyword1", "keyword2", "... total 25-49 keyword relevan berdasarkan isi visual gambar, urutan dari paling penting, TANPA duplikat"],
  "adobe_category": "pilih PERSIS SATU dari daftar ini (salin persis, case-sensitive): [${adobeStr}]",
  "shutterstock_categories": ["pilih 1 sampai 2 dari daftar ini (salin persis): [${shutterStr}]"]
}

Field wajib ada semua: title, description, keywords, adobe_category, shutterstock_categories.
adobe_category HARUS salah satu string persis dari daftar Adobe di atas, jangan bikin kategori sendiri.
shutterstock_categories HARUS 1-2 string persis dari daftar Shutterstock di atas.
${nicheInstruction}Jangan mengulang kata yang sama persis di title dan description.
`;
}

function parseJsonResponse(text) {
  let cleaned = (text || "").trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
  }
  try {
    const data = JSON.parse(cleaned);
    if (REQUIRED_FIELDS.every((k) => k in data)) return data;
  } catch (e) {
    // fallthrough
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      const data = JSON.parse(cleaned.slice(start, end + 1));
      if (REQUIRED_FIELDS.every((k) => k in data)) return data;
    } catch (e) {
      // fallthrough
    }
  }
  return null;
}

async function callGemini(imageB64, mimeType, apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mimeType, data: imageB64 } },
          { text: prompt },
        ],
      }],
      generationConfig: { temperature: 0.7 },
    }),
  });
  if (resp.status === 429) throw { rateLimited: true };
  if (!resp.ok) throw new Error(`gemini bad status ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  return data.candidates[0].content.parts[0].text;
}

async function callGroq(imageB64, mimeType, apiKey, prompt) {
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageB64}` } },
        ],
      }],
      temperature: 0.7,
      reasoning_effort: "none",
    }),
  });
  if (resp.status === 429) throw { rateLimited: true };
  if (!resp.ok) throw new Error(`groq bad status ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  return data.choices[0].message.content;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: "Invalid JSON body" };
  }

  const { imageB64, mimeType, nicheKeywords } = body;
  if (!imageB64) {
    return { statusCode: 400, body: JSON.stringify({ error: "imageB64 wajib diisi" }) };
  }

  const geminiKeys = (process.env.GEMINI_API_KEYS || "").split(",").map((k) => k.trim()).filter(Boolean);
  const groqKeys = (process.env.GROQ_API_KEYS || "").split(",").map((k) => k.trim()).filter(Boolean);
  const prompt = buildPrompt(nicheKeywords);

  const errors = [];

  if (geminiKeys.length === 0 && groqKeys.length === 0) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: "GEMINI_API_KEYS dan GROQ_API_KEYS kosong/belum keset di environment variables. Cek Site configuration > Environment variables, lalu redeploy." }),
    };
  }

  for (const key of geminiKeys) {
    const label = `gemini ...${key.slice(-4)}`;
    try {
      const raw = await callGemini(imageB64, mimeType || "image/png", key, prompt);
      const parsed = parseJsonResponse(raw);
      if (parsed) return { statusCode: 200, body: JSON.stringify({ ok: true, source: "gemini", ...parsed }) };
      errors.push(`${label}: responded but JSON invalid (raw: ${String(raw).slice(0, 150)})`);
    } catch (e) {
      errors.push(`${label}: ${e.rateLimited ? "rate limited (429)" : String(e.message || e)}`);
    }
  }

  for (const key of groqKeys) {
    const label = `groq ...${key.slice(-4)}`;
    try {
      const raw = await callGroq(imageB64, mimeType || "image/png", key, prompt);
      const parsed = parseJsonResponse(raw);
      if (parsed) return { statusCode: 200, body: JSON.stringify({ ok: true, source: "groq", ...parsed }) };
      errors.push(`${label}: responded but JSON invalid (raw: ${String(raw).slice(0, 150)})`);
    } catch (e) {
      errors.push(`${label}: ${e.rateLimited ? "rate limited (429)" : String(e.message || e)}`);
    }
  }

  return {
    statusCode: 502,
    body: JSON.stringify({ ok: false, error: `Semua key gagal.`, details: errors }),
  };
};
