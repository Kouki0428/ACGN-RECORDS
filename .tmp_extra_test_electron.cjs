module.exports = {
  app: { getPath: () => require('node:os').tmpdir(), whenReady: () => Promise.resolve() },
  ipcMain: { handle(){}, on(){} },
  BrowserWindow: function(){},
  safeStorage: { isEncryptionAvailable: () => false, encryptString: s=>s, decryptString: s=>s },
  shell: { openExternal(){} },
  protocol: { registerSchemesAsPrivileged(){}, handle(){} }
}
