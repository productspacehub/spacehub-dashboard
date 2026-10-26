// Kept apart from addressImport.ts so the mapping page can show it without
// pulling server code into the browser bundle.
export const LLM_PROMPT = `Saya punya daftar alamat pelanggan di Indonesia dalam file CSV terlampir (kolom: id, alamat, terdeteksi). Untuk setiap baris, tentukan lokasinya berdasarkan nama gedung, apartemen, perumahan, jalan, atau area di alamat.

Kembalikan CSV dengan kolom persis: id,kecamatan,kota_kabupaten,provinsi,status

Aturan:
- Salin id persis seperti aslinya, satu baris untuk setiap id.
- Pakai nama wilayah resmi Kemendagri, mis. kecamatan "Setiabudi", kota_kabupaten "Kota Jakarta Selatan" atau "Kabupaten Bogor", provinsi "DKI Jakarta".
- status = "ok" kalau Anda yakin, "tidak yakin" kalau tidak tahu pasti — jangan menebak. Pakai "luar negeri" kalau alamatnya di luar Indonesia.
- Kalau hanya yakin sampai kota/kabupaten, kosongkan kecamatan. Kalau hanya yakin provinsinya, kosongkan kecamatan dan kota_kabupaten.
- Kolom "terdeteksi" adalah hasil deteksi otomatis dari teks alamat. Jangan bertentangan dengannya kecuali Anda yakin.
- Balas hanya dengan CSV di dalam satu blok kode, tanpa penjelasan.`;
