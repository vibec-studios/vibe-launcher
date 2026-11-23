export function escapeIdent(v) {
    if (v === "-") return "\\-";
    let out = "";
    for(let k = 0; k < v.length; k++){
        const c = v.charCodeAt(k);
        const ch = v[k];
        if (c === 0) out += "�";
        else if (c >= 1 && c <= 31 || c === 127) out += `\\${c.toString(16)} `;
        else if (c >= 48 && c <= 57 && (k === 0 || k === 1 && v[0] === "-")) out += `\\${c.toString(16)} `;
        else if (c >= 0x80 || ch === "-" || ch === "_" || c >= 48 && c <= 57 || c >= 65 && c <= 90 || c >= 97 && c <= 122) out += ch;
        else out += `\\${ch}`;
    }
    return out;
}
export function escapeName(v) {
    let out = "";
    for(let k = 0; k < v.length; k++){
        const c = v.charCodeAt(k);
        const ch = v[k];
        if (c >= 1 && c <= 31 || c === 127) out += `\\${c.toString(16)} `;
        else if (c >= 0x80 || ch === "-" || ch === "_" || c >= 48 && c <= 57 || c >= 65 && c <= 90 || c >= 97 && c <= 122) out += ch;
        else out += `\\${ch}`;
    }
    return out;
}
export function quote(v) {
    let out = '"';
    for(let k = 0; k < v.length; k++){
        const c = v.charCodeAt(k);
        const ch = v[k];
        if (c === 0) out += "�";
        else if (c >= 1 && c <= 31 || c === 127) out += `\\${c.toString(16)} `;
        else if (ch === '"' || ch === "\\") out += `\\${ch}`;
        else out += ch;
    }
    return `${out}"`;
}
function kind(x) {
    switch(x.t){
        case "ident":
            return "ident";
        case "fn":
            return "fn";
        case "url":
        case "badurl":
            return "url";
        case "num":
            return "num";
        case "pct":
            return "pct";
        case "dim":
            return "dim";
        case "hash":
            return "hash";
        case "at":
            return "at";
        case "cdc":
            return "cdc";
        case "block":
            return x.open === "(" ? "open" : "other";
        case "delim":
            if (x.v === "-") return "minus";
            if (x.v === "#") return "hashdelim";
            if (x.v === "@") return "atdelim";
            if (x.v === "." || x.v === "+") return "dotplus";
            if (x.v === "/") return "slash";
            if (x.v === "*") return "star";
            if (x.v === "%") return "pct-delim";
            return "other";
        default:
            return "other";
    }
}
const WORDY = [
    "ident",
    "fn",
    "url",
    "minus",
    "num",
    "pct",
    "dim",
    "cdc"
];
function needsGap(a, b) {
    switch(a){
        case "ident":
            return WORDY.includes(b) || b === "open";
        case "at":
        case "hashdelim":
        case "minus":
        case "hash":
        case "dim":
            return WORDY.includes(b);
        case "num":
            return [
                "ident",
                "fn",
                "url",
                "num",
                "pct",
                "dim",
                "pct-delim"
            ].includes(b);
        case "atdelim":
            return [
                "ident",
                "fn",
                "url",
                "minus",
                "cdc"
            ].includes(b);
        case "dotplus":
            return [
                "num",
                "pct",
                "dim"
            ].includes(b);
        case "slash":
            return b === "star";
        default:
            return false;
    }
}
function one(x) {
    switch(x.t){
        case "ws":
            return " ";
        case "str":
            return quote(x.v);
        case "url":
            return `url(${quote(x.v)})`;
        case "delim":
            return x.v;
        case "num":
            return x.repr;
        case "pct":
            return `${x.repr}%`;
        case "dim":
            return `${x.repr}${escapeUnit(x.unit)}`;
        case "ident":
            return escapeIdent(x.v);
        case "at":
            return `@${escapeIdent(x.v)}`;
        case "hash":
            return `#${escapeName(x.v)}`;
        case "fn":
            return `${escapeIdent(x.name)}(${serialize(x.args)})`;
        case "block":
            return `${x.open}${serialize(x.body)}${x.open === "{" ? "}" : x.open === "[" ? "]" : ")"}`;
        case "cdo":
            return "<!--";
        case "cdc":
            return "-->";
        case "badstr":
        case "badurl":
            return "";
        default:
            return x.t;
    }
}
function escapeUnit(u) {
    const e = escapeIdent(u);
    return /^[eE][-+]?[0-9]/.test(u) ? `\\${u.charCodeAt(0).toString(16)} ${e.slice(1)}` : e;
}
export function serialize(list) {
    let out = "";
    let prev = null;
    for (const x of list){
        const k = kind(x);
        if (prev && x.t !== "ws" && needsGap(prev, k)) out += "/**/";
        out += one(x);
        prev = x.t === "ws" ? null : k;
    }
    return out;
}
export function rawJoin(list) {
    let out = "";
    for (const x of list){
        if (x.t === "ident") out += x.v;
        else if (x.t === "num") out += x.repr;
        else if (x.t === "dim") out += x.repr + x.unit;
        else if (x.t === "pct") out += `${x.repr}%`;
        else if (x.t === "delim") out += x.v;
        else if (x.t === "ws") out += " ";
        else if (x.t === ",") out += ",";
        else return "\u0000";
    }
    return out;
}
