from pathlib import Path
p=Path('index.html')
s=p.read_text()
s=s.replace('./src/app.js?v=4.2','./src/app.js?v=4.3')
s=s.replace('Version 4.2','Version 4.3')
p.write_text(s)

p=Path('sw.js')
s=p.read_text()
s=s.replace("const CACHE='wft-shell-v7';","const CACHE='wft-shell-v8';")
start=s.index('const SHELL=')
end=s.index(';',start)+1
s=s[:start]+"const SHELL=['./','./index.html','./assets/app.css?v=4.2','./src/app.js?v=4.3','./src/room.js','./src/block-transfer.js','./src/storage.js','./src/presence-peer.js','./src/presence-db.js','./src/main-peer.js','./favicon.svg','./manifest.webmanifest','./connection-config.json'];"+s[end:]
p.write_text(s)
