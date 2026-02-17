const GRADIENTS: [string, string][] = [
    ['#667eea', '#764ba2'],
    ['#f093fb', '#f5576c'],
    ['#4facfe', '#00f2fe'],
    ['#43e97b', '#38f9d7'],
    ['#fa709a', '#fee140'],
    ['#a18cd1', '#fbc2eb'],
    ['#ffecd2', '#fcb69f'],
    ['#ff9a9e', '#fecfef'],
    ['#a1c4fd', '#c2e9fb'],
    ['#fd7043', '#ff8a65'],
    ['#26c6da', '#00acc1'],
    ['#66bb6a', '#43a047'],
];

function getGradient(name: string): [string, string] {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

export function generateAvatarSvg(name: string, size = 36): string {
    const letter = (name || '?').charAt(0).toUpperCase();
    const [c1, c2] = getGradient(name || '?');
    const fontSize = Math.round(size * 0.42);
    const id = `grad-${Math.random().toString(36).slice(2)}`;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="${id}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${c1}"/>
      <stop offset="100%" style="stop-color:${c2}"/>
    </linearGradient>
  </defs>
  <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="url(#${id})"/>
  <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle"
    font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    font-size="${fontSize}" font-weight="600" fill="white">${letter}</text>
</svg>`;
}

export function generateAvatarUrl(name: string, size = 36): string {
    const svg = generateAvatarSvg(name, size);
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/**
 * Sets an <img> src to either the real photoURL or a generated avatar.
 * Falls back gracefully if the real photo fails to load.
 */
export function setAvatar(imgEl: HTMLImageElement, photoURL: string | null | undefined, name: string, size = 36) {
    if (photoURL) {
        imgEl.src = photoURL;
        imgEl.onerror = () => {
            imgEl.onerror = null;
            imgEl.src = generateAvatarUrl(name, size);
        };
    } else {
        imgEl.src = generateAvatarUrl(name, size);
    }
}
