import { tokenize } from "./tokenize.mjs";
const CLOSE = {
    "{": "}",
    "[": "]",
    "(": ")"
};
const MAX_DEPTH = 32;
const opens = (x)=>x.t === "{" || x.t === "[" || x.t === "(" || x.t === "func";
const closes = (x)=>x.t === "}" || x.t === "]" || x.t === ")";
function skipNested(s) {
    let open = 1;
    while(open > 0){
        const x = s.next();
        if (x.t === "eof") break;
        if (opens(x)) open++;
        else if (closes(x)) open--;
    }
    return {
        t: "badstr"
    };
}
class Stream {
    i = 0;
    items;
    constructor(items){
        this.items = items;
    }
    peek() {
        return this.items[this.i] ?? {
            t: "eof"
        };
    }
    next() {
        return this.items[this.i++] ?? {
            t: "eof"
        };
    }
}
function componentValue(s, first, depth = 0) {
    if (depth >= MAX_DEPTH && opens(first)) return skipNested(s);
    if (first.t === "{" || first.t === "[" || first.t === "(") {
        const end = CLOSE[first.t];
        const body = [];
        for(;;){
            const x = s.next();
            if (x.t === end || x.t === "eof") break;
            body.push(componentValue(s, x, depth + 1));
        }
        return {
            t: "block",
            open: first.t,
            body
        };
    }
    if (first.t === "func") {
        const args = [];
        for(;;){
            const x = s.next();
            if (x.t === ")" || x.t === "eof") break;
            args.push(componentValue(s, x, depth + 1));
        }
        return {
            t: "fn",
            name: first.v,
            args
        };
    }
    return first;
}
function rules(s, top) {
    const out = [];
    for(;;){
        const x = s.peek();
        if (x.t === "eof") return out;
        if (x.t === "ws" || top && (x.t === "cdo" || x.t === "cdc")) {
            s.next();
            continue;
        }
        if (x.t === "at") {
            s.next();
            out.push(atRule(s, x.v));
            continue;
        }
        const q = qualified(s);
        if (q) out.push(q);
    }
}
function atRule(s, name) {
    const prelude = [];
    for(;;){
        const x = s.next();
        if (x.t === ";" || x.t === "eof") return {
            kind: "at",
            name,
            prelude,
            block: null
        };
        if (x.t === "{") {
            const b = componentValue(s, x);
            return {
                kind: "at",
                name,
                prelude,
                block: b.body
            };
        }
        if (x.t === "block" && x.open === "{") return {
            kind: "at",
            name,
            prelude,
            block: x.body
        };
        prelude.push(componentValue(s, x));
    }
}
function qualified(s) {
    const prelude = [];
    for(;;){
        const x = s.next();
        if (x.t === "eof") return null;
        if (x.t === "{") {
            const b = componentValue(s, x);
            return {
                kind: "qual",
                prelude,
                block: b.body
            };
        }
        if (x.t === "block" && x.open === "{") return {
            kind: "qual",
            prelude,
            block: x.body
        };
        prelude.push(componentValue(s, x));
    }
}
export function parseStylesheet(src) {
    return rules(new Stream(tokenize(src)), true);
}
export function parseRuleList(block) {
    return rules(new Stream(block), false);
}
export function parseComponents(src) {
    const s = new Stream(tokenize(src));
    const out = [];
    for(;;){
        const x = s.next();
        if (x.t === "eof") return out;
        out.push(componentValue(s, x));
    }
}
function trimWs(v) {
    let a = 0;
    let b = v.length;
    while(a < b && v[a].t === "ws")a++;
    while(b > a && v[b - 1].t === "ws")b--;
    return v.slice(a, b);
}
function declaration(parts) {
    const head = parts[0];
    if (!head || head.t !== "ident") return null;
    let k = 1;
    while(parts[k]?.t === "ws")k++;
    if (parts[k]?.t !== ":") return null;
    let value = trimWs(parts.slice(k + 1));
    let important = false;
    const last = value[value.length - 1];
    if (last?.t === "ident" && last.v.toLowerCase() === "important") {
        let j = value.length - 2;
        while(value[j]?.t === "ws")j--;
        const bang = value[j];
        if (bang?.t === "delim" && bang.v === "!") {
            important = true;
            value = trimWs(value.slice(0, j));
        }
    }
    return {
        name: head.v,
        value,
        important
    };
}
const hasBraces = (v)=>v.some((x)=>x.t === "block" && x.open === "{");
export function parseDeclarations(block) {
    const out = [];
    let i = 0;
    while(i < block.length){
        const x = block[i];
        if (x.t === "ws" || x.t === ";") {
            i++;
            continue;
        }
        if (x.t === "at") {
            i++;
            while(i < block.length && block[i].t !== ";" && !(block[i].t === "block" && block[i].open === "{"))i++;
            i++;
            out.push({
                kind: "bad",
                nested: true
            });
            continue;
        }
        const start = i;
        while(i < block.length && block[i].t !== ";")i++;
        const parts = block.slice(start, i);
        const decl = x.t === "ident" && !hasBraces(parts) ? declaration(parts) : null;
        out.push(decl ? {
            kind: "decl",
            decl
        } : {
            kind: "bad",
            nested: hasBraces(parts)
        });
    }
    return out;
}
export function parseDeclarationList(src) {
    return parseDeclarations(parseComponents(src));
}
