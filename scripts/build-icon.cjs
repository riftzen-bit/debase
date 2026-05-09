// One-shot build helper that turns resources/icon.svg into the PNG + ICO
// variants Electron and electron-builder expect:
//
//   resources/icon.png   1024×1024  (electron-builder picks this up cross-platform)
//   resources/icon.ico   16/24/32/48/64/128/256  (Windows multi-res)
//   resources/tray.png    256×256   (BrowserWindow icon at runtime, taskbar)
//
// Run with `bun run icon:build` (or `node scripts/build-icon.cjs`). The output
// is committed so contributors don't need sharp/png-to-ico in their CI image.

const path = require("node:path");
const fs = require("node:fs/promises");
const sharp = require("sharp");
// png-to-ico is an ESM module — CJS require returns the namespace object,
// so we reach for its default export.
const pngToIcoModule = require("png-to-ico");
const pngToIco = pngToIcoModule.default ?? pngToIcoModule;

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "resources", "icon.svg");
const OUT_DIR = path.join(ROOT, "resources");

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function renderPng(size, outPath) {
  // Density × svgWidth / 72 = rasterised pixel size. Our SVG is already 1024
  // intrinsic, so density=72 rasterises at 1024 (plenty for any downscale to
  // ≤1024). Higher densities blow past sharp's default pixel ceiling.
  const svg = await fs.readFile(SRC);
  await sharp(svg, { density: 72 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  // Big PNG: electron-builder uses this as the master and downscales for
  // each platform target. 1024 is the iOS/macOS recommendation; Windows ICO
  // is built separately so we don't need 1024 there.
  const masterPath = path.join(OUT_DIR, "icon.png");
  await renderPng(1024, masterPath);
  console.log("wrote", path.relative(ROOT, masterPath));

  // Runtime taskbar icon. 256 is plenty for both display modes Windows
  // currently scales between (32-px small, 256-px tile).
  const trayPath = path.join(OUT_DIR, "tray.png");
  await renderPng(256, trayPath);
  console.log("wrote", path.relative(ROOT, trayPath));

  // Build a temp dir of per-size PNGs so png-to-ico can pack them. Cleaning
  // up after avoids leaving crumbs in resources/.
  const tmp = path.join(OUT_DIR, "_ico-tmp");
  await fs.mkdir(tmp, { recursive: true });
  const sizedPaths = [];
  for (const size of ICO_SIZES) {
    const p = path.join(tmp, `icon-${size}.png`);
    await renderPng(size, p);
    sizedPaths.push(p);
  }
  const ico = await pngToIco(sizedPaths);
  const icoPath = path.join(OUT_DIR, "icon.ico");
  await fs.writeFile(icoPath, ico);
  console.log("wrote", path.relative(ROOT, icoPath));
  await fs.rm(tmp, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
