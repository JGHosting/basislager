"""
Wandelt den BLS 4.0 (Excel, Max Rubner-Institut, CC BY 4.0) in eine kompakte JSON-Datei für die App um.
Aufruf: python3 scripts/convert-bls.py <BLS_4_0_Daten_2025_DE.xlsx> public/data/bls-4.0.json
Rohdaten liegen auf dem Branch "data-raw" (raw/bls/...).

Format: {"v":"4.0","fields":[...],"cats":{...},"rows":[[code,name,kcal,protein,fett,kh,ballast,zucker,salz], ...]}
Werte pro 100 g; fehlende Werte = null (nie 0).
"""
import sys, json, openpyxl

CATS = {
  'B': 'Brot', 'C': 'Getreide', 'D': 'Backwaren', 'E': 'Teigwaren', 'F': 'Obst', 'G': 'Gemüse',
  'H': 'Hülsenfrüchte & Nüsse', 'K': 'Kartoffeln & Pilze', 'M': 'Milch & Käse', 'N': 'Getränke',
  'P': 'Alkoholische Getränke', 'Q': 'Fette & Öle', 'R': 'Würzmittel & Soßen', 'S': 'Süßwaren',
  'T': 'Fisch', 'U': 'Fleisch', 'V': 'Geflügel & Wild', 'W': 'Wurst', 'X': 'Gerichte', 'Y': 'Gerichte'
}
FIELDS = ['ENERCC', 'PROT625', 'FAT', 'CHO', 'FIBT', 'SUGAR', 'NACL']

def num(v):
    if v is None or v == '' or v == '-': return None
    try: return round(float(v), 2)
    except (TypeError, ValueError): return None

src, dst = sys.argv[1], sys.argv[2]
ws = openpyxl.load_workbook(src, read_only=True).active
rows = ws.iter_rows(values_only=True)
hdr = next(rows)
idx = {h.split(' ')[0]: i for i, h in enumerate(hdr) if h and '[' in str(h)}
out = []
for r in rows:
    if not r[0]: continue
    vals = [num(r[idx[f]]) for f in FIELDS]
    if vals[6] is None and num(r[idx['NA']]) is not None:          # Salz aus Natrium (mg → g Salz)
        vals[6] = round(num(r[idx['NA']]) * 2.54 / 1000, 3)
    out.append([r[0], r[1].strip()] + vals)
json.dump({
    'v': '4.0',
    'source': 'Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0 – Deutsche Nährstoffdatenbank. Karlsruhe. DOI: 10.25826/Data20251217-134202-0. Lizenz: CC BY 4.0. Auszug (Energie, Makronährstoffe, Ballaststoffe, Zucker, Salz) für Basislager umgewandelt.',
    'fields': ['code', 'name', 'kcal', 'protein', 'fat', 'carbs', 'fiber', 'sugar', 'salt'],
    'cats': CATS, 'rows': out
}, open(dst, 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(out), 'Lebensmittel')
