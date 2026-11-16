// The main process for tests that only need a browser window to point at a page.
const { app, BrowserWindow } = require('electron');

app.whenReady().then(() => new BrowserWindow({ show: false, width: 1400, height: 900 }).loadURL('about:blank'));
