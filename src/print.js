import { buildSvg } from './svg-export.js';

/**
 * Opens the drawing in a new browser window and triggers the print dialog.
 * The window is closed automatically once printing finishes.
 * Requires the browser to allow pop-ups; shows an alert if they are blocked.
 *
 * @param {object[]} shapes - Array of shape objects to render.
 * @param {number} width - Canvas width in pixels.
 * @param {number} height - Canvas height in pixels.
 */
export function printDrawing(shapes, width, height) {
    const svg = buildSvg(shapes, width, height);
    const win = window.open('', '_blank');
    if (!win) { alert('Allow popups to print.'); return; }

    win.document.title = 'MacDraw';
    const style = win.document.createElement('style');
    style.textContent = '* { margin: 0 } body { background: white } svg { max-width: 100%; height: auto; display: block } @media print { @page { margin: 10mm; size: auto } }';
    win.document.head.appendChild(style);
    win.document.body.innerHTML = svg;
    win.addEventListener('afterprint', () => win.close());
    setTimeout(() => win.print(), 100);
}
