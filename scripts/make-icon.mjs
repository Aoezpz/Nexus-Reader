/**
 * Renders the app icon - the server's phoenix on a navy plate - using
 * Electron itself.
 *
 * No image toolchain: the icon is a small HTML page (the plate as SVG, the
 * phoenix as an <img>) rendered offscreen at 1024px and written to
 * build/icon.png. The phoenix is the site's own mark, `build/phoenix-mark.png`
 * (the 620px copy of artwork/phoenix-mark.png from the website repo): the
 * bird in its fire ring on a black ground. Screen-blending it over the plate
 * makes the black vanish and leaves the fire, which is why no alpha has to be
 * keyed out of it here.
 *
 * It also writes build/icon.ico, and that one is not a convenience. Embedding
 * an icon into the executable needs an .ico, and the electron-builder step
 * that would produce one first extracts a cache archive full of macOS
 * symlinks - which needs a Windows privilege a normal account does not have,
 * so it fails and the exe ships with Electron's generic atom. Writing the .ico
 * here sidesteps that entirely: the format is a header, a table and a run of
 * PNGs, and Windows has read PNG-in-ICO since Vista.
 *
 * TWO crops are rendered, not one. Downscaled to 16px the whole ring is an
 * orange smudge, so the small entries come from a tighter crop - the head and
 * the shoulders of the wings - which still reads as a bird at tray size.
 *
 *   node scripts/make-icon.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'build', 'icon.png')
mkdirSync(dirname(out), { recursive: true })

/**
 * The plate. A transparent icon disappears on a dark taskbar, and the fire on
 * its own has no edge. The site's navy, lit from below in its red, with the
 * same rounded corner every entry shares.
 */
const PLATE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="1024" height="1024" style="position:absolute;inset:0">
  <defs>
    <radialGradient id="plate" cx="50%" cy="30%" r="80%">
      <stop offset="0" stop-color="#1c2740"/><stop offset="1" stop-color="#06090f"/>
    </radialGradient>
    <radialGradient id="coals" cx="50%" cy="100%" r="70%">
      <stop offset="0" stop-color="#d0343f" stop-opacity=".28"/><stop offset="1" stop-color="#d0343f" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="1.5" y="1.5" width="45" height="45" rx="10.5" fill="url(#plate)"/>
  <rect x="1.5" y="1.5" width="45" height="45" rx="10.5" fill="url(#coals)"/>
</svg>`

/**
 * The bird, framed. `object-fit: cover` on the 620x372 source fills the
 * square with its middle, `object-position` decides which middle, and the
 * radial mask lets the ring's edges dissolve into the plate rather than end
 * at a crop line. The clip keeps the fire inside the plate's corner radius.
 */
const bird = (transform) => `<img src="phoenix-mark.png" alt="" style="
  position:absolute; left:6%; top:6%; width:88%; height:88%;
  object-fit:cover; object-position:50% 42%;
  mix-blend-mode:screen;
  clip-path:inset(0 round 20%);
  -webkit-mask-image:radial-gradient(ellipse 52% 52% at 50% 50%, #000 56%, transparent 82%);
  mask-image:radial-gradient(ellipse 52% 52% at 50% 50%, #000 56%, transparent 82%);
  transform:${transform}; transform-origin:50% 40%;">`

const FULL = `${PLATE}${bird('none')}`
/** Head and shoulders only, so a 16px entry is a bird and not a blaze. */
const REDUCED = `${PLATE}${bird('scale(1.75)')}`

// overflow:hidden matters: without it the transparent window renders its
// scrollbars and they end up baked into the corner of the icon. The page is
// written next to the phoenix so the <img> resolves by relative path - a data
// URL would have to carry the whole PNG inline.
const page = (body) => `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}
#icon{position:relative;width:1024px;height:1024px;overflow:hidden}</style>
<div id="icon">${body}</div>`

const PAGE_FULL = join(root, 'build', '_icon-full.html')
const PAGE_REDUCED = join(root, 'build', '_icon-reduced.html')
writeFileSync(PAGE_FULL, page(FULL))
writeFileSync(PAGE_REDUCED, page(REDUCED))

/**
 * Sizes baked into the .ico.
 *
 * Windows picks per context - 16 in the title bar and Explorer's detail view,
 * 32 on the desktop, 48 in the taskbar's jump list, 256 in the large-icon
 * view. Shipping only the big one leaves Windows to downscale, and a
 * hairline-heavy mark like this one turns to mush when it does.
 */
const SIZES = [32, 48, 64, 128, 256]
/** Below this the outer bars stop resolving - see the header. */
const SMALL_SIZES = [16, 24]

// A tiny Electron main script: load each artwork, capture it, print base64.
// The full mark is also the source for build/icon.png.
const MAIN = `
const { app, BrowserWindow } = require('electron')
app.disableHardwareAcceleration()

async function shoot(win, file) {
  await win.loadFile(file)
  // One frame is not always enough for the image to decode and the blend to
  // be composited.
  await new Promise((r) => setTimeout(r, 900))
  return win.webContents.capturePage()
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024, height: 1024, show: false, frame: false, transparent: true,
    webPreferences: { offscreen: false }
  })

  const full = await shoot(win, ${JSON.stringify(PAGE_FULL)})
  process.stdout.write('ICON:' + full.toPNG().toString('base64') + '\\n')
  for (const size of ${JSON.stringify(SIZES)}) {
    const small = full.resize({ width: size, height: size, quality: 'best' })
    process.stdout.write('SIZE:' + size + ':' + small.toPNG().toString('base64') + '\\n')
  }

  const reduced = await shoot(win, ${JSON.stringify(PAGE_REDUCED)})
  for (const size of ${JSON.stringify(SMALL_SIZES)}) {
    const small = reduced.resize({ width: size, height: size, quality: 'best' })
    process.stdout.write('SIZE:' + size + ':' + small.toPNG().toString('base64') + '\\n')
  }

  app.quit()
})
`

/**
 * Pack PNGs into an .ico.
 *
 * A six-byte header, then one sixteen-byte entry per image, then the images.
 * Width and height are single bytes, so 256 is written as 0 - the one piece of
 * the format that surprises people.
 */
function buildIco(images) {
  const HEADER = 6
  const ENTRY = 16
  const header = Buffer.alloc(HEADER)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // 1 = icon
  header.writeUInt16LE(images.length, 4)

  const entries = Buffer.alloc(ENTRY * images.length)
  let offset = HEADER + ENTRY * images.length

  images.forEach((img, i) => {
    const at = i * ENTRY
    entries.writeUInt8(img.size >= 256 ? 0 : img.size, at)
    entries.writeUInt8(img.size >= 256 ? 0 : img.size, at + 1)
    entries.writeUInt8(0, at + 2) // palette size, 0 for truecolor
    entries.writeUInt8(0, at + 3) // reserved
    entries.writeUInt16LE(1, at + 4) // color planes
    entries.writeUInt16LE(32, at + 6) // bits per pixel
    entries.writeUInt32LE(img.data.length, at + 8)
    entries.writeUInt32LE(offset, at + 12)
    offset += img.data.length
  })

  return Buffer.concat([header, entries, ...images.map((i) => i.data)])
}

const tmp = join(root, 'build', '_icon-main.cjs')
writeFileSync(tmp, MAIN)

// Strip ELECTRON_RUN_AS_NODE for the same reason scripts/dev.mjs does.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const child = spawn(electron, [tmp], { env })

let buffer = ''
child.stdout.on('data', (d) => {
  buffer += d.toString()
})
child.stderr.on('data', (d) => process.stderr.write(d))

child.on('exit', () => {
  rmSync(PAGE_FULL, { force: true })
  rmSync(PAGE_REDUCED, { force: true })
  const match = /ICON:([A-Za-z0-9+/=]+)/.exec(buffer)
  if (!match) {
    console.error('icon render produced no image')
    process.exit(1)
  }
  writeFileSync(out, Buffer.from(match[1], 'base64'))
  console.log(`wrote ${out}`)

  const images = []
  for (const line of buffer.split('\n')) {
    const m = /^SIZE:(\d+):([A-Za-z0-9+/=]+)$/.exec(line.trim())
    if (m) images.push({ size: Number(m[1]), data: Buffer.from(m[2], 'base64') })
  }

  const want = SIZES.length + SMALL_SIZES.length
  if (images.length !== want) {
    console.error(`expected ${want} resized images, got ${images.length}; .ico not written`)
    process.exit(1)
  }

  // Largest first is what most tools expect to find at the top of the table.
  images.sort((a, b) => b.size - a.size)
  const ico = join(root, 'build', 'icon.ico')
  writeFileSync(ico, buildIco(images))
  console.log(`wrote ${ico} (${images.map((i) => i.size).join(', ')})`)
})
