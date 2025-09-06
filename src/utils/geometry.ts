import { Doodad } from '../types';

export interface Extents { minX: number; maxX: number; minY: number; maxY: number; }

export function computeExtents(doodads: Doodad[]): Extents {
    if (!doodads.length) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    let minX = doodads[0].x, maxX = doodads[0].x, minY = doodads[0].y, maxY = doodads[0].y;
    for (const d of doodads) {
        if (d.x < minX) minX = d.x;
        if (d.x > maxX) maxX = d.x;
        if (d.y < minY) minY = d.y;
        if (d.y > maxY) maxY = d.y;
    }
    if (minX === maxX) maxX += 1;
    if (minY === maxY) maxY += 1;
    return { minX, maxX, minY, maxY };
}

export function pointInPolygon(px: number, py: number, polygon: [number, number][]): boolean {
    // ray casting
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-9) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

export function rotateAround(x: number, y: number, cx: number, cy: number, deg: number): [number, number] {
    if (!deg) return [x, y];
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const dx = x - cx, dy = y - cy;
    const rx = dx * cos - dy * sin + cx;
    const ry = dx * sin + dy * cos + cy;
    return [rx, ry];
}
