use std::sync::OnceLock;

#[derive(Debug, Clone)]
pub struct Product {
    pub display: String,
    pub slug: String,
    pub ua_name: String,
    pub version: String,
    pub client: String,
    pub relay_slot_base: u32,
}

static PRODUCT: OnceLock<Product> = OnceLock::new();

pub fn set(p: Product) {
    let _ = PRODUCT.set(p);
}

pub fn get() -> &'static Product {
    PRODUCT.get_or_init(|| Product {
        display: "Vibe Launcher".into(),
        slug: "vibe-launcher".into(),
        ua_name: "VibeLauncher".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        client: "launcher".into(),
        relay_slot_base: 1,
    })
}

pub fn user_agent() -> String {
    let p = get();
    format!("{}/{} (+https://github.com/vibec-studios)", p.ua_name, p.version)
}
