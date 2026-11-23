const NL = 10;
const isDigit = (c)=>c >= 48 && c <= 57;
const isHex = (c)=>isDigit(c) || c >= 65 && c <= 70 || c >= 97 && c <= 102;
const isWs = (c)=>c === NL || c === 9 || c === 32;
const isIdentStart = (c)=>c >= 65 && c <= 90 || c >= 97 && c <= 122 || c >= 0x80 || c === 95;
const isIdent = (c)=>isIdentStart(c) || isDigit(c) || c === 45;
const isNonPrintable = (c)=>c >= 0 && c <= 8 || c === 11 || c >= 14 && c <= 31 || c === 127;
export function preprocess(input) {
    return input.replace(/\r\n?|\f/g, "\n").replace(/\0/g, "�");
}
export function tokenize(input) {
    const s = preprocess(input);
    const n = s.length;
    let i = 0;
    const out = [];
    const at = (k)=>k < n ? s.charCodeAt(k) : -1;
    const validEscape = (k)=>at(k) === 92 && at(k + 1) !== NL && at(k + 1) !== -1;
    const startsIdent = (k)=>{
        const c = at(k);
        if (c === 45) return isIdentStart(at(k + 1)) || at(k + 1) === 45 || validEscape(k + 1);
        if (isIdentStart(c)) return true;
        return c === 92 && validEscape(k);
    };
    const startsNumber = (k)=>{
        const c = at(k);
        if (c === 43 || c === 45) return isDigit(at(k + 1)) || at(k + 1) === 46 && isDigit(at(k + 2));
        if (c === 46) return isDigit(at(k + 1));
        return isDigit(c);
    };
    const escaped = ()=>{
        const c = at(i);
        if (c === -1) return "�";
        if (isHex(c)) {
            let h = "";
            while(h.length < 6 && isHex(at(i)))h += s[i++];
            if (isWs(at(i))) i++;
            const cp = parseInt(h, 16);
            return cp === 0 || cp >= 0xd800 && cp <= 0xdfff || cp > 0x10ffff ? "�" : String.fromCodePoint(cp);
        }
        i++;
        return String.fromCharCode(c);
    };
    const name = ()=>{
        let r = "";
        for(;;){
            const c = at(i);
            if (c !== -1 && isIdent(c)) r += s[i++];
            else if (validEscape(i)) {
                i++;
                r += escaped();
            } else return r;
        }
    };
    const number = ()=>{
        let repr = "";
        let int = true;
        if (at(i) === 43 || at(i) === 45) repr += s[i++];
        while(isDigit(at(i)))repr += s[i++];
        if (at(i) === 46 && isDigit(at(i + 1))) {
            int = false;
            repr += s[i++];
            while(isDigit(at(i)))repr += s[i++];
        }
        const e = at(i);
        if ((e === 69 || e === 101) && (isDigit(at(i + 1)) || (at(i + 1) === 43 || at(i + 1) === 45) && isDigit(at(i + 2)))) {
            int = false;
            repr += s[i++];
            if (!isDigit(at(i))) repr += s[i++];
            while(isDigit(at(i)))repr += s[i++];
        }
        return {
            v: Number(repr),
            repr,
            int
        };
    };
    const numeric = ()=>{
        const num = number();
        if (startsIdent(i)) return {
            t: "dim",
            ...num,
            unit: name()
        };
        if (at(i) === 37) {
            i++;
            return {
                t: "pct",
                v: num.v,
                repr: num.repr
            };
        }
        return {
            t: "num",
            ...num
        };
    };
    const badUrlRest = ()=>{
        for(;;){
            const c = at(i);
            if (c === -1) return;
            if (c === 41) {
                i++;
                return;
            }
            if (validEscape(i)) {
                i++;
                escaped();
            } else i++;
        }
    };
    const url = ()=>{
        let v = "";
        while(isWs(at(i)))i++;
        for(;;){
            const c = at(i);
            if (c === -1) return {
                t: "url",
                v
            };
            if (c === 41) {
                i++;
                return {
                    t: "url",
                    v
                };
            }
            if (isWs(c)) {
                while(isWs(at(i)))i++;
                if (at(i) === 41 || at(i) === -1) {
                    if (at(i) === 41) i++;
                    return {
                        t: "url",
                        v
                    };
                }
                badUrlRest();
                return {
                    t: "badurl"
                };
            }
            if (c === 34 || c === 39 || c === 40 || isNonPrintable(c)) {
                badUrlRest();
                return {
                    t: "badurl"
                };
            }
            if (c === 92) {
                if (validEscape(i)) {
                    i++;
                    v += escaped();
                    continue;
                }
                badUrlRest();
                return {
                    t: "badurl"
                };
            }
            v += s[i++];
        }
    };
    const identLike = ()=>{
        const v = name();
        if (v.toLowerCase() === "url" && at(i) === 40) {
            i++;
            while(isWs(at(i)) && isWs(at(i + 1)))i++;
            const q = isWs(at(i)) ? at(i + 1) : at(i);
            if (q === 34 || q === 39) return {
                t: "func",
                v
            };
            return url();
        }
        if (at(i) === 40) {
            i++;
            return {
                t: "func",
                v
            };
        }
        return {
            t: "ident",
            v
        };
    };
    const string = (end)=>{
        let v = "";
        for(;;){
            const c = at(i);
            if (c === -1) return {
                t: "str",
                v
            };
            if (c === end) {
                i++;
                return {
                    t: "str",
                    v
                };
            }
            if (c === NL) return {
                t: "badstr"
            };
            if (c === 92) {
                if (at(i + 1) === -1) {
                    i++;
                    continue;
                }
                if (at(i + 1) === NL) {
                    i += 2;
                    continue;
                }
                i++;
                v += escaped();
                continue;
            }
            v += s[i++];
        }
    };
    for(;;){
        while(at(i) === 47 && at(i + 1) === 42){
            const e = s.indexOf("*/", i + 2);
            i = e === -1 ? n : e + 2;
        }
        const c = at(i);
        if (c === -1) break;
        if (isWs(c)) {
            while(isWs(at(i)))i++;
            out.push({
                t: "ws"
            });
        } else if (c === 34 || c === 39) {
            i++;
            out.push(string(c));
        } else if (c === 35) {
            if (isIdent(at(i + 1)) || validEscape(i + 1)) {
                const id = startsIdent(i + 1);
                i++;
                out.push({
                    t: "hash",
                    v: name(),
                    id
                });
            } else {
                i++;
                out.push({
                    t: "delim",
                    v: "#"
                });
            }
        } else if (c === 40 || c === 41 || c === 91 || c === 93 || c === 123 || c === 125 || c === 44 || c === 58 || c === 59) {
            i++;
            out.push({
                t: s[i - 1]
            });
        } else if (c === 43 || c === 46) {
            if (startsNumber(i)) out.push(numeric());
            else out.push({
                t: "delim",
                v: s[i++]
            });
        } else if (c === 45) {
            if (startsNumber(i)) out.push(numeric());
            else if (at(i + 1) === 45 && at(i + 2) === 62) {
                i += 3;
                out.push({
                    t: "cdc"
                });
            } else if (startsIdent(i)) out.push(identLike());
            else out.push({
                t: "delim",
                v: s[i++]
            });
        } else if (c === 60) {
            if (s.startsWith("<!--", i)) {
                i += 4;
                out.push({
                    t: "cdo"
                });
            } else out.push({
                t: "delim",
                v: s[i++]
            });
        } else if (c === 64) {
            i++;
            if (startsIdent(i)) out.push({
                t: "at",
                v: name()
            });
            else out.push({
                t: "delim",
                v: "@"
            });
        } else if (c === 92) {
            if (validEscape(i)) out.push(identLike());
            else out.push({
                t: "delim",
                v: s[i++]
            });
        } else if (isDigit(c)) out.push(numeric());
        else if (isIdentStart(c)) out.push(identLike());
        else out.push({
            t: "delim",
            v: s[i++]
        });
    }
    out.push({
        t: "eof"
    });
    return out;
}
