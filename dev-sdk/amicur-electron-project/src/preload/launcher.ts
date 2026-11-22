import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { LauncherApi } from '../shared/types.js';

const api: LauncherApi = {
  state: () => ipcRenderer.invoke('launcher:state'),
  settings: settings => ipcRenderer.invoke('launcher:settings', settings),
  options: folder => ipcRenderer.invoke('launcher:options', folder),
  optionsSave: (folder, language, mods, values) => ipcRenderer.invoke('launcher:options-save', folder, language, mods, values),
  onModError: callback => { ipcRenderer.on('launcher:mod-error', (_event, folder) => callback(folder)); },
  dropMod: (file, folder) => ipcRenderer.invoke('launcher:drop', webUtils.getPathForFile(file), folder),
  report: (folder, copy) => ipcRenderer.invoke('launcher:report', folder, copy),
  releaseSetting: (folder, action) => ipcRenderer.invoke('launcher:release-setting', folder, action),
  release: (action, folder, name) => ipcRenderer.invoke('launcher:release', action, folder, name),
  launch: (folder, clean) => ipcRenderer.invoke('launcher:launch', folder, clean),
  open: (place, folder) => ipcRenderer.invoke('launcher:open', place, folder),
  update: install => ipcRenderer.invoke('launcher:update', install),
  subscribe: callback => {
    const listener = () => callback();
    ipcRenderer.on('launcher:changed', listener);
    return () => ipcRenderer.removeListener('launcher:changed', listener);
  },
};

contextBridge.exposeInMainWorld('launcher', api);
