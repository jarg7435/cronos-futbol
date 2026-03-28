import os

filepath = 'js/00_firebase_init.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Quitar la asignacion del final
content = content.replace('window._checkAuthorization = checkAuthorization;', '')
# Asignar la funcion directamente cuando se declara (hoisting natural)
content = content.replace('async function checkAuthorization(user)', 'window._checkAuthorization = async function checkAuthorization(user)')
# También asignarla explícitamente a cronos_auth para doble seguridad
content = content.replace('doc, getDoc, setDoc, serverTimestamp', 'doc, getDoc, setDoc, serverTimestamp, checkAuthorization: window._checkAuthorization')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

# Update index.html to use both checks just in case
index_path = 'index.html'
with open(index_path, 'r', encoding='utf-8') as f:
    idx = f.read()
idx = idx.replace('await window._checkAuthorization(cred.user);', 'if (window._checkAuthorization) { await window._checkAuthorization(cred.user); } else if (fa.checkAuthorization) { await fa.checkAuthorization(cred.user); } else { throw new Error("checkAuth not found"); }')
with open(index_path, 'w', encoding='utf-8') as f:
    f.write(idx)

# Update sw.js cache name to force users to get latest
sw_path = 'sw.js'
with open(sw_path, 'r', encoding='utf-8') as f:
    sw = f.read()
sw = sw.replace("'cronos-cache-v7.0'", "'cronos-cache-v7.1'")
with open(sw_path, 'w', encoding='utf-8') as f:
    f.write(sw)
