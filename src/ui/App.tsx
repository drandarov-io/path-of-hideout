import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Hideout, Doodad, RawHideoutFile } from '../types';
import { colorForIndex, indexForColor } from '../utils/colors';
import { computeExtents, pointInPolygon, rotateAround } from '../utils/geometry';

interface LassoState { active: boolean; points: [number, number][]; }

const App: React.FC = () => {
    type ViewBoxState = { x: number; y: number; w: number; h: number };

    const [hideouts, setHideouts] = useState<Hideout[]>([]);
    const [lasso, setLasso] = useState<LassoState>({ active: false, points: [] });
    const [selection, setSelection] = useState<Set<string>>(new Set());
    const svgRef = useRef<SVGSVGElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [dragActive, setDragActive] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);
    const [rotation, setRotation] = useState<number>(0);
    const [meta, setMeta] = useState<{ version?: any; language?: any; hideout_name?: any; hideout_hash?: any } | null>(null);
    const metaRef = useRef<typeof meta>(null);
    const [selectionScope, setSelectionScope] = useState<string>('ALL'); // 'ALL' or hideout id
    const [view, setView] = useState<ViewBoxState | null>(null);
    const [userViewDirty, setUserViewDirty] = useState(false);
    const [panning, setPanning] = useState(false);
    const panLastRef = useRef<[number, number] | null>(null);
    const [spacePressed, setSpacePressed] = useState(false);
    const panLastScreenRef = useRef<[number, number] | null>(null);
    const [showLabels, setShowLabels] = useState(false);
    const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number; text: string } | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    React.useEffect(() => {
        const root = document.documentElement;
        if (showLabels && hoverInfo) {
            root.style.setProperty('--tooltip-x', `${hoverInfo.x}px`);
            root.style.setProperty('--tooltip-y', `${hoverInfo.y}px`);
        } else {
            root.style.setProperty('--tooltip-x', `-9999px`);
            root.style.setProperty('--tooltip-y', `-9999px`);
        }
    }, [showLabels, hoverInfo]);

    const allVisibleDoodads = useMemo(() => hideouts.filter(h => h.visible).flatMap(h => h.doodads), [hideouts]);
    const allDoodads = useMemo(() => hideouts.flatMap(h => h.doodads), [hideouts]);
    const extents = useMemo(() => computeExtents(allDoodads), [allDoodads]);

    // Fit viewBox to content by default
    const fittedView = useMemo((): ViewBoxState => {
        const pad = 20;
        const w = (extents.maxX - extents.minX) + pad * 2;
        const h = (extents.maxY - extents.minY) + pad * 2;
        return { x: extents.minX - pad, y: extents.minY - pad, w, h };
    }, [extents]);

    React.useEffect(() => {
        if (!userViewDirty) setView(fittedView);
    }, [fittedView, userViewDirty]);

    React.useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); setSpacePressed(true); } };
        const onKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); setSpacePressed(false); } };
        window.addEventListener('keydown', onKeyDown, { capture: true } as any);
        window.addEventListener('keyup', onKeyUp, { capture: true } as any);
        return () => {
            window.removeEventListener('keydown', onKeyDown, { capture: true } as any);
            window.removeEventListener('keyup', onKeyUp, { capture: true } as any);
        };
    }, []);

    const ingestHideoutFiles = useCallback((files: File[]) => {
        if (!files.length) return;
        files.filter(f => f.name.toLowerCase().endsWith('.hideout')).forEach(file => {
            const reader = new FileReader();
            reader.onerror = () => setErrors(prev => [...prev, `Read error: ${file.name}`]);
            reader.onload = () => {
                try {
                    let text = String(reader.result ?? '');
                    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
                    // Transform doodads object with potentially duplicate keys into an array so duplicates are preserved.
                    text = transformDoodadsObjectToArray(text);
                    const json = JSON.parse(text) as RawHideoutFile;
                    const { version, language, hideout_name, hideout_hash } = (json as any) ?? {};
                    // Enforce consistent hideout identity across all imports in this session.
                    const current = metaRef.current;
                    if (current && (current.hideout_hash !== hideout_hash)) {
                        setErrors(p => [...p, `Import error: ${file.name} has a different hideout (expected "${current.hideout_name}" #${current.hideout_hash}, got "${hideout_name}" #${hideout_hash}).`]);
                        return; // skip this file
                    }
                    if (!current) {
                        const nextMeta = { version, language, hideout_name, hideout_hash } as const;
                        metaRef.current = nextMeta;
                        setMeta(nextMeta);
                    }
                    const doodadsRaw: any = (json as any).doodads;
                    let parsed: any[] = [];
                    if (Array.isArray(doodadsRaw)) parsed = doodadsRaw;
                    else if (doodadsRaw && typeof doodadsRaw === 'object') parsed = Object.entries(doodadsRaw).map(([k, v]: [string, any]) => ({ name: k, ...v }));
                    parsed = parsed.filter((d: any) => d && typeof d.x === 'number' && typeof d.y === 'number');
                    const idBase = file.name.replace(/\.hideout$/i, '');
                    setHideouts(prev => {
                        const id = generateUniqueId(idBase, prev.map(p => p.id));
                        const mapped: Hideout = {
                            id,
                            name: idBase,
                            color: colorForIndex(prev.length),
                            visible: true,
                            doodads: parsed.map((d: any, i: number) => ({ ...d, __hid: String(d.id ?? i), __hideoutId: id })),
                            raw: json
                        };
                        return [...prev, mapped];
                    });
                } catch (err) {
                    console.error('Failed to parse hideout', file.name, err);
                    setErrors(prev => [...prev, `Parse failed: ${file.name}`]);
                }
            };
            reader.readAsText(file);
        });
    }, []);

    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        const dt = e.dataTransfer;
        const fileList: File[] = [];
        if (dt.items && dt.items.length) {
            for (const item of Array.from(dt.items)) {
                if (item.kind === 'file') {
                    const f = item.getAsFile();
                    if (f) fileList.push(f);
                }
            }
        } else if (dt.files && dt.files.length) {
            fileList.push(...Array.from(dt.files));
        }
        ingestHideoutFiles(fileList);
    }, [ingestHideoutFiles]);

    const onDragOverZone = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    };
    const onDragEnterZone = (e: React.DragEvent) => {
        e.preventDefault();
        setDragActive(true);
    };
    const onDragLeaveZone = (e: React.DragEvent) => {
        if ((e.target as HTMLElement).classList.contains('dropzone')) {
            setDragActive(false);
        }
    };
    const triggerFileDialog = () => fileInputRef.current?.click();
    const onManualFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) ingestHideoutFiles(Array.from(e.target.files));
        e.target.value = '';
    };

    const toggleHideout = (id: string) => setHideouts(prev => prev.map(h => h.id === id ? { ...h, visible: !h.visible } : h));

    const clearAll = () => { setHideouts([]); setSelection(new Set()); setMeta(null); metaRef.current = null; };
    const resetSelection = () => setSelection(new Set());

    const onPointerDown = (e: React.PointerEvent) => {
        if (e.button === 2 || e.button === 1 || spacePressed) {
            e.preventDefault();
            panLastScreenRef.current = [e.clientX, e.clientY];
            setPanning(true);
            setUserViewDirty(true);
            return;
        }
        if (e.button !== 0) return;
        const pt = pointerToSvg(e, svgRef.current);
        setLasso({ active: true, points: [pt] });
    };

    const onPointerMove = (e: React.PointerEvent) => {
        if (panning && view && svgRef.current) {
            const [lastX, lastY] = panLastScreenRef.current ?? [e.clientX, e.clientY];
            const dxPx = e.clientX - lastX;
            const dyPx = e.clientY - lastY;
            panLastScreenRef.current = [e.clientX, e.clientY];
            const svg = svgRef.current;
            const bbox = svg.getBoundingClientRect();
            const dx = (dxPx * view.w) / Math.max(1, bbox.width);
            const dy = (dyPx * view.h) / Math.max(1, bbox.height);
            setView(v => v ? { ...v, x: v.x - dx, y: v.y - dy } : v);
            return;
        }
        if (!lasso.active) return;
        const pt = pointerToSvg(e, svgRef.current);
        setLasso(l => ({ ...l, points: [...l.points, pt] }));
    };

    const onPointerUp = () => {
        setPanning(false);
        panLastRef.current = null;
        panLastScreenRef.current = null;
        setLasso(l => ({ ...l, active: false }));
        if (lasso.points.length < 3) { setLasso({ active: false, points: [] }); return; }
        const poly = lasso.points;
        const newlySelected: string[] = [];
        const candidates = hideouts
            .filter(h => h.visible && (selectionScope === 'ALL' || h.id === selectionScope))
            .flatMap(h => h.doodads);
        for (const d of candidates) {
            const [dx, dy] = displayPos(d, extents, rotation);
            if (pointInPolygon(dx, dy, poly as [number, number][])) {
                newlySelected.push(globalDoodadId(d));
            }
        }
        if (newlySelected.length) {
            setSelection(prev => new Set([...prev, ...newlySelected]));
        }
        setLasso({ active: false, points: [] });
    };

    const toggleDoodadSelection = (d: Doodad) => {
        if (selectionScope !== 'ALL' && d.__hideoutId !== selectionScope) return;
        const key = globalDoodadId(d);
        setSelection(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };

    const downloadMerged = () => {
        const selectedDoodads: Doodad[] = [];
        for (const h of hideouts) for (const d of h.doodads) if (selection.has(globalDoodadId(d))) selectedDoodads.push(d);
        // Deduplicate by exact match of name, hash, x, y, r, fv
        const seen = new Set<string>();
        const unique = [] as Doodad[];
        for (const d of selectedDoodads) {
            const key = [d.name, d.hash, d.x, d.y, d.r ?? '', d.fv ?? ''].join('|');
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(d);
        }
        // Build text with doodads as an object keyed by name (duplicates allowed in output)
        const out = buildHideoutJsonText(
            {
                version: meta?.version,
                language: meta?.language,
                hideout_name: meta?.hideout_name,
                hideout_hash: meta?.hideout_hash,
            },
            unique
        );
        const blob = new Blob([out], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `merged-${unique.length}-doodads.hideout`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const viewBox = view ? `${view.x} ${view.y} ${view.w} ${view.h}` : `${extents.minX - 10} ${extents.minY - 10} ${(extents.maxX - extents.minX) + 20} ${(extents.maxY - extents.minY) + 20}`;

    const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
        if (!view) return;
        e.preventDefault();
        // Inverted direction per user request: scroll down -> zoom out
        const factor = Math.exp(e.deltaY * 0.0015);
        const [mx, my] = pointerToSvg(e as any, svgRef.current);
        setView(v => {
            if (!v) return v;
            const nw = v.w * factor;
            const nh = v.h * factor;
            const nx = mx - (mx - v.x) * factor;
            const ny = my - (my - v.y) * factor;
            return { x: nx, y: ny, w: nw, h: nh };
        });
        setUserViewDirty(true);
    };

    return (
        <div className="app-layout">
            <aside className="sidebar">
                <div
                    className={`dropzone${dragActive ? ' drag' : ''}`}
                    onDragEnter={onDragEnterZone}
                    onDragOver={onDragOverZone}
                    onDragLeave={onDragLeaveZone}
                    onDrop={onDrop}
                    role="button"
                    tabIndex={0}
                    onClick={triggerFileDialog}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); triggerFileDialog(); } }}
                >
                    Drag & Drop .hideout files here<br />
                    <small>or click to choose</small>
                </div>
                <input
                    aria-label="Choose hideout files"
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".hideout,application/json"
                    className="hidden-input"
                    onChange={onManualFiles}
                />
                        {hideouts.length === 0 && (
                            <a
                                className="button-link button-link--blue"
                                href="https://hideoutshowcase.com/"
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Open HideoutShowcase in a new tab"
                            >
                                <i className="bi bi-box-arrow-up-right" aria-hidden="true"></i>
                                <span>Get hideouts on HideoutShowcase</span>
                            </a>
                        )}
                <fieldset className="selection-controls">
                    <legend>Limit selection to</legend>
                    <label className="scope-label"><input type="radio" name="scope" value="ALL" checked={selectionScope === 'ALL'} onChange={() => setSelectionScope('ALL')} /> <span className="scope-name">All hideouts</span></label>
                    {hideouts.map(h => (
                        <label key={h.id} className={`scope-label with-swatch-color swatch-${indexForColor(h.color)}`}>
                            <input type="radio" name="scope" value={h.id} checked={selectionScope === h.id} onChange={() => setSelectionScope(h.id)} />
                            <div className="color-swatch" />
                            <span className="scope-name">{h.name}</span>
                        </label>
                    ))}
                </fieldset>
                {errors.length > 0 && (
                    <div className="hideout-error-list">
                        {errors.slice(-3).map((er, i) => <div key={i}>{er}</div>)}
                    </div>
                )}
                <ul className="hideout-list">
                    {hideouts.map(h => (
                        <li key={h.id}>
                            <label className="hideout-row-label">
                                <input aria-label={`Toggle ${h.name}`} type="checkbox" checked={h.visible} onChange={() => toggleHideout(h.id)} />
                                <div className={`color-swatch swatch-${indexForColor(h.color)}`} />
                                <span className="hideout-name">{h.name}</span>
                                <span className="hideout-count">{h.doodads.length}</span>
                            </label>
                        </li>
                    ))}
                </ul>
                <label className="toggle" title="Show doodad names on hover">
                    <input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} />
                    <span className="slider" aria-hidden="true"></span>
                    <span className="label">Show labels on hover</span>
                </label>
                <div className="selection-info">Selected: {selection.size}</div>
                <div className="actions">
                    <button className="btn-primary" onClick={downloadMerged} disabled={!selection.size}>Download Merged</button>
                    <button onClick={resetSelection} disabled={!selection.size}>Reset Selection</button>
                    <button onClick={clearAll} disabled={!hideouts.length}>Clear All</button>
                    <a
                        className="button-link"
                        href="https://github.com/drandarov-io/path-of-hideout"
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open source on GitHub"
                    >
                        <i className="bi bi-github" aria-hidden="true"></i>
                        <span>Source</span>
                    </a>
                </div>
                <div className="legend">Lasso: left-drag. Pan: hold Space or middle/right-drag. Zoom: mouse wheel. Scope limits selection.</div>
            </aside>
        <div className="canvas-wrapper">
                <div className="view-container" ref={containerRef}
            onPointerLeave={() => { lasso.active && setLasso({ active: false, points: [] }); setHoverInfo(null); }}>
                    <button
                        type="button"
                        className="view-rotate-btn"
                        aria-label="Rotate view 45 degrees"
                        title="Rotate view 45°"
                        onClick={() => setRotation(r => (r + 45) % 360)}
                    >
                        <i className="bi bi-arrow-clockwise" aria-hidden="true"></i>
                    </button>
                    <button
                        type="button"
                        className="view-fit-btn"
                        aria-label="Fit to content"
                        title="Fit to content"
                        onClick={() => { setView(fittedView); setUserViewDirty(false); }}
                    >
                        <i className="bi bi-arrows-angle-contract" aria-hidden="true"></i>
                    </button>
                    <svg
                        ref={svgRef}
                        viewBox={viewBox}
                        onContextMenu={e => e.preventDefault()}
                        onWheel={onWheel}
                        onPointerDown={onPointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                    >
                        {/* grid lines */}
                        {renderGrid(view ?? fittedView, rotation, extents)}
                        {hideouts.filter(h => h.visible).map(h => (
                            <g key={h.id}>
                                {h.doodads.map(d => {
                                    const selected = selection.has(globalDoodadId(d));
                                    const [cx, cy] = displayPos(d, extents, rotation);
                                    return (
                                        <circle
                                            key={d.__hid}
                                            className={`doodad${selected ? ' selected' : ''}`}
                                            cx={cx}
                                            cy={cy}
                                            r={selected ? 3.4 : 2.2}
                                            fill={h.color}
                                            fillOpacity={0.75}
                                            onClick={e => { e.stopPropagation(); toggleDoodadSelection(d); }}
                                            onPointerEnter={e => {
                                                if (!showLabels) return;
                                                const fvNum = Number((d as any).fv);
                                                const baseName = d.name ?? '';
                                                const text = fvNum > 0 ? `${baseName} ${fvNum + 1}` : baseName;
                                                const svg = svgRef.current;
                                                const container = containerRef.current;
                                                if (svg && container) {
                                                    const [sx, sy] = svgToClient(svg, cx, cy);
                                                    const rect = container.getBoundingClientRect();
                                                    setHoverInfo({ x: sx - rect.left, y: sy - rect.top, text });
                                                } else {
                                                    setHoverInfo({ x: e.clientX, y: e.clientY, text });
                                                }
                                            }}
                                            onPointerLeave={() => { if (showLabels) setHoverInfo(null); }}
                                        >
                                            {/* title kept off; using custom tooltip */}
                                        </circle>
                                    );
                                })}
                            </g>
                        ))}
                        {lasso.points.length > 1 && (
                            <polygon className="lasso-path" points={lasso.points.map(p => p.join(',')).join(' ')} />
                        )}
                    </svg>
                    {showLabels && hoverInfo && (
                        <div className="doodad-tooltip">{hoverInfo.text}</div>
                    )}
                </div>
            </div>
        </div>
    );
};

function generateUniqueId(base: string, existing: string[]): string {
    let candidate = base;
    let i = 1;
    while (existing.includes(candidate)) {
        candidate = `${base}-${i++}`;
    }
    return candidate;
}

function globalDoodadId(d: Doodad): string { return `${d.__hideoutId}:${d.__hid}`; }

function stripInternal(d: Doodad) {
    const { __hid, __hideoutId, ...rest } = d; // eslint-disable-line @typescript-eslint/no-unused-vars
    return rest;
}

function pointerToSvg(e: React.PointerEvent, svg: SVGSVGElement | null): [number, number] {
    if (!svg) return [0, 0];
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return [0, 0];
    const inv = ctm.inverse();
    const sp = pt.matrixTransform(inv);
    return [sp.x, sp.y];
}

// Convert an SVG point (in current SVG user space) to client (screen) pixels
function svgToClient(svg: SVGSVGElement, x: number, y: number): [number, number] {
    const pt = svg.createSVGPoint();
    pt.x = x; pt.y = y;
    const ctm = svg.getScreenCTM();
    if (!ctm) return [0, 0];
    const sp = pt.matrixTransform(ctm);
    return [sp.x, sp.y];
}

function renderGrid(view: { x: number; y: number; w: number; h: number }, rotation: number, ext: ReturnType<typeof computeExtents>) {
    const lines = [] as React.ReactNode[];
    const span = Math.max(view.w, view.h);
    const step = chooseGridStep(span);
    const cx = (ext.minX + ext.maxX) / 2;
    const cy = (ext.minY + ext.maxY) / 2;
    const xStart = Math.floor((view.x - view.w) / step) * step; // extend beyond view for continuity
    const xEnd = Math.ceil((view.x + view.w * 2) / step) * step;
    const yStart = Math.floor((view.y - view.h) / step) * step;
    const yEnd = Math.ceil((view.y + view.h * 2) / step) * step;
    const yflip = (y: number) => (ext.minY + ext.maxY - y);
    for (let x = xStart; x <= xEnd; x += step) {
        const [x1, y1] = rotateAround(x, yStart, cx, cy, rotation);
        const [x2, y2] = rotateAround(x, yEnd, cx, cy, rotation);
        const fy1 = yflip(y1);
        const fy2 = yflip(y2);
        lines.push(<line key={`vx${x}`} x1={x1} x2={x2} y1={fy1} y2={fy2} stroke="#2a2e33" strokeWidth={0.4} />);
    }
    for (let y = yStart; y <= yEnd; y += step) {
        const [x1, y1] = rotateAround(xStart, y, cx, cy, rotation);
        const [x2, y2] = rotateAround(xEnd, y, cx, cy, rotation);
        const fy1 = yflip(y1);
        const fy2 = yflip(y2);
        lines.push(<line key={`hy${y}`} x1={x1} x2={x2} y1={fy1} y2={fy2} stroke="#2a2e33" strokeWidth={0.4} />);
    }
    return <g>{lines}</g>;
}

function chooseGridStep(span: number) {
    if (span < 50) return 5;
    if (span < 200) return 10;
    if (span < 500) return 25;
    return 50;
}

// Converts the doodads object with possibly duplicate keys into an array preserving each entry.
// Example: "doodads": { "A": {..}, "A": {..} } => "doodads":[ {"name":"A",...}, {"name":"A",...} ]
// This allows us to retain multiple entries that would otherwise be lost by JSON.parse overwriting duplicate keys.
function transformDoodadsObjectToArray(text: string): string {
    const keyIdx = text.indexOf('"doodads"');
    if (keyIdx === -1) return text;
    // Find the first '{' after the key:
    const colonIdx = text.indexOf(':', keyIdx);
    if (colonIdx === -1) return text;
    let i = colonIdx + 1;
    // Skip whitespace
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== '{') return text; // not an object form
    const startObj = i; // position of opening '{'
    i++; // move inside object
    const entries: string[] = [];
    while (i < text.length) {
        // Skip whitespace
        while (i < text.length && /\s/.test(text[i])) i++;
        if (i >= text.length) break;
        if (text[i] === '}') { // end of doodads object
            i++; // consume '}'
            break;
        }
        if (text[i] !== '"') {
            // Unexpected token; abort transform
            return text;
        }
        // Parse key string
        let key = '';
        i++; // skip opening quote
        while (i < text.length) {
            const ch = text[i];
            if (ch === '\\') { // escape
                key += ch + (text[i + 1] || '');
                i += 2;
                continue;
            }
            if (ch === '"') { i++; break; }
            key += ch; i++;
        }
        // Skip whitespace
        while (i < text.length && /\s/.test(text[i])) i++;
        if (text[i] !== ':') return text; // malformed
        i++; // skip ':'
        while (i < text.length && /\s/.test(text[i])) i++;
        if (text[i] !== '{') return text; // Expect object start
        // Capture object with brace depth
        let depth = 0;
        let objStart = i;
        let objStr = '';
        while (i < text.length) {
            const ch = text[i];
            objStr += ch;
            if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
            i++;
        }
        // Push entry (ensure begins with '{')
        entries.push(`{"name":${JSON.stringify(key)},${objStr.trim().replace(/^\{/, '').replace(/\}$/, '')}}`);
        // Skip whitespace and optional comma
        while (i < text.length && /\s/.test(text[i])) i++;
        if (text[i] === ',') { i++; }
    }
    const endIdx = i; // position after closing '}'
    if (!entries.length) return text; // nothing parsed
    const before = text.slice(0, startObj) + '['; // replace '{' with '['
    const after = text.slice(endIdx); // rest of file (may include comma)
    const arrayContent = entries.join(',');
    return before + arrayContent + ']' + after;
}

export default App;

// Builds the .hideout JSON as text with doodads in an object keyed by name.
// This preserves multiple entries with the same name (duplicate keys) as used by the game.
function buildHideoutJsonText(
    meta: { version?: any; language?: any; hideout_name?: any; hideout_hash?: any },
    doodads: Doodad[]
): string {
    const lines: string[] = [];
    const indent = (n: number) => '  '.repeat(n);
    lines.push('{');
    const metaPairs: string[] = [];
    if (meta.version !== undefined) metaPairs.push(`${indent(1)}"version": ${JSON.stringify(meta.version)}`);
    if (meta.language !== undefined) metaPairs.push(`${indent(1)}"language": ${JSON.stringify(meta.language)}`);
    if (meta.hideout_name !== undefined) metaPairs.push(`${indent(1)}"hideout_name": ${JSON.stringify(meta.hideout_name)}`);
    if (meta.hideout_hash !== undefined) metaPairs.push(`${indent(1)}"hideout_hash": ${JSON.stringify(meta.hideout_hash)}`);
    // Write metadata lines separated by commas (if any)
    if (metaPairs.length) {
        lines.push(...metaPairs.map((l, i) => i < metaPairs.length - 1 ? l + ',' : l + ','));
    }
    // Doodads object
    lines.push(`${indent(1)}"doodads": {`);
    if (doodads.length) {
        doodads.forEach((d, idx) => {
            // Strip internals and name from value; include r/fv if present (including 0)
            const { __hid, __hideoutId, name, ...rest } = d as any;
            const value: Record<string, any> = {};
            if (rest.hash !== undefined) value.hash = rest.hash;
            if (rest.x !== undefined) value.x = rest.x;
            if (rest.y !== undefined) value.y = rest.y;
            if (rest.r !== undefined) value.r = rest.r;
            if (rest.fv !== undefined) value.fv = rest.fv;
            const valueStr = JSON.stringify(value, null, 2)
                .split('\n')
                .map((ln, i) => (i === 0 ? ln : indent(2) + ln))
                .join('\n');
            const keyLine = `${indent(2)}${JSON.stringify(d.name)}: ${valueStr}`;
            const comma = idx < doodads.length - 1 ? ',' : '';
            lines.push(keyLine + comma);
        });
    }
    lines.push(`${indent(1)}}`); // close doodads
    lines.push('}');
    return lines.join('\n');
}

function rotatedDisplayPos(d: Doodad, ext: ReturnType<typeof computeExtents>, rotation: number): [number, number] {
    const cx = (ext.minX + ext.maxX) / 2;
    const cy = (ext.minY + ext.maxY) / 2;
    return rotateAround(d.x, d.y, cx, cy, rotation);
}

function displayPos(d: Doodad, ext: ReturnType<typeof computeExtents>, rotation: number): [number, number] {
    const [rx, ry] = rotatedDisplayPos(d, ext, rotation);
    const fy = (ext.minY + ext.maxY - ry); // definitive flipped Y
    return [rx, fy];
}
