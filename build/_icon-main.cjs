
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

  const full = await shoot(win, "C:\\Users\\Mandz\\Websites\\Nexus Reader\\build\\_icon-full.html")
  process.stdout.write('ICON:' + full.toPNG().toString('base64') + '\n')
  for (const size of [32,48,64,128,256]) {
    const small = full.resize({ width: size, height: size, quality: 'best' })
    process.stdout.write('SIZE:' + size + ':' + small.toPNG().toString('base64') + '\n')
  }

  const reduced = await shoot(win, "C:\\Users\\Mandz\\Websites\\Nexus Reader\\build\\_icon-reduced.html")
  for (const size of [16,24]) {
    const small = reduced.resize({ width: size, height: size, quality: 'best' })
    process.stdout.write('SIZE:' + size + ':' + small.toPNG().toString('base64') + '\n')
  }

  app.quit()
})
