import electron from 'electron'
const { Menu, app } = electron

/** 菜单栏自动隐藏（Windows/Linux）：菜单本身保留（故 Ctrl+R 重载 / Ctrl+Shift+I 开
  *  DevTools / Ctrl+C·V·X 编辑快捷键都仍然有效），但顶部的「Bangumi / 编辑」菜单条
 *  默认不显示，按 Alt 才临时浮现。配合 main.ts 中 BrowserWindow 的 autoHideMenuBar:true。
 *  macOS 的菜单条始终显示（系统规范），且需保留 退出 / 关于。 */
export function buildMenu(): void {
  const editSubmenu: Electron.MenuItemConstructorOptions[] = [
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' }
  ]

  if (process.platform === 'darwin') {
    // macOS：标准应用菜单（含 关于 / 隐藏 / 退出），菜单条始终可见
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      { label: '编辑', submenu: editSubmenu }
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  } else {
    // Windows / Linux：保留菜单但默认隐藏菜单条（autoHideMenuBar 在 main.ts 设置）。
    // 含 重新加载 / 开发者工具（DevTools 快捷键 Ctrl+Shift+I）+ 退出，以及编辑子菜单。
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: app.name,
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      { label: '编辑', submenu: editSubmenu }
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }
}
