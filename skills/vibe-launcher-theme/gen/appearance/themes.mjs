import { STATUS_DEFAULT } from "./defaults.mjs";
export const THEMES = {
    standard: {
        id: "standard",
        tokens: {
            accent: "#8b6cff",
            tone: "dark",
            radius: "square",
            contrast: "normal",
            cards: "flat",
            status: STATUS_DEFAULT
        },
        extras: [],
        swatch: {
            frame: "#000000",
            canvas: "#070708",
            surface: "#0f0f11",
            surface2: "#161618",
            text: "#f4f4f6",
            muted: "#6d6d78"
        }
    },
    winter: {
        id: "winter",
        tokens: {
            accent: "#8fcbef",
            tone: "dark",
            radius: "square",
            contrast: "normal",
            cards: "flat",
            status: {
                ok: "#7fdcc4",
                warn: "#f2c879",
                danger: "#ff7a8c"
            }
        },
        extras: [
            "snow",
            "mascot",
            "frost"
        ],
        swatch: {
            frame: "#020407",
            canvas: "#080b10",
            surface: "#0e1218",
            surface2: "#151a22",
            text: "#eef4fa",
            muted: "#6a7686"
        }
    },
    graphite: {
        id: "graphite",
        tokens: {
            accent: "#e6e6ea",
            tone: "dim",
            radius: "square",
            contrast: "normal",
            cards: "outlined",
            status: {
                ok: "#9ccfb4",
                warn: "#dcc28c",
                danger: "#e58e8e"
            }
        },
        extras: [],
        swatch: {
            frame: "#0b0b0d",
            canvas: "#111113",
            surface: "#18181b",
            surface2: "#1f1f22",
            text: "#f4f4f6",
            muted: "#77777f"
        }
    },
    light: {
        id: "light",
        tokens: {
            accent: "#6a4cf5",
            tone: "light",
            radius: "slight",
            contrast: "normal",
            cards: "flat",
            status: {
                ok: "#086b53",
                warn: "#8f5300",
                danger: "#bd2536"
            }
        },
        extras: [],
        swatch: {
            frame: "#e7e8ee",
            canvas: "#f5f5f9",
            surface: "#ffffff",
            surface2: "#eeeef4",
            text: "#14161b",
            muted: "#5d6372"
        }
    },
    midnight: {
        id: "midnight",
        tokens: {
            accent: "#8aa0ff",
            tone: "oled",
            radius: "square",
            contrast: "normal",
            cards: "flat",
            status: {
                ok: "#4fe3b5",
                warn: "#ffc65c",
                danger: "#ff6b81"
            }
        },
        extras: [],
        swatch: {
            frame: "#000000",
            canvas: "#00010a",
            surface: "#070a17",
            surface2: "#0d1122",
            text: "#f1f3fb",
            muted: "#8a90a8"
        }
    },
    ocean: {
        id: "ocean",
        tokens: {
            accent: "#3cc8ec",
            tone: "dark",
            radius: "slight",
            contrast: "normal",
            cards: "flat",
            status: {
                ok: "#4fe0b0",
                warn: "#ffc966",
                danger: "#ff7187"
            }
        },
        extras: [],
        swatch: {
            frame: "#010b12",
            canvas: "#06131c",
            surface: "#0b1c27",
            surface2: "#112431",
            text: "#ecf6fb",
            muted: "#86a1b0"
        }
    },
    forest: {
        id: "forest",
        tokens: {
            accent: "#7fd36f",
            tone: "dark",
            radius: "slight",
            contrast: "normal",
            cards: "flat",
            status: {
                ok: "#6ee0a0",
                warn: "#f0c464",
                danger: "#ff7a6e"
            }
        },
        extras: [],
        swatch: {
            frame: "#020a04",
            canvas: "#07120a",
            surface: "#0d1b10",
            surface2: "#132316",
            text: "#eef6ee",
            muted: "#8aa28c"
        }
    },
    sunset: {
        id: "sunset",
        tokens: {
            accent: "#ff7aa2",
            tone: "dark",
            radius: "round",
            contrast: "normal",
            cards: "flat",
            status: {
                ok: "#5ee0b6",
                warn: "#ffcf5c",
                danger: "#ff6b8b"
            }
        },
        extras: [],
        swatch: {
            frame: "#0c0408",
            canvas: "#150a10",
            surface: "#1e1018",
            surface2: "#271620",
            text: "#fbf0f2",
            muted: "#b0909c"
        }
    },
    sakura: {
        id: "sakura",
        tokens: {
            accent: "#c8346f",
            tone: "light",
            radius: "round",
            contrast: "normal",
            cards: "flat",
            status: {
                ok: "#086b53",
                warn: "#8f5300",
                danger: "#bd2536"
            }
        },
        extras: [],
        swatch: {
            frame: "#f5e4ea",
            canvas: "#fdf3f6",
            surface: "#fffafc",
            surface2: "#f8e9ee",
            text: "#2a1720",
            muted: "#76606a"
        }
    },
    nether: {
        id: "nether",
        tokens: {
            accent: "#ff8a3d",
            tone: "dark",
            radius: "square",
            contrast: "normal",
            cards: "flat",
            status: {
                ok: "#7fe08a",
                warn: "#ffc04d",
                danger: "#ff5a5f"
            }
        },
        extras: [],
        swatch: {
            frame: "#0e0202",
            canvas: "#170606",
            surface: "#210b0a",
            surface2: "#2b100e",
            text: "#fbefec",
            muted: "#b48f89"
        }
    },
    end: {
        id: "end",
        tokens: {
            accent: "#c39bff",
            tone: "dark",
            radius: "slight",
            contrast: "normal",
            cards: "outlined",
            status: {
                ok: "#e3dc8c",
                warn: "#ffb86b",
                danger: "#ff7398"
            }
        },
        extras: [],
        swatch: {
            frame: "#06030d",
            canvas: "#0d0817",
            surface: "#150e22",
            surface2: "#1c142c",
            text: "#f3effb",
            muted: "#9d92b4"
        }
    },
    retro: {
        id: "retro",
        tokens: {
            accent: "#ffd23f",
            tone: "dim",
            radius: "square",
            contrast: "normal",
            cards: "outlined",
            headings: "pixel",
            status: {
                ok: "#7ee35a",
                warn: "#ffb13b",
                danger: "#ff6155"
            }
        },
        extras: [],
        swatch: {
            frame: "#110f0b",
            canvas: "#181611",
            surface: "#201d17",
            surface2: "#28241d",
            text: "#f6f1e4",
            muted: "#a59d8a"
        }
    },
    pixel: {
        id: "pixel",
        tokens: {
            accent: "#ffb37d",
            tone: "dark",
            radius: "square",
            contrast: "normal",
            cards: "pixel",
            headings: "pixel",
            font: "inter_tight",
            bg: {
                kind: "gradient",
                gradient: "pixel",
                dim: 30
            },
            status: {
                ok: "#6ee7b7",
                warn: "#ffd27a",
                danger: "#ff7b8e"
            }
        },
        extras: [],
        swatch: {
            frame: "#0f0919",
            canvas: "#170e26",
            surface: "#221934",
            surface2: "#2c2241",
            text: "#f6f3ff",
            muted: "#a59fba"
        }
    },
    pixel_light: {
        id: "pixel_light",
        tokens: {
            accent: "#6a4cf5",
            tone: "light",
            radius: "square",
            contrast: "normal",
            cards: "pixel",
            headings: "pixel",
            font: "inter_tight",
            status: {
                ok: "#08766a",
                warn: "#875000",
                danger: "#c81e45"
            }
        },
        extras: [],
        swatch: {
            frame: "#e9e7e1",
            canvas: "#f5f4f1",
            surface: "#fffefc",
            surface2: "#f0efeb",
            text: "#151419",
            muted: "#5b5963"
        }
    },
    contrast: {
        id: "contrast",
        tokens: {
            accent: "#ffd60a",
            tone: "oled",
            radius: "square",
            contrast: "high",
            cards: "outlined",
            status: {
                ok: "#3dff9a",
                warn: "#ffb020",
                danger: "#ff6b6b"
            }
        },
        extras: [],
        swatch: {
            frame: "#000000",
            canvas: "#000000",
            surface: "#0a0a0a",
            surface2: "#151515",
            text: "#ffffff",
            muted: "#d6d6dc"
        }
    }
};
export const THEME_IDS = [
    "standard",
    "pixel",
    "pixel_light",
    "light",
    "graphite",
    "midnight",
    "ocean",
    "forest",
    "sunset",
    "sakura",
    "nether",
    "end",
    "retro",
    "contrast",
    "winter"
];
