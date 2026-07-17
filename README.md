# Stock Icon Metadata Generator (Netlify)

Web app pengganti notebook Colab — upload icon, generate title/description/keywords via
Gemini Vision (fallback Groq), export CSV. Nggak perlu Google Drive lagi, upload langsung dari browser.

## Cara deploy

1. **Push folder ini ke GitHub repo baru** (atau drag-drop folder ini langsung ke app.netlify.com/drop
   kalau mau coba cepat tanpa GitHub — tapi env variable tetap harus diset manual di dashboard).

2. Di **Netlify dashboard** → New site from Git → pilih repo ini. Build settings udah otomatis
   kebaca dari `netlify.toml` (publish = `public`, functions = `netlify/functions`).

3. Set **Environment variables** (Site settings → Environment variables):
   - `GEMINI_API_KEYS` = `key1,key2,key3` (pisah koma, boleh 1 key aja)
   - `GROQ_API_KEYS` = `key1,key2` (opsional, buat fallback kalau semua Gemini key gagal/limit)

4. Deploy. Buka URL site-nya, upload icon, generate, download CSV.

## Cara ganti niche keyword tetap

Nggak perlu edit kode — tinggal isi field **"Niche keywords tetap"** di halaman web-nya
sebelum klik Generate, misal:
```
america 250, 250th anniversary, us independence day, patriotic icon, red white blue, usa 2026
```
Ganti isi field itu tiap ganti batch (America 250 → Bento → dst), kosongin kalau nggak butuh.

## Keterbatasan vs notebook Colab

- Belum ada resume/skip otomatis kayak CSV incremental di notebook — kalau tab ke-close
  di tengah proses, hasil yang belum sempat di-download CSV bakal hilang. Untuk batch besar
  (100+ icon), disarankan proses per-batch kecil (misal 15-20 icon per run) dan langsung
  download CSV tiap selesai.
- Export CSV saat ini formatnya generik (cocok buat Adobe Stock & Shutterstock). Format khusus
  DepositPhotos/Magnific/MiriCanvas/Vecteezy (yang ada di notebook lama) belum ditambahin —
  kabarin kalau mau gue tambahin juga.
- Netlify Functions default timeout ~10 detik per request — cukup buat 1 gambar per call
  (yang emang cara app ini kerja), jadi harusnya aman.
