(() => {
  const mods = JSON.parse(decodeURIComponent(document.currentScript.dataset.mods));
  const failed = new Set();
  const report = (id, stage, error) => window.amicur.error(id, stage, String(error?.stack || error));
  function runtime(error, url) {
    const trace = String(url || '') + ' ' + String(error?.stack || '');
    const mod = mods.find(item => trace.includes('/__amicur/mod/' + item.id + '/'));
    if (mod) report(mod.id, 'runtime', error);
  }
  window.addEventListener('error', event => runtime(event.error || event.message, event.filename));
  window.addEventListener('unhandledrejection', event => runtime(event.reason));
  (async () => {
    for (const mod of mods) {
      try {
        const missing = mod.requires.find(id => failed.has(id));
        if (missing) throw new Error('Dependency failed: ' + missing);
        await import(mod.url);
      } catch (error) {
        failed.add(mod.id);
        report(mod.id, 'import', error);
      }
    }
  })();
})();
