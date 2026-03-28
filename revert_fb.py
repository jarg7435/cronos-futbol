with open('js/00_firebase_init.js', 'r', encoding='utf-8') as f:
    fb_code = f.read()

with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

inline_script = f'<script type="module">\n{fb_code}\n</script>'
html = html.replace('<script type="module" src="js/00_firebase_init.js"></script>', inline_script)

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)

with open('sw.js', 'r', encoding='utf-8') as f:
    sw = f.read()
sw = sw.replace("'cronos-cache-v7.2'", "'cronos-cache-v7.3'")
with open('sw.js', 'w', encoding='utf-8') as f:
    f.write(sw)
