import { contextBridge, ipcRenderer } from 'electron';
import type { GameApi } from '../shared/types.js';

const api: GameApi = {
  strings: () => ipcRenderer.invoke('game:strings'),
  modLocale: id => ipcRenderer.invoke('game:mod-locale', id),
  modSettings: id => ipcRenderer.invoke('game:mod-settings', id),
  language: language => ipcRenderer.invoke('game:language', language),
  subscribe: callback => {
    const listener = () => callback();
    ipcRenderer.on('game:changed', listener);
    return () => ipcRenderer.removeListener('game:changed', listener);
  },
  error: (id, stage, message) => ipcRenderer.send('game:error', id, stage, message),
  capture: entries => ipcRenderer.send('game:capture', entries),
  saves: () => ipcRenderer.invoke('game:saves'),
  read: save => ipcRenderer.invoke('game:read', save),
};

contextBridge.exposeInMainWorld('amicur', api);
