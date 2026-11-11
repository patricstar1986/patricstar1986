# Fremdsoftware in diesem Ordner

`sendspin.js` ist ein unverändertes Bündel (erstellt mit esbuild) aus diesen Paketen:

| Paket | Version | Lizenz | Quelle |
|---|---|---|---|
| @sendspin/sendspin-js | 5.0.0 | Apache-2.0 | https://github.com/Sendspin/sendspin-js |
| @noble/ciphers | 1.3.0 | MIT | https://github.com/paulmillr/noble-ciphers |
| @noble/curves | 1.9.7 | MIT | https://github.com/paulmillr/noble-curves |
| @noble/hashes | 1.8.0 | MIT | https://github.com/paulmillr/noble-hashes |
| opus-encdec | 0.1.1 | MIT | https://github.com/mmig/opus-encdec |

Version 5.0.0 ist dieselbe, die die Oberfläche von Music Assistant 2.10.9 verwendet.

Neu bauen:

```bash
npm install @sendspin/sendspin-js@5.0.0 esbuild
echo "export { SendspinPlayer } from '@sendspin/sendspin-js';" > entry.js
npx esbuild entry.js --bundle --format=esm --minify --target=es2020,safari15 --outfile=sendspin.js
```

Die vollständigen Lizenztexte liegen im Ordner `lizenzen/`.
