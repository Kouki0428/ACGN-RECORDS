import electron from 'electron'
const { Menu, app } = electron

/** 移除原生菜单栏（Windows/Linux）：应用顶部的「ACGN Records / 编辑」菜单条不再显示，
 *  让窗口只剩自渲染内容区（边栏 + 主区）。macOS 必须保留应用菜单（含退出/关于），故仅桌面端移除。
 *  注意：复制/剪切/粘贴（Ctrl+C/V/X）等编辑快捷键由渲染进程 Web 内容原生处理，移除菜单不受影响；
 *  F12 默认不再打开 DevTools，开发期调试改用 `win.webContents.openDevTools()` 或 vite-plugin-electron
 *  的 openDevTools 配置。 */
export function buildMenu(): void {
  if (process.platform === 'darwin') {
    // macOS：保留极简应用菜单（否则无 退出 / 关于）
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      }
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  } else {
    // Windows / Linux：直接移除应用菜单栏（顶部的「ACGN Records / 编辑」条消失）
    Menu.setApplicationMenu(null)
  }
}
