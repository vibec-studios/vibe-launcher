export const FILE_FORMAT = "vibe-launcher-theme";
export const FILE_EXT = "vibetheme";
export const CODE_PREFIX_V1 = "VIBE-THEME-1:";
export const CODE_PREFIX_V2 = "VIBE-THEME-2:";
export const MAX_NAME = 40;
export const MAX_AUTHOR = 40;
export const MAX_DESCRIPTION = 200;
export const LIMITS = {
    input: 1_450_000,
    document: 1_000_000,
    v1Input: 20_000,
    code: 60_000,
    css: 700_000,
    cssRules: 1500,
    selectorsPerRule: 24,
    selectorChars: 600,
    declarations: 80,
    atRuleDepth: 3,
    keyframes: 40,
    fontFaces: 8,
    fontBytes: 300 * 1024,
    imageBytes: 200 * 1024,
    imagesTotal: 600 * 1024,
    slotChars: 260_000,
    slotNodes: 600,
    totalNodes: 2000,
    depth: 24,
    attrChars: 4000,
    longAttrChars: 40_000,
    zIndex: 10
};
export const SCOPE_ATTR = "data-vt-scope";
export const PROTECT_ATTR = "data-vt-protected";
export const LOCK_ATTR = "data-vt-lock";
export const PREVIEW_ATTR = "data-vt-preview";
export const CLASS_PREFIX = "vt-";
export const BOOST = ":not(#_vt_)";
export const PARTS = [
    "sidebar",
    "nav-item",
    "header",
    "main",
    "home",
    "home-header",
    "home-hero",
    "button",
    "button-primary",
    "button-accent",
    "button-ghost",
    "button-outline",
    "button-subtle",
    "button-danger",
    "icon-button",
    "card",
    "instance-tile",
    "dialog",
    "input",
    "tabs",
    "tab",
    "segmented",
    "badge",
    "chip",
    "progress",
    "progress-bar",
    "switch",
    "checkbox",
    "section",
    "section-title",
    "empty",
    "slot"
];
export const SLOTS = [
    "background",
    "home-hero",
    "home-side",
    "sidebar-top",
    "corner-tl",
    "corner-tr",
    "corner-bl",
    "corner-br"
];
export const PLACEHOLDERS = [
    "greeting",
    "player",
    "time",
    "date",
    "friends_online",
    "instances",
    "last_played",
    "version"
];
export const PALETTE_VARS = {
    frame: "--tone-frame",
    canvas: "--tone-canvas",
    surface: "--tone-s1",
    surface2: "--tone-s2",
    surface3: "--tone-s3",
    overlay: "--tone-overlay",
    border: "--line-1",
    border2: "--line-2",
    field: "--field",
    text: "--t1",
    muted: "--t2",
    dim: "--t3",
    on_accent: "--ui-on-accent"
};
export const PALETTE_KEYS = Object.keys(PALETTE_VARS);
export const CSS_AT_RULES = [
    "media",
    "supports",
    "container",
    "keyframes",
    "font-face"
];
export const CSS_BLOCKED_PROPERTIES = [
    "behavior",
    "-moz-binding",
    "-webkit-app-region",
    "app-region",
    "pointer-events",
    "-webkit-user-modify",
    "user-modify",
    "view-transition-name",
    "view-transition-class",
    "anchor-name",
    "anchor-scope",
    "position-anchor",
    "position-area",
    "inset-area",
    "position-try",
    "position-try-fallbacks",
    "position-try-options",
    "position-try-order",
    "position-visibility",
    "interactivity",
    "-webkit-touch-callout"
];
export const CSS_FUNCTIONS = [
    "rgb",
    "rgba",
    "hsl",
    "hsla",
    "hwb",
    "lab",
    "lch",
    "oklab",
    "oklch",
    "color",
    "color-mix",
    "light-dark",
    "var",
    "env",
    "calc",
    "min",
    "max",
    "clamp",
    "round",
    "mod",
    "rem",
    "abs",
    "sign",
    "sin",
    "cos",
    "tan",
    "asin",
    "acos",
    "atan",
    "atan2",
    "pow",
    "sqrt",
    "hypot",
    "log",
    "exp",
    "linear-gradient",
    "radial-gradient",
    "conic-gradient",
    "repeating-linear-gradient",
    "repeating-radial-gradient",
    "repeating-conic-gradient",
    "url",
    "translate",
    "translatex",
    "translatey",
    "translatez",
    "translate3d",
    "rotate",
    "rotatex",
    "rotatey",
    "rotatez",
    "rotate3d",
    "scale",
    "scalex",
    "scaley",
    "scalez",
    "scale3d",
    "skew",
    "skewx",
    "skewy",
    "matrix",
    "matrix3d",
    "perspective",
    "cubic-bezier",
    "steps",
    "linear",
    "blur",
    "brightness",
    "contrast",
    "drop-shadow",
    "grayscale",
    "hue-rotate",
    "invert",
    "opacity",
    "saturate",
    "sepia",
    "inset",
    "circle",
    "ellipse",
    "polygon",
    "rect",
    "xywh",
    "path",
    "counter",
    "counters",
    "minmax",
    "repeat",
    "fit-content",
    "format",
    "tech",
    "selector",
    "not",
    "is",
    "where",
    "has",
    "nth-child",
    "nth-last-child",
    "nth-of-type",
    "nth-last-of-type",
    "lang",
    "dir"
];
export const CSS_PSEUDO_CLASSES = [
    "hover",
    "active",
    "focus",
    "focus-visible",
    "focus-within",
    "disabled",
    "enabled",
    "checked",
    "indeterminate",
    "first-child",
    "last-child",
    "only-child",
    "first-of-type",
    "last-of-type",
    "only-of-type",
    "empty",
    "root",
    "placeholder-shown",
    "read-only",
    "read-write",
    "default",
    "required",
    "optional",
    "valid",
    "invalid"
];
export const CSS_PSEUDO_SELECTOR_FUNCTIONS = [
    "not",
    "is",
    "where",
    "has"
];
export const CSS_PSEUDO_NTH_FUNCTIONS = [
    "nth-child",
    "nth-last-child",
    "nth-of-type",
    "nth-last-of-type"
];
export const CSS_PSEUDO_IDENT_FUNCTIONS = [
    "lang",
    "dir"
];
export const CSS_PSEUDO_ELEMENTS = [
    "before",
    "after",
    "placeholder",
    "selection",
    "marker",
    "first-line",
    "first-letter",
    "-webkit-scrollbar",
    "-webkit-scrollbar-thumb",
    "-webkit-scrollbar-track",
    "-webkit-scrollbar-corner"
];
export const CSS_FONT_DESCRIPTORS = [
    "font-family",
    "src",
    "font-weight",
    "font-style",
    "font-stretch",
    "font-display",
    "unicode-range",
    "size-adjust",
    "ascent-override",
    "descent-override",
    "line-gap-override"
];
export const DATA_IMAGE = /^data:image\/(png|webp|gif|svg\+xml)(;[a-z0-9.+_=-]+)*,/i;
export const DATA_FONT = /^data:(font\/(woff2|woff|ttf|otf)|application\/(font-woff2|font-woff|x-font-woff))(;[a-z0-9.+_=-]+)*,/i;
export const DANGEROUS = /(javascript|vbscript|livescript)\s*:|expression\s*\(|-moz-binding|\bbehavior\s*:/i;
export const HTML_TAGS = [
    "div",
    "span",
    "p",
    "strong",
    "b",
    "em",
    "i",
    "small",
    "br",
    "img",
    "h1",
    "h2",
    "h3",
    "h4",
    "ul",
    "ol",
    "li",
    "hr",
    "sup",
    "sub",
    "mark",
    "code"
];
export const HTML_VOID = [
    "br",
    "img",
    "hr"
];
export const SVG_TAGS = [
    "svg",
    "g",
    "path",
    "circle",
    "ellipse",
    "rect",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "defs",
    "symbol",
    "use",
    "marker",
    "linearGradient",
    "radialGradient",
    "stop",
    "clipPath",
    "mask",
    "pattern",
    "filter",
    "feGaussianBlur",
    "feOffset",
    "feBlend",
    "feColorMatrix",
    "feComposite",
    "feFlood",
    "feMerge",
    "feMergeNode",
    "feDropShadow",
    "feMorphology",
    "feTurbulence",
    "feDisplacementMap",
    "feComponentTransfer",
    "feFuncR",
    "feFuncG",
    "feFuncB",
    "feFuncA"
];
export const MARKUP_DROP = [
    "script",
    "style",
    "template",
    "iframe",
    "frame",
    "frameset",
    "object",
    "embed",
    "applet",
    "foreignobject",
    "noscript",
    "noembed",
    "textarea",
    "title",
    "xmp",
    "plaintext",
    "select",
    "option",
    "optgroup",
    "datalist",
    "button",
    "input",
    "form",
    "fieldset",
    "video",
    "audio",
    "source",
    "track",
    "canvas",
    "link",
    "meta",
    "base",
    "math",
    "image",
    "animate",
    "animatemotion",
    "animatetransform",
    "animatecolor",
    "set",
    "discard",
    "portal",
    "dialog",
    "slot",
    "desc",
    "metadata",
    "handler",
    "listener",
    "picture",
    "map",
    "area",
    "head",
    "body",
    "html",
    "svg:script",
    "frameset",
    "marquee",
    "menu",
    "details",
    "summary",
    "label",
    "output",
    "meter",
    "progress"
];
export const HTML_ATTRS = {
    "*": [
        "class",
        "id",
        "style"
    ],
    img: [
        "src",
        "alt",
        "width",
        "height"
    ]
};
const SVG_PRESENTATION = [
    "class",
    "id",
    "style",
    "transform",
    "transform-origin",
    "fill",
    "fill-opacity",
    "fill-rule",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-opacity",
    "stroke-miterlimit",
    "opacity",
    "clip-path",
    "clip-rule",
    "mask",
    "filter",
    "vector-effect",
    "shape-rendering",
    "paint-order",
    "color",
    "display",
    "visibility",
    "marker-start",
    "marker-mid",
    "marker-end",
    "stop-color",
    "stop-opacity",
    "flood-color",
    "flood-opacity",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "letter-spacing",
    "text-anchor",
    "dominant-baseline",
    "color-interpolation-filters",
    "mix-blend-mode"
];
const SVG_FE = [
    "in",
    "in2",
    "result",
    "x",
    "y",
    "width",
    "height"
];
export const SVG_ATTRS = {
    "*": SVG_PRESENTATION,
    svg: [
        "viewBox",
        "width",
        "height",
        "x",
        "y",
        "preserveAspectRatio"
    ],
    symbol: [
        "viewBox",
        "preserveAspectRatio",
        "width",
        "height",
        "x",
        "y"
    ],
    use: [
        "href",
        "x",
        "y",
        "width",
        "height"
    ],
    path: [
        "d",
        "pathLength"
    ],
    circle: [
        "cx",
        "cy",
        "r",
        "pathLength"
    ],
    ellipse: [
        "cx",
        "cy",
        "rx",
        "ry",
        "pathLength"
    ],
    rect: [
        "x",
        "y",
        "width",
        "height",
        "rx",
        "ry",
        "pathLength"
    ],
    line: [
        "x1",
        "y1",
        "x2",
        "y2",
        "pathLength"
    ],
    polyline: [
        "points",
        "pathLength"
    ],
    polygon: [
        "points",
        "pathLength"
    ],
    text: [
        "x",
        "y",
        "dx",
        "dy",
        "textLength",
        "lengthAdjust",
        "rotate"
    ],
    tspan: [
        "x",
        "y",
        "dx",
        "dy",
        "textLength",
        "lengthAdjust",
        "rotate"
    ],
    marker: [
        "viewBox",
        "markerWidth",
        "markerHeight",
        "refX",
        "refY",
        "orient",
        "markerUnits",
        "preserveAspectRatio"
    ],
    linearGradient: [
        "x1",
        "y1",
        "x2",
        "y2",
        "gradientUnits",
        "gradientTransform",
        "spreadMethod"
    ],
    radialGradient: [
        "cx",
        "cy",
        "r",
        "fx",
        "fy",
        "fr",
        "gradientUnits",
        "gradientTransform",
        "spreadMethod"
    ],
    stop: [
        "offset"
    ],
    clipPath: [
        "clipPathUnits"
    ],
    mask: [
        "maskUnits",
        "maskContentUnits",
        "x",
        "y",
        "width",
        "height"
    ],
    pattern: [
        "patternUnits",
        "patternContentUnits",
        "patternTransform",
        "viewBox",
        "x",
        "y",
        "width",
        "height",
        "preserveAspectRatio"
    ],
    filter: [
        "filterUnits",
        "primitiveUnits",
        "x",
        "y",
        "width",
        "height"
    ],
    feGaussianBlur: [
        ...SVG_FE,
        "stdDeviation",
        "edgeMode"
    ],
    feOffset: [
        ...SVG_FE,
        "dx",
        "dy"
    ],
    feBlend: [
        ...SVG_FE,
        "mode"
    ],
    feColorMatrix: [
        ...SVG_FE,
        "type",
        "values"
    ],
    feComposite: [
        ...SVG_FE,
        "operator",
        "k1",
        "k2",
        "k3",
        "k4"
    ],
    feFlood: SVG_FE,
    feMerge: SVG_FE,
    feMergeNode: [
        "in"
    ],
    feDropShadow: [
        ...SVG_FE,
        "dx",
        "dy",
        "stdDeviation"
    ],
    feMorphology: [
        ...SVG_FE,
        "operator",
        "radius"
    ],
    feTurbulence: [
        ...SVG_FE,
        "baseFrequency",
        "numOctaves",
        "seed",
        "stitchTiles",
        "type"
    ],
    feDisplacementMap: [
        ...SVG_FE,
        "scale",
        "xChannelSelector",
        "yChannelSelector"
    ],
    feComponentTransfer: SVG_FE,
    feFuncR: [
        "type",
        "tableValues",
        "slope",
        "intercept",
        "amplitude",
        "exponent",
        "offset"
    ],
    feFuncG: [
        "type",
        "tableValues",
        "slope",
        "intercept",
        "amplitude",
        "exponent",
        "offset"
    ],
    feFuncB: [
        "type",
        "tableValues",
        "slope",
        "intercept",
        "amplitude",
        "exponent",
        "offset"
    ],
    feFuncA: [
        "type",
        "tableValues",
        "slope",
        "intercept",
        "amplitude",
        "exponent",
        "offset"
    ]
};
export const LONG_ATTRS = [
    "d",
    "points",
    "style",
    "values",
    "tableValues"
];
