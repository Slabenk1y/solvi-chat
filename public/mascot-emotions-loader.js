(() => {
  'use strict';
  const count = 9;
  const prefix = '/mascot-chunks/part-';
  Promise.all(Array.from({ length: count }, (_, index) => {
    const name = String(index + 1).padStart(2, '0');
    return fetch(prefix + name + '.txt', { cache: 'force-cache' }).then(response => {
      if (!response.ok) throw new Error('Mascot chunk ' + name + ' failed: ' + response.status);
      return response.text();
    });
  })).then(parts => {
    const encoded = parts.join('').trim();
    if (!encoded.startsWith('AAAAIGZ0eXBhdmlm')) throw new Error('Invalid mascot AVIF payload');
    document.documentElement.style.setProperty('--mascot-sprite', 'url("data:image/avif;base64,' + encoded + '")');
    document.documentElement.classList.add('mascot-sprite-ready');
  }).catch(error => console.warn('[SOLVI mascot] Sprite sheet fallback active:', error));
})();
