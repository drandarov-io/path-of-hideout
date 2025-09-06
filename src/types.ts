export interface RawHideoutFile {
    doodads?: RawDoodad[];
    [k: string]: unknown;
}

export interface RawDoodad {
    id?: string | number;
    name?: string;
    x: number;
    y: number;
    [k: string]: unknown;
}

export interface Doodad extends RawDoodad {
    __hid: string; // unique within hideout
    __hideoutId: string; // parent hideout id
}

export interface Hideout {
    id: string;
    name: string;
    color: string;
    doodads: Doodad[];
    visible: boolean;
    raw?: RawHideoutFile; // original for potential metadata reuse
}

export interface SelectionState {
    doodadIds: Set<string>; // global key hideoutId:hid
}
